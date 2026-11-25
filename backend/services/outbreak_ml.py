import json
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import accuracy_score, roc_auc_score
from sqlalchemy.orm import Session

from backend.models import (
    OfficialOutbreakReport,
    PredictionResult,
    Region,
    WeatherObservation,
)

MODEL_VERSION = "rf_outbreak_v2.0"

FEATURE_COLS = [
    "cases_current_week",
    "deaths_current_week",
    "cases_lag_1w",
    "rolling_3w_mean",
    "wow_case_delta",
    "temp_7d_avg",
    "precip_7d_sum",
    "humidity_7d_avg",
    "log_population",
]

FEATURE_LABELS = {
    "cases_current_week": "Most recent observed weekly cases",
    "deaths_current_week": "Most recent observed weekly deaths",
    "cases_lag_1w": "Prior reporting week cases",
    "rolling_3w_mean": "3-week trailing case average",
    "wow_case_delta": "Week-over-week case change",
    "temp_7d_avg": "7-day mean temperature (Open-Meteo)",
    "precip_7d_sum": "7-day cumulative precipitation (Open-Meteo)",
    "humidity_7d_avg": "7-day mean relative humidity (Open-Meteo)",
    "log_population": "Log district population (geocoded)",
}


def _classify_probability_risk(prob: float) -> Tuple[float, str]:
    score = round(prob * 100.0, 1)
    if score >= 75.0:
        return score, "critical"
    if score >= 50.0:
        return score, "high"
    if score >= 25.0:
        return score, "moderate"
    return score, "low"


def _weather_features_for_region_week(
    weather_rows: List[WeatherObservation],
    end_dt: Optional[datetime],
) -> Tuple[Optional[float], Optional[float], Optional[float]]:
    if not weather_rows:
        return None, None, None
    if end_dt is not None:
        ref_date = end_dt.date() if isinstance(end_dt, datetime) else end_dt
        window = [
            w for w in weather_rows
            if 0 <= (ref_date - w.obs_date).days <= 7
        ]
        if not window:
            window = [w for w in weather_rows if not w.is_forecast][-7:]
    else:
        window = [w for w in weather_rows if not w.is_forecast][-7:]

    temps = [w.temperature_c for w in window if w.temperature_c is not None]
    precs = [w.precipitation_mm for w in window if w.precipitation_mm is not None]
    hums = [w.humidity_pct for w in window if w.humidity_pct is not None]
    temp_avg = float(np.mean(temps)) if temps else None
    precip_sum = float(np.sum(precs)) if precs else None
    hum_avg = float(np.mean(hums)) if hums else None
    return temp_avg, precip_sum, hum_avg


def list_monitored_diseases(db: Session) -> List[str]:
    rows = (
        db.query(OfficialOutbreakReport.disease)
        .distinct()
        .order_by(OfficialOutbreakReport.disease.asc())
        .all()
    )
    return [r[0] for r in rows if r[0]]


