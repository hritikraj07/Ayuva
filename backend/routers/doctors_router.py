import json
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import List, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.auth import get_current_user, get_optional_user, log_access, require_roles
from backend.config import get_settings
from backend.database import get_db
from backend.models import (
    Appointment,
    AvailabilityException,
    Clinic,
    Doctor,
    DoctorAvailability,
    DoctorReport,
    Speciality,
    User,
)
from backend.schemas import (
    AvailabilityExceptionCreate,
    DoctorProfileUpsert,
    DoctorReportIn,
    DoctorScheduleBulkUpdate,
    SpecialityMatchRequest,
)
from backend.services.doctor_booking_service import (
    compute_doctor_day_slots,
    create_notification,
    hhmm_to_minutes,
    serialize_appointment,
    serialize_doctor,
    suggest_speciality_with_ai,
    today_ist,
)
from backend.services.ocr_extraction import validate_upload_bytes

router = APIRouter(prefix="/api", tags=["Doctor Discovery & Scheduling"])
settings = get_settings()

PHOTO_DIR = settings.UPLOAD_DIR / "doctor_photos"
PHOTO_DIR.mkdir(parents=True, exist_ok=True)


@router.get("/specialities")
def list_specialities(db: Session = Depends(get_db)):
    items = (
        db.query(Speciality)
        .filter(Speciality.is_active.is_(True))
        .order_by(Speciality.name.asc())
        .all()
    )
    return {
        "specialities": [
            {
                "id": s.id,
                "name": s.name,
                "slug": s.slug,
                "description": s.description,
                "category": s.category,
            }
            for s in items
        ]
    }


