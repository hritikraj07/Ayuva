import io
import re
from datetime import date, datetime, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple

import httpx
from pypdf import PdfReader
from sqlalchemy.orm import Session

from backend.models import DataSyncRun, OfficialOutbreakReport, PublicHealthAlert, Region, WeatherObservation

NCDC_WEEKLY_URL = "https://ncdc.mohfw.gov.in/includes/WeeklyOutbreaks.php"
NCDC_BASE_URL = "https://ncdc.mohfw.gov.in"
OPEN_METEO_GEOCODE_URL = "https://geocoding-api.open-meteo.com/v1/search"
OPEN_METEO_ARCHIVE_URL = "https://archive-api.open-meteo.com/v1/archive"
OPEN_METEO_FORECAST_URL = "https://api.open-meteo.com/v1/forecast"

ROW_PATTERN = re.compile(
    r"([A-Z]{2,3}/[A-Z]{2,5}/\d{4}/\d{1,2}/\d+)\s+"
    r"([A-Za-z &.\-]+?)\s+"
    r"([A-Za-z &.\-()]+?)\s+"
    r"(.*?)\s+"
    r"(\d+)\s+"
    r"(\d+)\s+"
    r"(\d{2}[-/]\d{2}[-/]\d{4})\s+"
    r"(\d{2}[-/]\d{2}[-/]\d{4})\s+"
    r"(Under\s+\w+|Closed|Completed|Controlled)",
    re.S,
)