def train_and_forecast_disease(db: Session, disease: str) -> Dict[str, Any]:
    """Train a RandomForestClassifier strictly on verified NCDC/IDSP + Open-Meteo records with honest insufficient-data guards."""
    disease_clean = disease.strip()
    regions = {r.id: r for r in db.query(Region).all()}
    reports = (
        db.query(OfficialOutbreakReport)
        .filter(OfficialOutbreakReport.disease == disease_clean)
        .order_by(OfficialOutbreakReport.reporting_year.asc(), OfficialOutbreakReport.reporting_week.asc())
        .all()
    )

    # Clear prior predictions for this disease so stale evaluations never linger
    db.query(PredictionResult).filter(PredictionResult.disease == disease_clean).delete()
    db.flush()

    if not reports:
        db.commit()
        return {
            "disease": disease_clean,
            "status": "insufficient_data",
            "reason": f"No verified official outbreak reports exist for '{disease_clean}'. Sync official public health data first.",
            "model_version": MODEL_VERSION,
            "predictions": [],
            "metrics": {
                "status": "insufficient_data",
                "roc_auc": None,
                "accuracy": None,
                "train_samples": 0,
                "eval_samples": 0,
                "positive_rate": None,
            },
        }

    weather_by_region: Dict[int, List[WeatherObservation]] = {}
    for w in db.query(WeatherObservation).order_by(WeatherObservation.obs_date.asc()).all():
        weather_by_region.setdefault(w.region_id, []).append(w)

    # Aggregate official reports by (region_id, reporting_year, reporting_week)
    grouped: Dict[Tuple[int, int, int], Dict[str, Any]] = {}
    for rep in reports:
        if not rep.region_id or rep.region_id not in regions:
            continue
        key = (rep.region_id, rep.reporting_year, rep.reporting_week)
        entry = grouped.setdefault(
            key,
            {
                "region_id": rep.region_id,
                "year": rep.reporting_year,
                "week": rep.reporting_week,
                "period_index": rep.reporting_year * 100 + rep.reporting_week,
                "period_label": f"{rep.reporting_year}-W{rep.reporting_week:02d}",
                "cases": 0,
                "deaths": 0,
                "ref_date": rep.reporting_date or rep.start_date,
                "source_ids": [],
            },
        )
        entry["cases"] += int(rep.cases or 0)
        entry["deaths"] += int(rep.deaths or 0)
        if rep.reporting_date and (entry["ref_date"] is None or rep.reporting_date > entry["ref_date"]):
            entry["ref_date"] = rep.reporting_date
        entry["source_ids"].append(rep.unique_outbreak_id)

    if not grouped:
        db.commit()
        return {
            "disease": disease_clean,
            "status": "insufficient_data",
            "reason": f"Reports for '{disease_clean}' lack mapped geographic regions.",
            "model_version": MODEL_VERSION,
            "predictions": [],
            "metrics": {"status": "insufficient_data", "roc_auc": None, "accuracy": None, "train_samples": 0, "eval_samples": 0},
        }

    raw_df = pd.DataFrame(list(grouped.values())).sort_values(["region_id", "period_index"]).reset_index(drop=True)

    # Build lagged panel across distinct reporting weeks per region
    all_periods = sorted(raw_df["period_index"].unique().tolist())
    min_period_label = f"{all_periods[0] // 100}-W{all_periods[0] % 100:02d}"
    max_period_label = f"{all_periods[-1] // 100}-W{all_periods[-1] % 100:02d}"
    training_data_period = f"{min_period_label} to {max_period_label}"
    target_year = all_periods[-1] // 100
    target_week = (all_periods[-1] % 100) + 1
    if target_week > 52:
        target_year += 1
        target_week = 1
    target_period = f"{target_year}-W{target_week:02d}"

    feature_rows: List[Dict[str, Any]] = []
    latest_rows: List[Dict[str, Any]] = []

    for rid, grp in raw_df.groupby("region_id"):
        grp = grp.sort_values("period_index").reset_index(drop=True)
        region = regions[rid]
        w_rows = weather_by_region.get(rid, [])
        pop_val = float(np.log1p(region.population)) if region.population and region.population > 0 else np.nan

        cases_series = grp["cases"].astype(float)
        grp["cases_lag_1w"] = cases_series.shift(1)
        grp["rolling_3w_mean"] = cases_series.rolling(3, min_periods=1).mean()
        grp["wow_case_delta"] = cases_series - cases_series.shift(1).fillna(cases_series)

        for idx, row in grp.iterrows():
            temp_avg, precip_sum, hum_avg = _weather_features_for_region_week(w_rows, row["ref_date"])
            feat = {
                "region_id": rid,
                "period_index": int(row["period_index"]),
                "period_label": row["period_label"],
                "cases_current_week": float(row["cases"]),
                "deaths_current_week": float(row["deaths"]),
                "cases_lag_1w": float(row["cases_lag_1w"]) if pd.notna(row["cases_lag_1w"]) else float(row["cases"]),
                "rolling_3w_mean": float(row["rolling_3w_mean"]),
                "wow_case_delta": float(row["wow_case_delta"]),
                "temp_7d_avg": temp_avg if temp_avg is not None else np.nan,
                "precip_7d_sum": precip_sum if precip_sum is not None else np.nan,
                "humidity_7d_avg": hum_avg if hum_avg is not None else np.nan,
                "log_population": pop_val,
                "source_ids": row["source_ids"],
                "history_weeks": len(grp),
            }
            if idx < len(grp) - 1:
                next_cases = float(grp.loc[idx + 1, "cases"])
                # Outbreak surge indicator: next week's verified case count >= 25 or >= 25% above current week with >= 15 cases
                feat["target_outbreak_surge"] = int(
                    next_cases >= 25.0 or (next_cases >= 15.0 and next_cases >= float(row["cases"]) * 1.25)
                )
                feature_rows.append(feat)
            else:
                latest_rows.append(feat)

    # Also record regions with no verified reports for this disease as insufficient_data
    reported_region_ids = {r["region_id"] for r in latest_rows}

    created_predictions: List[PredictionResult] = []
    source_ids_all = sorted({sid for row in latest_rows for sid in row["source_ids"]})

    # Check strict modeling requirements before fitting ML classifier
    can_train = False
    insufficiency_reason = ""
    if len(all_periods) < 2 or len(feature_rows) < 12:
        insufficiency_reason = (
            f"Only {len(feature_rows)} sequential multi-week observation(s) across {len(all_periods)} week(s) exist for '{disease_clean}'. "
            "At least 12 supervised week-to-week transitions across multiple reporting weeks are required before training the outbreak classifier."
        )
    else:
        train_df = pd.DataFrame(feature_rows).sort_values("period_index").reset_index(drop=True)
        unique_classes = train_df["target_outbreak_surge"].nunique()
        if unique_classes < 2:
            insufficiency_reason = (
                f"Historical transitions for '{disease_clean}' contain only one outcome class; chronological binary classification cannot be calibrated."
            )
        else:
            can_train = True

    if not can_train:
        # Honest empty/insufficient predictions for reported regions + monitored regions (never fake scores)
        for row in latest_rows:
            pred = PredictionResult(
                region_id=row["region_id"],
                disease=disease_clean,
                model_version=MODEL_VERSION,
                training_data_period=training_data_period,
                target_period=target_period,
                observed_cases_recent=int(row["cases_current_week"]),
                observed_deaths_recent=int(row["deaths_current_week"]),
                outbreak_probability=None,
                risk_score=None,
                risk_level="insufficient_data",
                confidence_or_uncertainty=insufficiency_reason,
                model_name="RandomForestClassifier (insufficient_data)",
                cv_roc_auc=None,
                cv_accuracy=None,
                feature_importances_json=json.dumps([]),
                explanation_text=insufficiency_reason,
                limitations_text="Model did not generate predictive risk probabilities because historical supervised transition volume is below minimum validation threshold.",
                source_dataset_ids_json=json.dumps(row["source_ids"]),
            )
            db.add(pred)
            created_predictions.append(pred)

        for rid in regions:
            if rid not in reported_region_ids:
                pred = PredictionResult(
                    region_id=rid,
                    disease=disease_clean,
                    model_version=MODEL_VERSION,
                    training_data_period=training_data_period,
                    target_period=target_period,
                    observed_cases_recent=0,
                    observed_deaths_recent=0,
                    outbreak_probability=None,
                    risk_score=None,
                    risk_level="insufficient_data",
                    confidence_or_uncertainty=f"No verified IDSP reports exist for '{disease_clean}' in this district.",
                    model_name="RandomForestClassifier (insufficient_data)",
                    cv_roc_auc=None,
                    cv_accuracy=None,
                    feature_importances_json=json.dumps([]),
                    explanation_text=f"No verified NCDC/IDSP weekly outbreak reports exist for '{disease_clean}' in this district during {training_data_period}.",
                    limitations_text="District excluded from numerical risk scoring due to absence of disease-specific case observations.",
                    source_dataset_ids_json=json.dumps([]),
                )
                db.add(pred)
                created_predictions.append(pred)

        db.commit()
        return {
            "disease": disease_clean,
            "status": "insufficient_data",
            "reason": insufficiency_reason,
            "model_version": MODEL_VERSION,
            "training_data_period": training_data_period,
            "target_period": target_period,
            "predictions": [_serialize_pred(p, regions[p.region_id]) for p in created_predictions],
            "metrics": {
                "status": "insufficient_data",
                "roc_auc": None,
                "accuracy": None,
                "train_samples": len(feature_rows),
                "eval_samples": 0,
            },
        }

    # Chronological 75/25 holdout evaluation without synthetic inflation
    train_df = pd.DataFrame(feature_rows).sort_values("period_index").reset_index(drop=True)
    # Impute missing numeric environmental covariates strictly using training split medians
    split_idx = max(8, int(len(train_df) * 0.75))
    split_idx = min(split_idx, len(train_df) - 2)
    train_part = train_df.iloc[:split_idx].copy()
    eval_part = train_df.iloc[split_idx:].copy()

    medians: Dict[str, float] = {}
    for col in FEATURE_COLS:
        med = train_part[col].median()
        medians[col] = float(med) if pd.notna(med) else 0.0
        train_part[col] = train_part[col].fillna(medians[col])
        eval_part[col] = eval_part[col].fillna(medians[col])
        train_df[col] = train_df[col].fillna(medians[col])

    x_train_np = train_part[FEATURE_COLS].to_numpy(dtype=float)
    y_train_np = train_part["target_outbreak_surge"].to_numpy(dtype=int)
    x_eval_np = eval_part[FEATURE_COLS].to_numpy(dtype=float)
    y_eval_np = eval_part["target_outbreak_surge"].to_numpy(dtype=int)

    eval_acc: Optional[float] = None
    eval_auc: Optional[float] = None
    if len(np.unique(y_train_np)) >= 2 and len(eval_part) >= 2:
        eval_model = RandomForestClassifier(
            n_estimators=160,
            max_depth=6,
            min_samples_leaf=2,
            class_weight="balanced",
            random_state=42,
        )
        eval_model.fit(x_train_np, y_train_np)
        eval_preds = eval_model.predict(x_eval_np)
        eval_acc = round(float(accuracy_score(y_eval_np, eval_preds)), 4)
        if len(np.unique(y_eval_np)) >= 2:
            eval_probs = eval_model.predict_proba(x_eval_np)[:, 1]
            eval_auc = round(float(roc_auc_score(y_eval_np, eval_probs)), 4)

    # Fit final classifier on all supervised chronological transitions
    full_x_np = train_df[FEATURE_COLS].to_numpy(dtype=float)
    full_y_np = train_df["target_outbreak_surge"].to_numpy(dtype=int)
    final_model = RandomForestClassifier(
        n_estimators=200,
        max_depth=6,
        min_samples_leaf=2,
        class_weight="balanced",
        random_state=42,
    )
    final_model.fit(full_x_np, full_y_np)

    importances = [
        {"feature": col, "label": FEATURE_LABELS[col], "importance": round(float(imp), 4)}
        for col, imp in sorted(zip(FEATURE_COLS, final_model.feature_importances_), key=lambda item: item[1], reverse=True)
    ]

    for row in latest_rows:
        vec = np.array([[row[c] if (row[c] is not None and not pd.isna(row[c])) else medians[c] for c in FEATURE_COLS]], dtype=float)
        prob = float(final_model.predict_proba(vec)[0][1])
        # Spread across RF tree estimators quantifies epistemic uncertainty
        tree_probs = [float(tree.predict_proba(vec)[0][1]) if tree.predict_proba(vec).shape[1] > 1 else prob for tree in final_model.estimators_]
        prob_std = float(np.std(tree_probs)) if tree_probs else 0.0
        score, level = _classify_probability_risk(prob)

        uncert_text = (
            f"Tree ensemble std: +/-{round(prob_std * 100, 1)}% "
            f"({row['history_weeks']} verified reporting week(s) for this district)."
        )
        if row["history_weeks"] < 2:
            uncert_text += " Low district-level longitudinal depth; interpret alongside field surveillance."

        top_drivers = ", ".join(item["label"] for item in importances[:3])
        explanation = (
            f"{regions[row['region_id']].name} recorded {int(row['cases_current_week'])} verified cases and "
            f"{int(row['deaths_current_week'])} death(s) in {row['period_label']}. "
            f"Outbreak surge probability for {target_period} is {round(prob * 100, 1)}% ({level}). "
            f"Top global model drivers: {top_drivers}."
        )
        limitations = (
            "Forecast relies on weekly NCDC/IDSP outbreak event tables and Open-Meteo covariates; "
            "districts reporting single isolated outbreaks have wider uncertainty bounds."
        )

        pred = PredictionResult(
            region_id=row["region_id"],
            disease=disease_clean,
            model_version=MODEL_VERSION,
            training_data_period=training_data_period,
            target_period=target_period,
            observed_cases_recent=int(row["cases_current_week"]),
            observed_deaths_recent=int(row["deaths_current_week"]),
            outbreak_probability=round(prob, 4),
            risk_score=score,
            risk_level=level,
            confidence_or_uncertainty=uncert_text,
            model_name="RandomForestClassifier",
            cv_roc_auc=eval_auc,
            cv_accuracy=eval_acc,
            feature_importances_json=json.dumps(importances),
            explanation_text=explanation,
            limitations_text=limitations,
            source_dataset_ids_json=json.dumps(row["source_ids"]),
        )
        db.add(pred)
        created_predictions.append(pred)

    # Regions without any report for this disease remain strictly insufficient_data
    for rid in regions:
        if rid not in reported_region_ids:
            pred = PredictionResult(
                region_id=rid,
                disease=disease_clean,
                model_version=MODEL_VERSION,
                training_data_period=training_data_period,
                target_period=target_period,
                observed_cases_recent=0,
                observed_deaths_recent=0,
                outbreak_probability=None,
                risk_score=None,
                risk_level="insufficient_data",
                confidence_or_uncertainty=f"No verified IDSP reports exist for '{disease_clean}' in this district.",
                model_name="RandomForestClassifier (insufficient_data)",
                cv_roc_auc=eval_auc,
                cv_accuracy=eval_acc,
                feature_importances_json=json.dumps(importances),
                explanation_text=f"No verified official outbreak reports exist for '{disease_clean}' in {regions[rid].name}; risk is unrated rather than assumed low.",
                limitations_text="District excluded from numerical risk scoring due to absence of disease-specific observations.",
                source_dataset_ids_json=json.dumps([]),
            )
            db.add(pred)
            created_predictions.append(pred)

    db.commit()
    return {
        "disease": disease_clean,
        "status": "trained",
        "model_version": MODEL_VERSION,
        "training_data_period": training_data_period,
        "target_period": target_period,
        "predictions": [_serialize_pred(p, regions[p.region_id]) for p in created_predictions],
        "metrics": {
            "status": "trained",
            "roc_auc": eval_auc,
            "accuracy": eval_acc,
            "train_samples": len(train_part),
            "eval_samples": len(eval_part),
            "source_report_count": len(source_ids_all),
        },
        "feature_importances": importances,
    }