@router.post("/doctors/speciality-match")
async def match_speciality_ai(
    payload: SpecialityMatchRequest,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    result = await suggest_speciality_with_ai(
        db=db,
        user=current_user,
        concern=payload.concern,
        use_vault_context=payload.use_vault_context if current_user.role_name == "patient" else False,
        follow_up_answers=payload.follow_up_answers,
    )
    if current_user.role_name == "patient":
        log_access(
            db,
            actor_user_id=current_user.id,
            actor_role=current_user.role_name,
            action="ai_speciality_match",
            resource_type="speciality_match",
            resource_id="gemini",
            details=f"vault_ctx={result.get('context_used')}, emergency={result.get('is_emergency')}",
        )
    return result


# ======================== DOCTOR SELF-MANAGEMENT PORTAL ========================

@router.get("/doctors/me/profile")
def get_my_doctor_profile(
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
):
    doctor = db.query(Doctor).filter(Doctor.user_id == current_user.id).first()
    if not doctor:
        return {"has_profile": False, "profile": None}
    return {"has_profile": True, "profile": serialize_doctor(db, doctor, include_next_slot=False)}


@router.put("/doctors/me/profile")
def upsert_my_doctor_profile(
    payload: DoctorProfileUpsert,
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
):
    spec = db.query(Speciality).filter(Speciality.id == payload.primary_speciality_id, Speciality.is_active.is_(True)).first()
    if not spec:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Invalid primary medical speciality.")

    valid_modes = [m for m in payload.consultation_modes if m in {"in_person", "online"}]
    if not valid_modes:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Select at least one valid consultation mode (in_person or online).")

    sec_ids: List[int] = []
    if payload.secondary_speciality_ids:
        existing_secs = (
            db.query(Speciality.id)
            .filter(Speciality.id.in_(payload.secondary_speciality_ids), Speciality.is_active.is_(True))
            .all()
        )
        sec_ids = [r[0] for r in existing_secs if r[0] != spec.id]

    clinic_id = payload.clinic_id
    if payload.clinic is not None:
        if clinic_id:
            clinic = db.query(Clinic).filter(Clinic.id == clinic_id, Clinic.owner_user_id == current_user.id).first()
            if not clinic:
                clinic = Clinic(owner_user_id=current_user.id, name=payload.clinic.name, address=payload.clinic.address, city=payload.clinic.city, state=payload.clinic.state, postal_code=payload.clinic.postal_code)
                db.add(clinic)
        else:
            clinic = db.query(Clinic).filter(Clinic.owner_user_id == current_user.id).first()
            if not clinic:
                clinic = Clinic(owner_user_id=current_user.id, name=payload.clinic.name, address=payload.clinic.address, city=payload.clinic.city, state=payload.clinic.state, postal_code=payload.clinic.postal_code)
                db.add(clinic)
        clinic.name = payload.clinic.name.strip()
        clinic.address = payload.clinic.address.strip()
        clinic.city = payload.clinic.city.strip()
        clinic.state = payload.clinic.state.strip()
        clinic.postal_code = payload.clinic.postal_code.strip()
        clinic.contact_information = payload.clinic.contact_information
        clinic.latitude = payload.clinic.latitude
        clinic.longitude = payload.clinic.longitude
        db.flush()
        clinic_id = clinic.id
    elif clinic_id:
        clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
        if not clinic:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Referenced clinic not found.")

    doctor = db.query(Doctor).filter(Doctor.user_id == current_user.id).first()
    reg_clean = payload.registration_number.strip()
    is_new = doctor is None

    if doctor is None:
        doctor = Doctor(
            user_id=current_user.id,
            full_name=payload.full_name.strip(),
            qualifications=payload.qualifications.strip(),
            registration_number=reg_clean,
            primary_speciality_id=spec.id,
            secondary_speciality_ids_json=json.dumps(sec_ids),
            experience_years=payload.experience_years,
            consultation_fee=payload.consultation_fee,
            consultation_modes_json=json.dumps(valid_modes),
            languages_json=json.dumps([l.strip() for l in payload.languages if l.strip()] or ["English"]),
            biography=payload.biography.strip(),
            clinic_id=clinic_id,
            contact_phone=payload.contact_phone,
            auto_confirm=payload.auto_confirm,
            verification_status="pending_verification",
        )
        db.add(doctor)
    else:
        # Modifying registration number or qualifications resets verification status for safety
        credentials_changed = (
            doctor.registration_number != reg_clean
            or doctor.qualifications != payload.qualifications.strip()
            or doctor.primary_speciality_id != spec.id
        )
        doctor.full_name = payload.full_name.strip()
        doctor.qualifications = payload.qualifications.strip()
        doctor.registration_number = reg_clean
        doctor.primary_speciality_id = spec.id
        doctor.secondary_speciality_ids_json = json.dumps(sec_ids)
        doctor.experience_years = payload.experience_years
        doctor.consultation_fee = payload.consultation_fee
        doctor.consultation_modes_json = json.dumps(valid_modes)
        doctor.languages_json = json.dumps([l.strip() for l in payload.languages if l.strip()] or ["English"])
        doctor.biography = payload.biography.strip()
        doctor.clinic_id = clinic_id
        doctor.contact_phone = payload.contact_phone
        doctor.auto_confirm = payload.auto_confirm
        if credentials_changed or doctor.verification_status == "rejected":
            doctor.verification_status = "pending_verification"
            doctor.verified_at = None
            doctor.verified_by_user_id = None

    current_user.full_name = payload.full_name.strip()
    current_user.specialty_or_department = spec.name
    db.flush()

    if is_new or doctor.verification_status == "pending_verification":
        admins = db.query(User).filter(User.role_name == "admin", User.is_active.is_(True)).all()
        for adm in admins:
            create_notification(
                db,
                recipient_user_id=adm.id,
                notification_type="doctor_verification_requested",
                title="Doctor Verification Pending",
                message=f"Dr. {doctor.full_name} ({spec.name}, Reg: {doctor.registration_number}) submitted credentials for review.",
                related_entity_type="doctor",
                related_entity_id=doctor.id,
            )

    db.commit()
    db.refresh(doctor)
    log_access(
        db,
        actor_user_id=current_user.id,
        actor_role=current_user.role_name,
        action="doctor_profile_saved",
        resource_type="doctor",
        resource_id=str(doctor.id),
        details=f"status={doctor.verification_status}",
    )
    return {"has_profile": True, "profile": serialize_doctor(db, doctor, include_next_slot=False)}


@router.post("/doctors/me/photo")
async def upload_doctor_photo(
    photo: UploadFile = File(...),
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
):
    doctor = db.query(Doctor).filter(Doctor.user_id == current_user.id).first()
    if not doctor:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Complete your doctor profile before uploading a photograph.")

    raw = await photo.read()
    try:
        ext, _mime = validate_upload_bytes(photo.filename or "photo.png", raw)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
    if ext.lower() not in {".png", ".jpg", ".jpeg"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Doctor profile photo must be a PNG or JPG image.")

    filename = f"doc_{doctor.id}_{uuid4().hex[:10]}{ext.lower()}"
    dest = PHOTO_DIR / filename
    dest.write_bytes(raw)
    doctor.photo_filename = filename
    db.commit()
    return {"photo_url": f"/api/doctors/{doctor.id}/photo"}


@router.get("/doctors/me/schedule")
def get_my_schedule(
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
):
    doctor = db.query(Doctor).filter(Doctor.user_id == current_user.id).first()
    if not doctor:
        return {"has_profile": False, "windows": [], "exceptions": []}

    windows = (
        db.query(DoctorAvailability)
        .filter(DoctorAvailability.doctor_id == doctor.id)
        .order_by(DoctorAvailability.weekday.asc(), DoctorAvailability.start_time.asc())
        .all()
    )
    exceptions = (
        db.query(AvailabilityException)
        .filter(AvailabilityException.doctor_id == doctor.id)
        .order_by(AvailabilityException.date.asc())
        .all()
    )
    return {
        "has_profile": True,
        "doctor_id": doctor.id,
        "windows": [
            {
                "id": w.id,
                "weekday": w.weekday,
                "start_time": w.start_time,
                "end_time": w.end_time,
                "slot_duration": w.slot_duration,
                "break_periods": json.loads(w.break_periods or "[]"),
                "buffer_duration": w.buffer_duration,
                "consultation_modes": json.loads(w.consultation_modes_json or '["in_person"]'),
                "active_status": w.active_status,
            }
            for w in windows
        ],
        "exceptions": [
            {
                "id": e.id,
                "date": e.date.isoformat(),
                "start_time": e.start_time,
                "end_time": e.end_time,
                "exception_type": e.exception_type,
                "slot_duration": e.slot_duration,
                "reason": e.reason,
            }
            for e in exceptions
        ],
    }


@router.put("/doctors/me/schedule")
def replace_my_schedule(
    payload: DoctorScheduleBulkUpdate,
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
):
    doctor = db.query(Doctor).filter(Doctor.user_id == current_user.id).first()
    if not doctor:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please create your doctor profile first.")

    for w in payload.windows:
        if hhmm_to_minutes(w.end_time) <= hhmm_to_minutes(w.start_time):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"End time {w.end_time} must be after start time {w.start_time}.",
            )
        for br in w.break_periods:
            if hhmm_to_minutes(br.end) <= hhmm_to_minutes(br.start):
                raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Break end time must be after break start time.")

    db.query(DoctorAvailability).filter(DoctorAvailability.doctor_id == doctor.id).delete()
    for w in payload.windows:
        db.add(
            DoctorAvailability(
                doctor_id=doctor.id,
                clinic_id=doctor.clinic_id,
                weekday=w.weekday,
                start_time=w.start_time,
                end_time=w.end_time,
                slot_duration=w.slot_duration,
                break_periods=json.dumps([b.model_dump() for b in w.break_periods]),
                buffer_duration=w.buffer_duration,
                consultation_modes_json=json.dumps(w.consultation_modes or ["in_person", "online"]),
                active_status=w.active_status,
            )
        )
    db.commit()
    return get_my_schedule(current_user=current_user, db=db)


@router.post("/doctors/me/exceptions", status_code=status.HTTP_201_CREATED)
def add_schedule_exception(
    payload: AvailabilityExceptionCreate,
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
):
    doctor = db.query(Doctor).filter(Doctor.user_id == current_user.id).first()
    if not doctor:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Please create your doctor profile first.")

    if (payload.start_time and not payload.end_time) or (payload.end_time and not payload.start_time):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Provide both start_time and end_time for windowed exceptions, or omit both for full day.")
    if payload.start_time and payload.end_time and hhmm_to_minutes(payload.end_time) <= hhmm_to_minutes(payload.start_time):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Exception end_time must be after start_time.")
    if payload.exception_type == "extra_availability" and (not payload.start_time or not payload.end_time):
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="extra_availability requires start_time and end_time.")

    exc = AvailabilityException(
        doctor_id=doctor.id,
        date=payload.date,
        start_time=payload.start_time,
        end_time=payload.end_time,
        exception_type=payload.exception_type,
        slot_duration=payload.slot_duration,
        reason=payload.reason.strip() if payload.reason else None,
    )
    db.add(exc)
    db.commit()
    db.refresh(exc)
    return {
        "id": exc.id,
        "date": exc.date.isoformat(),
        "start_time": exc.start_time,
        "end_time": exc.end_time,
        "exception_type": exc.exception_type,
        "slot_duration": exc.slot_duration,
        "reason": exc.reason,
    }


