import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, status
from sqlalchemy import func
from sqlalchemy.orm import Session

from backend.auth import log_access, require_roles
from backend.database import get_db
from backend.models import (
    DataSyncRun,
    InterventionScenario,
    OfficialOutbreakReport,
    PredictionResult,
    PublicHealthAlert,
    Region,
    User,
    WeatherObservation,
)
from backend.schemas import SimulationRequest
from backend.services.outbreak_ml import list_monitored_diseases, train_and_forecast_disease
from backend.services.public_health_sync import sync_official_public_health_data
from backend.services.simulator_service import run_intervention_simulation

router = APIRouter(prefix="/api/outbreak", tags=["Public Health & Outbreak Intelligence"])


def _serialize_prediction(pred: PredictionResult, region: Region) -> dict:
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


@router.post("/sync")
async def sync_public_health_sources(
    weeks_to_fetch: int = Query(default=8, ge=1, le=20),
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    result = await sync_official_public_health_data(db, weeks_to_fetch=weeks_to_fetch)
    diseases = list_monitored_diseases(db)
    retrained: list[dict] = []
    for d in diseases[:6]:
        ml_res = train_and_forecast_disease(db, d)
        retrained.append({"disease": d, "status": ml_res.get("status")})

    log_access(
        db,
        actor_user_id=current_user.id,
        actor_role=current_user.role_name,
        action="outbreak_public_health_sync",
        resource_type="DataSyncRun",
        resource_id=str(result.get("sync_run_id", "")),
        details=f"Fetched {result.get('documents_fetched', 0)} IDSP bulletins, imported {result.get('records_imported', 0)} records",
    )
    return {**result, "retrained_diseases": retrained}


@router.get("/sync/runs")
def list_sync_runs(
    current_user: User = Depends(require_roles("admin", "doctor")),
    db: Session = Depends(get_db),
):
    runs = db.query(DataSyncRun).order_by(DataSyncRun.started_at.desc()).limit(20).all()
    return {
        "runs": [
            {
                "id": r.id,
                "source_name": r.source_name,
                "source_url": r.source_url,
                "status": r.status,
                "documents_fetched": r.documents_fetched,
                "records_imported": r.records_imported,
                "duplicates_skipped": r.duplicates_skipped,
                "error_message": r.error_message,
                "started_at": r.started_at.isoformat(),
                "completed_at": r.completed_at.isoformat() if r.completed_at else None,
            }
            for r in runs
        ]
    }


@router.get("/overview")
def get_outbreak_overview(
    disease: Optional[str] = Query(default=None),
    state: Optional[str] = Query(default=None),
    current_user: User = Depends(require_roles("admin", "doctor")),
    db: Session = Depends(get_db),
):
    diseases = list_monitored_diseases(db)
    selected_disease = disease.strip() if (disease and disease.strip()) else (diseases[0] if diseases else None)

    regions_q = db.query(Region)
    if state:
        regions_q = regions_q.filter(Region.state == state)
    regions = regions_q.order_by(Region.state.asc(), Region.name.asc()).all()
    region_map = {r.id: r for r in regions}

    latest_sync = db.query(DataSyncRun).order_by(DataSyncRun.started_at.desc()).first()

    reports_q = db.query(OfficialOutbreakReport)
    if selected_disease:
        reports_q = reports_q.filter(OfficialOutbreakReport.disease == selected_disease)
    if state:
        reports_q = reports_q.filter(OfficialOutbreakReport.state == state)

    recent_reports = (
        reports_q.order_by(
            OfficialOutbreakReport.reporting_year.desc(),
            OfficialOutbreakReport.reporting_week.desc(),
            OfficialOutbreakReport.cases.desc(),
        )
        .limit(80)
        .all()
    )

    total_reports = reports_q.count()
    agg_cases, agg_deaths = reports_q.with_entities(
        func.coalesce(func.sum(OfficialOutbreakReport.cases), 0),
        func.coalesce(func.sum(OfficialOutbreakReport.deaths), 0),
    ).first() or (0, 0)

    preds_raw = []
    if selected_disease:
        preds_raw = (
            db.query(PredictionResult)
            .filter(PredictionResult.disease == selected_disease)
            .order_by(PredictionResult.risk_score.desc().nullslast())
            .all()
        )
    serialized_preds = [_serialize_prediction(p, region_map[p.region_id]) for p in preds_raw if p.region_id in region_map]

    rated_preds = [p for p in serialized_preds if p["risk_level"] != "insufficient_data" and p["risk_score"] is not None]
    insufficient_preds = [p for p in serialized_preds if p["risk_level"] == "insufficient_data"]
    highest = rated_preds[0] if rated_preds else None
    high_or_crit = sum(1 for p in rated_preds if p["risk_level"] in {"high", "critical"})

    first_rated = rated_preds[0] if rated_preds else (serialized_preds[0] if serialized_preds else None)
    model_metrics = {
        "status": "trained" if rated_preds else ("insufficient_data" if serialized_preds or total_reports > 0 else "no_data"),
        "model_version": first_rated["model_version"] if first_rated else None,
        "model_name": first_rated["model_name"] if first_rated else None,
        "training_data_period": first_rated["training_data_period"] if first_rated else None,
        "target_period": first_rated["target_period"] if first_rated else None,
        "roc_auc": first_rated["cv_roc_auc"] if first_rated else None,
        "accuracy": first_rated["cv_accuracy"] if first_rated else None,
        "insufficient_reason": first_rated["explanation_text"] if (not rated_preds and first_rated) else None,
    }
    feature_importances = first_rated["feature_importances"] if first_rated else []

    alerts_q = db.query(PublicHealthAlert)
    if selected_disease:
        alerts_q = alerts_q.filter(PublicHealthAlert.disease == selected_disease)
    alerts = alerts_q.order_by(PublicHealthAlert.is_acknowledged.asc(), PublicHealthAlert.created_at.desc()).limit(30).all()

    weather_rows = (
        db.query(WeatherObservation)
        .order_by(WeatherObservation.obs_date.desc())
        .limit(60)
        .all()
    )

    return {
        "summary": {
            "selected_disease": selected_disease,
            "total_reports": total_reports,
            "total_cases_observed": int(agg_cases or 0),
            "total_deaths_observed": int(agg_deaths or 0),
            "monitored_regions": len(regions),
            "rated_regions": len(rated_preds),
            "insufficient_data_regions": len(insufficient_preds),
            "high_or_critical_regions": high_or_crit,
            "highest_risk_region": highest["region_name"] if highest else None,
            "highest_risk_score": highest["risk_score"] if highest else None,
            "active_alerts": sum(1 for a in alerts if not a.is_acknowledged),
            "last_sync_at": latest_sync.completed_at.isoformat() if (latest_sync and latest_sync.completed_at) else None,
            "last_sync_status": latest_sync.status if latest_sync else "never_synced",
        },
        "available_diseases": diseases,
        "regions": [
            {
                "id": r.id,
                "code": r.code,
                "name": r.name,
                "state": r.state,
                "latitude": r.latitude,
                "longitude": r.longitude,
                "population": r.population,
                "geocode_source": r.geocode_source,
            }
            for r in regions
        ],
        "predictions": serialized_preds,
        "model_metrics": model_metrics,
        "feature_importances": feature_importances,
        "recent_reports": [
            {
                "id": rep.id,
                "unique_outbreak_id": rep.unique_outbreak_id,
                "region_id": rep.region_id,
                "state": rep.state,
                "district": rep.district,
                "disease": rep.disease,
                "cases": rep.cases,
                "deaths": rep.deaths,
                "reporting_week": rep.reporting_week,
                "reporting_year": rep.reporting_year,
                "reporting_period": rep.reporting_period,
                "outbreak_status": rep.outbreak_status,
                "source_name": rep.source_name,
                "source_url": rep.source_url,
                "source_document_id": rep.source_document_id,
                "validation_status": rep.validation_status,
                "import_timestamp": rep.import_timestamp.isoformat(),
            }
            for rep in recent_reports
        ],
        "weather_observations": [
            {
                "id": w.id,
                "region_id": w.region_id,
                "region_name": region_map[w.region_id].name if w.region_id in region_map else "District",
                "obs_date": w.obs_date.isoformat(),
                "is_forecast": w.is_forecast,
                "temperature_c": w.temperature_c,
                "precipitation_mm": w.precipitation_mm,
                "humidity_pct": w.humidity_pct,
                "source_name": w.source_name,
                "source_url": w.source_url,
            }
            for w in weather_rows
            if w.region_id in region_map
        ],
        "alerts": [
            {
                "id": a.id,
                "region_id": a.region_id,
                "region_name": region_map[a.region_id].name if a.region_id in region_map else "District",
                "source_outbreak_id": a.source_outbreak_id,
                "source_document_id": a.source_document_id,
                "disease": a.disease,
                "severity": a.severity,
                "alert_type": a.alert_type,
                "title": a.title,
                "reason": a.reason,
                "recommended_action": a.recommended_action,
                "metric_value": a.metric_value,
                "is_acknowledged": a.is_acknowledged,
                "created_at": a.created_at.isoformat(),
            }
            for a in alerts
        ],
    }


@router.post("/train")
def trigger_model_training(
    disease: str = Query(...),
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    result = train_and_forecast_disease(db, disease)
    log_access(
        db,
        actor_user_id=current_user.id,
        actor_role=current_user.role_name,
        action="outbreak_ml_train",
        resource_type="PredictionResult",
        resource_id=disease,
        details=f"ML run for {disease}: status={result.get('status')}",
    )
    return result


@router.get("/regions/{region_id}/history")
def get_region_history(
    region_id: int,
    disease: Optional[str] = Query(default=None),
    current_user: User = Depends(require_roles("admin", "doctor")),
    db: Session = Depends(get_db),
):
    region = db.query(Region).filter(Region.id == region_id).first()
    if not region:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Region not found.")

    rep_q = db.query(OfficialOutbreakReport).filter(OfficialOutbreakReport.region_id == region_id)
    if disease:
        rep_q = rep_q.filter(OfficialOutbreakReport.disease == disease)
    reports = rep_q.order_by(OfficialOutbreakReport.reporting_year.asc(), OfficialOutbreakReport.reporting_week.asc()).all()

    weather = (
        db.query(WeatherObservation)
        .filter(WeatherObservation.region_id == region_id)
        .order_by(WeatherObservation.obs_date.asc())
        .all()
    )

    return {
        "region": {
            "id": region.id,
            "code": region.code,
            "name": region.name,
            "state": region.state,
            "latitude": region.latitude,
            "longitude": region.longitude,
            "population": region.population,
            "geocode_source": region.geocode_source,
        },
        "outbreak_reports": [
            {
                "unique_outbreak_id": r.unique_outbreak_id,
                "disease": r.disease,
                "cases": r.cases,
                "deaths": r.deaths,
                "reporting_week": r.reporting_week,
                "reporting_year": r.reporting_year,
                "period": f"{r.reporting_year}-W{r.reporting_week:02d}",
                "source_name": r.source_name,
                "source_document_id": r.source_document_id,
            }
            for r in reports
        ],
        "weather_observations": [
            {
                "obs_date": w.obs_date.isoformat(),
                "is_forecast": w.is_forecast,
                "temperature_c": w.temperature_c,
                "precipitation_mm": w.precipitation_mm,
                "humidity_pct": w.humidity_pct,
                "source_name": w.source_name,
            }
            for w in weather
        ],
    }


@router.post("/alerts/{alert_id}/acknowledge")
def acknowledge_alert(
    alert_id: int,
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    alert = db.query(PublicHealthAlert).filter(PublicHealthAlert.id == alert_id).first()
    if not alert:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Alert not found.")
    alert.is_acknowledged = True
    db.commit()
    return {"acknowledged": True, "id": alert_id}


@router.post("/simulator/run")
def run_simulator(
    payload: SimulationRequest,
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    region = db.query(Region).filter(Region.id == payload.region_id).first()
    if not region:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Region not found.")

    try:
        result = run_intervention_simulation(
            region=region,
            disease=payload.disease,
            initial_active_cases=payload.initial_active_cases,
            available_beds=payload.available_beds,
            medical_staff=payload.medical_staff,
            prevention_coverage_pct=payload.prevention_coverage_pct,
            vaccination_coverage_pct=payload.vaccination_coverage_pct,
            budget_usd=payload.budget_usd,
            intervention_start_day=payload.intervention_start_day,
            population_override=payload.population_override,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_422_UNPROCESSABLE_ENTITY, detail=str(exc))

    scenario = InterventionScenario(
        created_by_user_id=current_user.id,
        name=payload.name.strip() or f"{region.name} {payload.disease} Scenario",
        region_id=region.id,
        disease=payload.disease,
        initial_active_cases=payload.initial_active_cases,
        available_beds=payload.available_beds,
        medical_staff=payload.medical_staff,
        prevention_coverage_pct=payload.prevention_coverage_pct,
        vaccination_coverage_pct=payload.vaccination_coverage_pct,
        budget_usd=payload.budget_usd,
        intervention_start_day=payload.intervention_start_day,
        results_json=json.dumps(result),
    )
    db.add(scenario)
    db.commit()
    db.refresh(scenario)

    return {"scenario_id": scenario.id, "name": scenario.name, **result}


@router.get("/simulator/scenarios")
def list_scenarios(
    current_user: User = Depends(require_roles("admin", "doctor")),
    db: Session = Depends(get_db),
):
    scenarios = db.query(InterventionScenario).order_by(InterventionScenario.created_at.desc()).limit(20).all()
    regions = {r.id: r.name for r in db.query(Region).all()}
    output = []
    for s in scenarios:
        res = json.loads(s.results_json or "{}")
        output.append(
            {
                "id": s.id,
                "name": s.name,
                "region_id": s.region_id,
                "region_name": regions.get(s.region_id, "District"),
                "disease": s.disease,
                "initial_active_cases": s.initial_active_cases,
                "available_beds": s.available_beds,
                "medical_staff": s.medical_staff,
                "prevention_coverage_pct": s.prevention_coverage_pct,
                "vaccination_coverage_pct": s.vaccination_coverage_pct,
                "budget_usd": s.budget_usd,
                "intervention_start_day": s.intervention_start_day,
                "summary_metrics": res.get("summary_metrics", {}),
                "input_parameters": res.get("input_parameters", {}),
                "created_at": s.created_at.isoformat(),
            }
        )
    return {"scenarios": output}