def _serialize_pred(pred: PredictionResult, region: Region) -> Dict[str, Any]:
    return {
        "id": pred.id,
        "region_id": pred.region_id,
        "region_name": region.name,
        "region_code": region.code,
        "state": region.state,
        "latitude": region.latitude,
        "longitude": region.longitude,
        "population": region.population,
        "geocode_source": region.geocode_source,
        "disease": pred.disease,
        "model_version": pred.model_version,
        "training_data_period": pred.training_data_period,
        "target_period": pred.target_period,
        "observed_cases_recent": pred.observed_cases_recent,
        "observed_deaths_recent": pred.observed_deaths_recent,
        "outbreak_probability": pred.outbreak_probability,
        "risk_score": pred.risk_score,
        "risk_level": pred.risk_level,
        "confidence_or_uncertainty": pred.confidence_or_uncertainty,
        "model_name": pred.model_name,
        "cv_roc_auc": pred.cv_roc_auc,
        "cv_accuracy": pred.cv_accuracy,
        "feature_importances": json.loads(pred.feature_importances_json or "[]"),
        "explanation_text": pred.explanation_text,
        "limitations_text": pred.limitations_text,
        "source_dataset_ids": json.loads(pred.source_dataset_ids_json or "[]"),
        "prediction_timestamp": pred.prediction_timestamp.isoformat(),
    }