def _normalize_disease(raw: str) -> str:
    cleaned = " ".join(raw.split()).strip()
    # Rejoin PDF column line-wrap artifacts such as "Gastroente ritis" or "Chikun gunya"
    cleaned = re.sub(r"\bGastroente\s+ritis\b", "Gastroenteritis", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bDiarrhoe\s+al\b", "Diarrhoeal", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bChikun\s+gunya\b", "Chikungunya", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bPoison\s+ing\b", "Poisoning", cleaned, flags=re.IGNORECASE)
    cleaned = re.sub(r"\bLeptospi\s+rosis\b", "Leptospirosis", cleaned, flags=re.IGNORECASE)
    return cleaned[:160]


def _parse_indian_date(raw: str) -> Optional[date]:
    s = raw.strip().replace("/", "-")
    for fmt in ("%d-%m-%Y", "%Y-%m-%d"):
        try:
            return datetime.strptime(s, fmt).date()
        except ValueError:
            continue
    return None


def _extract_reporting_period(first_page_text: str, week_num: int, year: int) -> str:
    m = re.search(r"\((\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4}\s+to\s+\d{1,2}(?:st|nd|rd|th)?\s+[A-Za-z]+\s+\d{4})\)", first_page_text)
    if m:
        return " ".join(m.group(1).split())
    return f"Week {week_num}, {year}"


async def _geocode_district(client: httpx.AsyncClient, district: str, state: str) -> Tuple[Optional[float], Optional[float], Optional[int], Optional[str]]:
    clean_dist = re.sub(r"\(.*?\)", "", district).strip()
    for query in [f"{clean_dist}, {state}", clean_dist]:
        try:
            resp = await client.get(
                OPEN_METEO_GEOCODE_URL,
                params={"name": query, "count": 5, "language": "en", "format": "json", "countryCode": "IN"},
                timeout=10.0,
            )
            if resp.status_code == 200:
                results = resp.json().get("results") or []
                if results:
                    # Prefer match whose admin1 aligns with state name when possible
                    best = results[0]
                    state_low = state.lower()
                    for cand in results:
                        if state_low in (cand.get("admin1") or "").lower():
                            best = cand
                            break
                    pop = best.get("population")
                    return (
                        float(best["latitude"]),
                        float(best["longitude"]),
                        int(pop) if pop else None,
                        "Open-Meteo Geocoding API (IN)",
                    )
        except Exception:
            continue
    return None, None, None, None


async def _fetch_open_meteo_weather(
    db: Session,
    client: httpx.AsyncClient,
    region: Region,
    start_d: date,
    end_d: date,
) -> int:
    if region.latitude is None or region.longitude is None:
        return 0
    today = date.today()
    hist_end = min(end_d, today - timedelta(days=1))
    inserted = 0

    if start_d <= hist_end:
        try:
            resp = await client.get(
                OPEN_METEO_ARCHIVE_URL,
                params={
                    "latitude": region.latitude,
                    "longitude": region.longitude,
                    "start_date": start_d.isoformat(),
                    "end_date": hist_end.isoformat(),
                    "daily": "temperature_2m_mean,precipitation_sum,relative_humidity_2m_mean",
                    "timezone": "Asia/Kolkata",
                },
                timeout=12.0,
            )
            if resp.status_code == 200:
                daily = resp.json().get("daily") or {}
                dates = daily.get("time") or []
                temps = daily.get("temperature_2m_mean") or []
                rains = daily.get("precipitation_sum") or []
                hums = daily.get("relative_humidity_2m_mean") or []
                for idx, dt_str in enumerate(dates):
                    obs_d = date.fromisoformat(dt_str)
                    exists = (
                        db.query(WeatherObservation.id)
                        .filter(
                            WeatherObservation.region_id == region.id,
                            WeatherObservation.obs_date == obs_d,
                            WeatherObservation.is_forecast.is_(False),
                        )
                        .first()
                    )
                    if exists:
                        continue
                    db.add(
                        WeatherObservation(
                            region_id=region.id,
                            obs_date=obs_d,
                            is_forecast=False,
                            temperature_c=temps[idx] if idx < len(temps) else None,
                            precipitation_mm=rains[idx] if idx < len(rains) else None,
                            humidity_pct=hums[idx] if idx < len(hums) else None,
                            source_name="Open-Meteo Historical Weather API",
                            source_url=OPEN_METEO_ARCHIVE_URL,
                        )
                    )
                    inserted += 1
        except Exception:
            pass

    # Also pull current 7-day meteorological forecast for context
    try:
        fc_resp = await client.get(
            OPEN_METEO_FORECAST_URL,
            params={
                "latitude": region.latitude,
                "longitude": region.longitude,
                "daily": "temperature_2m_mean,precipitation_sum,relative_humidity_2m_mean",
                "timezone": "Asia/Kolkata",
            },
            timeout=10.0,
        )
        if fc_resp.status_code == 200:
            daily = fc_resp.json().get("daily") or {}
            dates = daily.get("time") or []
            temps = daily.get("temperature_2m_mean") or []
            rains = daily.get("precipitation_sum") or []
            hums = daily.get("relative_humidity_2m_mean") or []
            for idx, dt_str in enumerate(dates):
                obs_d = date.fromisoformat(dt_str)
                exists = (
                    db.query(WeatherObservation.id)
                    .filter(
                        WeatherObservation.region_id == region.id,
                        WeatherObservation.obs_date == obs_d,
                        WeatherObservation.is_forecast.is_(True),
                    )
                    .first()
                )
                if exists:
                    continue
                db.add(
                    WeatherObservation(
                        region_id=region.id,
                        obs_date=obs_d,
                        is_forecast=True,
                        temperature_c=temps[idx] if idx < len(temps) else None,
                        precipitation_mm=rains[idx] if idx < len(rains) else None,
                        humidity_pct=hums[idx] if idx < len(hums) else None,
                        source_name="Open-Meteo Weather Forecast API",
                        source_url=OPEN_METEO_FORECAST_URL,
                    )
                )
                inserted += 1
    except Exception:
        pass

    return inserted


async def sync_official_public_health_data(db: Session, weeks_to_fetch: int = 8) -> Dict[str, Any]:
    """Download official NCDC/IDSP weekly outbreak PDFs, parse records, geocode districts, and fetch Open-Meteo weather."""
    sync_run = DataSyncRun(
        source_name="NCDC / IDSP Weekly Outbreak Reports + Open-Meteo",
        source_url=NCDC_WEEKLY_URL,
        status="running",
    )
    db.add(sync_run)
    db.commit()
    db.refresh(sync_run)

    docs_fetched = 0
    records_imported = 0
    duplicates_skipped = 0
    weather_rows_added = 0
    imported_pdfs: List[str] = []

    try:
        async with httpx.AsyncClient(follow_redirects=True, timeout=25.0) as client:
            index_resp = await client.get(NCDC_WEEKLY_URL)
            if index_resp.status_code != 200:
                raise RuntimeError(f"NCDC WeeklyOutbreaks returned HTTP {index_resp.status_code}")

            pdf_links = re.findall(r'href=["\']([^"\']*weekly_outbreaks/\d{4}/[^"\']*\.pdf)["\']', index_resp.text, re.I)
            if not pdf_links:
                raise RuntimeError("No official weekly outbreak PDF links were found on NCDC WeeklyOutbreaks page.")

            # Pick latest year available and take the newest `weeks_to_fetch` reports
            years = sorted({int(m.group(1)) for l in pdf_links if (m := re.search(r"/(\d{4})/", l))})
            latest_year = years[-1]
            year_links = []
            for l in pdf_links:
                ym = re.search(r"/(\d{4})/week(\d+)_", l, re.I)
                if ym and int(ym.group(1)) == latest_year:
                    year_links.append((int(ym.group(2)), l))
            year_links.sort(key=lambda x: x[0])
            target_links = year_links[-weeks_to_fetch:]

            existing_regions = {(r.state.lower(), r.name.lower()): r for r in db.query(Region).all()}
            regions_to_weather: Dict[int, Tuple[Region, date, date]] = {}

            for week_num, rel_path in target_links:
                pdf_url = rel_path if rel_path.startswith("http") else f"{NCDC_BASE_URL}{rel_path if rel_path.startswith('/') else '/' + rel_path}"
                doc_filename = pdf_url.rsplit("/", 1)[-1]

                # Skip PDF only if already present in database
                already_imported = (
                    db.query(OfficialOutbreakReport.id)
                    .filter(OfficialOutbreakReport.source_document_id == doc_filename)
                    .first()
                )
                if already_imported:
                    duplicates_skipped += 1
                    continue

                pdf_resp = await client.get(pdf_url)
                if pdf_resp.status_code != 200 or not pdf_resp.content.lstrip().startswith(b"%PDF"):
                    continue

                docs_fetched += 1
                imported_pdfs.append(doc_filename)

                reader = PdfReader(io.BytesIO(pdf_resp.content))
                first_text = reader.pages[0].extract_text() or "" if reader.pages else ""
                reporting_period = _extract_reporting_period(first_text, week_num, latest_year)
                full_text = "\n".join((p.extract_text() or "") for p in reader.pages)

                matches = ROW_PATTERN.findall(full_text)
                for uid, state_raw, district_raw, disease_raw, cases_str, deaths_str, start_str, rep_str, status_raw in matches:
                    uid = uid.strip()
                    if db.query(OfficialOutbreakReport.id).filter(OfficialOutbreakReport.unique_outbreak_id == uid).first():
                        duplicates_skipped += 1
                        continue

                    state = " ".join(state_raw.split()).strip()
                    district = " ".join(district_raw.split()).strip()
                    disease = _normalize_disease(disease_raw)
                    cases = int(cases_str)
                    deaths = int(deaths_str)
                    start_d = _parse_indian_date(start_str)
                    rep_d = _parse_indian_date(rep_str)
                    status_clean = " ".join(status_raw.split()).strip()

                    if cases < 0 or deaths < 0 or not disease or not district:
                        continue

                    reg_key = (state.lower(), district.lower())
                    region = existing_regions.get(reg_key)
                    if not region:
                        lat, lng, pop, geo_src = await _geocode_district(client, district, state)
                        code_parts = uid.split("/")
                        reg_code = f"{code_parts[0]}-{code_parts[1]}" if len(code_parts) >= 2 else f"IN-{len(existing_regions)+1}"
                        if db.query(Region.id).filter(Region.code == reg_code).first():
                            reg_code = f"{reg_code}-{len(existing_regions)+1}"
                        region = Region(
                            code=reg_code[:48],
                            name=district[:120],
                            state=state[:80],
                            latitude=lat,
                            longitude=lng,
                            population=pop,
                            geocode_source=geo_src,
                        )
                        db.add(region)
                        db.commit()
                        db.refresh(region)
                        existing_regions[reg_key] = region

                    report = OfficialOutbreakReport(
                        unique_outbreak_id=uid,
                        region_id=region.id,
                        state=state,
                        district=district,
                        disease=disease,
                        cases=cases,
                        deaths=deaths,
                        start_date=start_d,
                        reporting_date=rep_d,
                        reporting_week=week_num,
                        reporting_year=latest_year,
                        reporting_period=reporting_period,
                        outbreak_status=status_clean,
                        source_name="NCDC / IDSP Weekly Outbreak Report",
                        source_url=pdf_url,
                        source_document_id=doc_filename,
                        validation_status="validated",
                    )
                    db.add(report)
                    records_imported += 1

                    eff_date = rep_d or start_d or date.today()
                    if region.id not in regions_to_weather:
                        regions_to_weather[region.id] = (region, eff_date - timedelta(days=7), eff_date)
                    else:
                        r_obj, min_d, max_d = regions_to_weather[region.id]
                        regions_to_weather[region.id] = (r_obj, min(min_d, eff_date - timedelta(days=7)), max(max_d, eff_date))

                db.commit()

            # Fetch real Open-Meteo weather observations for newly synced regions (capped politely to keep sync fast)
            for _rid, (reg, min_d, max_d) in list(regions_to_weather.items())[:25]:
                weather_rows_added += await _fetch_open_meteo_weather(db, client, reg, min_d, max_d)
            db.commit()

            # Generate factual alerts from verified official IDSP reports
            _sync_alerts_from_official_reports(db)

        sync_run.status = "success"
        sync_run.documents_fetched = docs_fetched
        sync_run.records_imported = records_imported
        sync_run.duplicates_skipped = duplicates_skipped
        sync_run.completed_at = datetime.now(timezone.utc)
        db.commit()

        return {
            "status": "success",
            "source_name": sync_run.source_name,
            "source_url": NCDC_WEEKLY_URL,
            "documents_fetched": docs_fetched,
            "imported_pdfs": imported_pdfs,
            "records_imported": records_imported,
            "duplicates_skipped": duplicates_skipped,
            "weather_observations_added": weather_rows_added,
            "completed_at": sync_run.completed_at.isoformat(),
        }
    except Exception as exc:
        sync_run.status = "failed"
        sync_run.documents_fetched = docs_fetched
        sync_run.records_imported = records_imported
        sync_run.duplicates_skipped = duplicates_skipped
        sync_run.error_message = str(exc)
        sync_run.completed_at = datetime.now(timezone.utc)
        db.commit()
        raise RuntimeError(f"Public health synchronization failed: {exc}") from exc


def _sync_alerts_from_official_reports(db: Session) -> None:
    """Create alerts strictly from verified official IDSP outbreak reports (high case count or reported deaths)."""
    existing_keys = {
        a.source_outbreak_id
        for a in db.query(PublicHealthAlert).filter(PublicHealthAlert.source_outbreak_id.isnot(None)).all()
    }
    reports = (
        db.query(OfficialOutbreakReport)
        .order_by(OfficialOutbreakReport.reporting_year.desc(), OfficialOutbreakReport.reporting_week.desc())
        .all()
    )
    for rep in reports:
        if rep.unique_outbreak_id in existing_keys:
            continue
        if rep.deaths > 0 or rep.cases >= 40:
            severity = "critical" if (rep.deaths >= 2 or rep.cases >= 100) else "high"
            alert_type = "fatality_reported" if rep.deaths > 0 else "elevated_outbreak_cases"
            db.add(
                PublicHealthAlert(
                    region_id=rep.region_id,
                    source_outbreak_id=rep.unique_outbreak_id,
                    source_document_id=rep.source_document_id,
                    disease=rep.disease,
                    severity=severity,
                    alert_type=alert_type,
                    title=f"IDSP Week {rep.reporting_week}: {rep.disease} in {rep.district}, {rep.state}",
                    reason=f"Official IDSP report {rep.unique_outbreak_id} documented {rep.cases} case(s) and {rep.deaths} death(s) ({rep.reporting_period}). Status: {rep.outbreak_status}.",
                    recommended_action="Verify district Rapid Response Team (RRT) containment status and laboratory confirmation per IDSP protocol.",
                    metric_value=f"{rep.cases} cases / {rep.deaths} deaths",
                )
            )
    db.commit()