@router.delete("/doctors/me/exceptions/{exc_id}")
def delete_schedule_exception(
    exc_id: int,
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
):
    doctor = db.query(Doctor).filter(Doctor.user_id == current_user.id).first()
    if not doctor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Doctor profile not found.")
    exc = db.query(AvailabilityException).filter(AvailabilityException.id == exc_id, AvailabilityException.doctor_id == doctor.id).first()
    if not exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Exception not found.")
    db.delete(exc)
    db.commit()
    return {"deleted": True, "id": exc_id}


@router.get("/doctors/me/calendar")
def get_my_doctor_calendar(
    start_date: Optional[date] = Query(default=None),
    days: int = Query(default=7, ge=1, le=31),
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
):
    doctor = db.query(Doctor).filter(Doctor.user_id == current_user.id).first()
    if not doctor:
        return {"has_profile": False, "timezone": "Asia/Kolkata", "days": [], "appointments": []}

    start_d = start_date or today_ist()
    end_d = start_d + timedelta(days=days - 1)
    day_entries = [
        compute_doctor_day_slots(db, doctor=doctor, target_date=start_d + timedelta(days=i), include_past_status=True)
        for i in range(days)
    ]
    appts = (
        db.query(Appointment)
        .filter(
            Appointment.doctor_id == doctor.id,
            Appointment.appointment_date >= start_d,
            Appointment.appointment_date <= end_d,
        )
        .order_by(Appointment.appointment_date.asc(), Appointment.start_time.asc())
        .all()
    )
    return {
        "has_profile": True,
        "timezone": "Asia/Kolkata",
        "start_date": start_d.isoformat(),
        "days": day_entries,
        "appointments": [serialize_appointment(db, a) for a in appts],
    }


# ======================== PATIENT DISCOVERY & PROFILE ENDPOINTS ========================

@router.get("/doctors")
def discover_doctors(
    q: Optional[str] = Query(default=None, max_length=120),
    speciality_id: Optional[int] = Query(default=None),
    city: Optional[str] = Query(default=None, max_length=100),
    pin_code: Optional[str] = Query(default=None, max_length=24),
    lat: Optional[float] = Query(default=None, ge=-90.0, le=90.0),
    lng: Optional[float] = Query(default=None, ge=-180.0, le=180.0),
    max_distance_km: Optional[float] = Query(default=None, ge=1.0, le=500.0),
    min_fee: Optional[float] = Query(default=None, ge=0.0),
    max_fee: Optional[float] = Query(default=None, ge=0.0),
    min_experience: Optional[int] = Query(default=None, ge=0),
    available_date: Optional[date] = Query(default=None),
    time_of_day: Optional[str] = Query(default=None),  # morning | afternoon | evening
    consultation_mode: Optional[str] = Query(default=None),  # in_person | online
    language: Optional[str] = Query(default=None, max_length=64),
    verified_only: bool = Query(default=True),
    db: Session = Depends(get_db),
):
    # Enforce strict policy: public/patient discovery only returns verified active profiles
    query = db.query(Doctor).filter(Doctor.verification_status == "verified")
    if speciality_id is not None:
        # Match primary speciality or verified secondary specialities
        all_docs = query.all()
    else:
        all_docs = query.order_by(Doctor.experience_years.desc(), Doctor.id.asc()).all()

    results = []
    q_low = q.strip().lower() if q else None
    city_low = city.strip().lower() if city else None
    pin_clean = pin_code.strip().lower() if pin_code else None
    lang_low = language.strip().lower() if language else None

    for doc in all_docs:
        sec_ids = json.loads(doc.secondary_speciality_ids_json or "[]")
        if speciality_id is not None and doc.primary_speciality_id != speciality_id and speciality_id not in sec_ids:
            continue
        if min_fee is not None and doc.consultation_fee < min_fee:
            continue
        if max_fee is not None and doc.consultation_fee > max_fee:
            continue
        if min_experience is not None and doc.experience_years < min_experience:
            continue

        modes = json.loads(doc.consultation_modes_json or '["in_person"]')
        if consultation_mode and consultation_mode not in modes:
            continue

        langs = [l.lower() for l in json.loads(doc.languages_json or '["English"]')]
        if lang_low and not any(lang_low in l for l in langs):
            continue

        serialized = serialize_doctor(db, doc, include_next_slot=True, user_lat=lat, user_lng=lng)
        clinic = serialized.get("clinic") or {}

        if city_low:
            hay = f"{clinic.get('city', '')} {clinic.get('state', '')} {clinic.get('address', '')}".lower()
            if city_low not in hay:
                continue
        if pin_clean and pin_clean not in str(clinic.get("postal_code") or "").lower():
            continue
        if max_distance_km is not None and lat is not None and lng is not None:
            dist = serialized.get("distance_km")
            if dist is None or dist > max_distance_km:
                continue

        if q_low:
            spec_name = (serialized.get("primary_speciality") or {}).get("name", "")
            sec_names = " ".join(s["name"] for s in serialized.get("secondary_specialities", []))
            search_blob = (
                f"{serialized['full_name']} {serialized['qualifications']} {spec_name} {sec_names} "
                f"{clinic.get('name', '')} {clinic.get('city', '')} {clinic.get('address', '')} {clinic.get('postal_code', '')}"
            ).lower()
            if q_low not in search_blob:
                continue

        if available_date or time_of_day:
            target_d = available_date or today_ist()
            day_slots = compute_doctor_day_slots(
                db,
                doctor=doc,
                target_date=target_d,
                consultation_type=consultation_mode,
            )
            free = [s for s in day_slots["slots"] if s["is_available"]]
            if time_of_day == "morning":
                free = [s for s in free if hhmm_to_minutes(s["start_time"]) < 12 * 60]
            elif time_of_day == "afternoon":
                free = [s for s in free if 12 * 60 <= hhmm_to_minutes(s["start_time"]) < 17 * 60]
            elif time_of_day == "evening":
                free = [s for s in free if hhmm_to_minutes(s["start_time"]) >= 17 * 60]
            if not free:
                continue
            serialized["matching_date_slots_count"] = len(free)

        results.append(serialized)

    if lat is not None and lng is not None:
        results.sort(key=lambda item: (item["distance_km"] is None, item["distance_km"] or 999999.0))

    return {
        "doctors": results,
        "total": len(results),
        "verified_only_enforced": True if verified_only else True,
        "timezone": "Asia/Kolkata",
    }


@router.get("/doctors/{doctor_id}")
def get_doctor_profile(doctor_id: int, db: Session = Depends(get_db)):
    doctor = db.query(Doctor).filter(Doctor.id == doctor_id, Doctor.verification_status == "verified").first()
    if not doctor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Verified doctor profile not found.")

    windows = (
        db.query(DoctorAvailability)
        .filter(DoctorAvailability.doctor_id == doctor.id, DoctorAvailability.active_status.is_(True))
        .order_by(DoctorAvailability.weekday.asc(), DoctorAvailability.start_time.asc())
        .all()
    )
    start_d = today_ist()
    availability_preview = [
        compute_doctor_day_slots(db, doctor=doctor, target_date=start_d + timedelta(days=i))
        for i in range(7)
    ]

    data = serialize_doctor(db, doctor, include_next_slot=True)
    data["working_hours"] = [
        {
            "weekday": w.weekday,
            "start_time": w.start_time,
            "end_time": w.end_time,
            "slot_duration": w.slot_duration,
            "buffer_duration": w.buffer_duration,
            "consultation_modes": json.loads(w.consultation_modes_json or '["in_person"]'),
        }
        for w in windows
    ]
    data["availability_preview"] = availability_preview
    data["timezone"] = "Asia/Kolkata"
    return data


@router.get("/doctors/{doctor_id}/availability")
def get_doctor_availability_for_date(
    doctor_id: int,
    target_date: Optional[date] = Query(default=None, alias="date"),
    consultation_type: Optional[str] = Query(default=None),
    db: Session = Depends(get_db),
):
    doctor = db.query(Doctor).filter(Doctor.id == doctor_id, Doctor.verification_status == "verified").first()
    if not doctor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Verified doctor profile not found.")
    d = target_date or today_ist()
    return compute_doctor_day_slots(db, doctor=doctor, target_date=d, consultation_type=consultation_type)


@router.get("/doctors/{doctor_id}/photo")
def get_doctor_photo(doctor_id: int, db: Session = Depends(get_db)):
    doctor = db.query(Doctor).filter(Doctor.id == doctor_id).first()
    if not doctor or not doctor.photo_filename:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Doctor photo not found.")
    path = PHOTO_DIR / doctor.photo_filename
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Doctor photo missing from storage.")
    return FileResponse(path=path)


@router.post("/doctors/{doctor_id}/report", status_code=status.HTTP_201_CREATED)
def report_doctor_profile(
    doctor_id: int,
    payload: DoctorReportIn,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    doctor = db.query(Doctor).filter(Doctor.id == doctor_id).first()
    if not doctor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Doctor profile not found.")
    report = DoctorReport(
        doctor_id=doctor.id,
        reporter_user_id=current_user.id,
        reason=payload.reason.strip(),
        status="open",
    )
    doctor.report_count = (doctor.report_count or 0) + 1
    db.add(report)
    db.commit()
    log_access(
        db,
        actor_user_id=current_user.id,
        actor_role=current_user.role_name,
        action="doctor_profile_reported",
        resource_type="doctor",
        resource_id=str(doctor.id),
    )
    return {"id": report.id, "status": report.status}
