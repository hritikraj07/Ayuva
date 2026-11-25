import asyncio
import json
import math
from datetime import date, datetime, time, timedelta, timezone
from typing import Any, Dict, List, Optional, Tuple
from zoneinfo import ZoneInfo

from google.genai import types as genai_types
from sqlalchemy.exc import IntegrityError
from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.models import (
    Appointment,
    AvailabilityException,
    Clinic,
    Doctor,
    DoctorAvailability,
    Notification,
    PatientProfile,
    Speciality,
    User,
)
from backend.services.assistant_service import (
    EMERGENCY_KEYWORDS,
    GeminiServiceError,
    _call_gemini_sync,
    _select_relevant_patient_context,
    get_active_gemini_key,
    get_active_gemini_model,
)

settings = get_settings()
IST_TZ = ZoneInfo("Asia/Kolkata")
CANCELLATION_MIN_NOTICE_MINUTES = 60


class BookingConflictError(Exception):
    """Raised when an appointment slot is unavailable or claimed concurrently."""


class BookingValidationError(Exception):
    """Raised for invalid scheduling, verification, or policy actions."""


def now_ist() -> datetime:
    return datetime.now(IST_TZ)


def today_ist() -> date:
    return now_ist().date()


def parse_hhmm(value: str) -> time:
    hh, mm = value.split(":")
    return time(hour=int(hh), minute=int(mm))


def hhmm_to_minutes(value: str) -> int:
    hh, mm = value.split(":")
    return int(hh) * 60 + int(mm)


def minutes_to_hhmm(total_minutes: int) -> str:
    return f"{total_minutes // 60:02d}:{total_minutes % 60:02d}"


def slot_to_utc(appt_date: date, start_hhmm: str, end_hhmm: str) -> Tuple[datetime, datetime]:
    start_ist = datetime.combine(appt_date, parse_hhmm(start_hhmm), tzinfo=IST_TZ)
    end_ist = datetime.combine(appt_date, parse_hhmm(end_hhmm), tzinfo=IST_TZ)
    return start_ist.astimezone(timezone.utc), end_ist.astimezone(timezone.utc)


def make_active_slot_key(doctor_id: int, appt_date: date, start_hhmm: str) -> str:
    return f"{doctor_id}:{appt_date.isoformat()}:{start_hhmm}"


def haversine_km(lat1: float, lng1: float, lat2: float, lng2: float) -> float:
    r = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lam = math.radians(lng2 - lng1)
    a = math.sin(d_phi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(d_lam / 2) ** 2
    return 2 * r * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def create_notification(
    db: Session,
    *,
    recipient_user_id: int,
    notification_type: str,
    title: str,
    message: str,
    related_entity_type: Optional[str] = None,
    related_entity_id: Optional[int] = None,
) -> Notification:
    notif = Notification(
        recipient_user_id=recipient_user_id,
        notification_type=notification_type,
        title=title[:200],
        message=message,
        related_entity_type=related_entity_type,
        related_entity_id=related_entity_id,
        read_status=False,
    )
    db.add(notif)
    return notif


def _safe_json_list(raw: Optional[str]) -> List[Any]:
    try:
        parsed = json.loads(raw or "[]")
        return parsed if isinstance(parsed, list) else []
    except Exception:
        return []


def compute_doctor_day_slots(
    db: Session,
    *,
    doctor: Doctor,
    target_date: date,
    consultation_type: Optional[str] = None,
    include_past_status: bool = False,
) -> Dict[str, Any]:
    """Compute real slots for a single Asia/Kolkata date from DoctorAvailability, AvailabilityException, and active Appointments."""
    weekday = target_date.weekday()
    windows = (
        db.query(DoctorAvailability)
        .filter(
            DoctorAvailability.doctor_id == doctor.id,
            DoctorAvailability.weekday == weekday,
            DoctorAvailability.active_status.is_(True),
        )
        .order_by(DoctorAvailability.start_time.asc())
        .all()
    )
    exceptions = (
        db.query(AvailabilityException)
        .filter(
            AvailabilityException.doctor_id == doctor.id,
            AvailabilityException.date == target_date,
        )
        .all()
    )

    full_day_off = next(
        (
            e
            for e in exceptions
            if e.exception_type in {"holiday", "leave", "blocked"} and (not e.start_time or not e.end_time)
        ),
        None,
    )
    if full_day_off:
        return {
            "date": target_date.isoformat(),
            "timezone": "Asia/Kolkata",
            "day_status": full_day_off.exception_type,
            "reason": full_day_off.reason or f"Doctor marked {full_day_off.exception_type}.",
            "slots": [],
        }

    blocked_ranges: List[Tuple[int, int]] = []
    extra_windows: List[Dict[str, Any]] = []
    for e in exceptions:
        if e.exception_type in {"blocked", "holiday", "leave"} and e.start_time and e.end_time:
            blocked_ranges.append((hhmm_to_minutes(e.start_time), hhmm_to_minutes(e.end_time)))
        elif e.exception_type == "extra_availability" and e.start_time and e.end_time:
            extra_windows.append(
                {
                    "start_min": hhmm_to_minutes(e.start_time),
                    "end_min": hhmm_to_minutes(e.end_time),
                    "slot_duration": e.slot_duration or 20,
                    "buffer_duration": 0,
                    "breaks": [],
                    "modes": _safe_json_list(doctor.consultation_modes_json) or ["in_person", "online"],
                }
            )

    active_appointments = (
        db.query(Appointment)
        .filter(
            Appointment.doctor_id == doctor.id,
            Appointment.appointment_date == target_date,
            Appointment.appointment_status.in_(["pending", "confirmed"]),
        )
        .all()
    )
    occupied_by_start = {a.start_time: a.appointment_status for a in active_appointments}

    doctor_modes = _safe_json_list(doctor.consultation_modes_json) or ["in_person"]
    schedule_blocks = [
        {
            "start_min": hhmm_to_minutes(w.start_time),
            "end_min": hhmm_to_minutes(w.end_time),
            "slot_duration": w.slot_duration,
            "buffer_duration": w.buffer_duration,
            "breaks": [(hhmm_to_minutes(b["start"]), hhmm_to_minutes(b["end"])) for b in _safe_json_list(w.break_periods) if isinstance(b, dict) and "start" in b and "end" in b],
            "modes": [m for m in (_safe_json_list(w.consultation_modes_json) or doctor_modes) if m in doctor_modes] or doctor_modes,
        }
        for w in windows
    ] + extra_windows

    current_ist = now_ist()
    slots: List[Dict[str, Any]] = []
    seen_starts = set()

    for blk in schedule_blocks:
        step = blk["slot_duration"] + blk["buffer_duration"]
        if step <= 0 or blk["end_min"] <= blk["start_min"]:
            continue
        cursor = blk["start_min"]
        while cursor + blk["slot_duration"] <= blk["end_min"]:
            s_min = cursor
            e_min = cursor + blk["slot_duration"]
            cursor += step

            # Skip break periods
            if any(s_min < b_end and e_min > b_start for b_start, b_end in blk["breaks"]):
                continue

            start_str = minutes_to_hhmm(s_min)
            end_str = minutes_to_hhmm(e_min)
            if start_str in seen_starts:
                continue
            seen_starts.add(start_str)

            if consultation_type and consultation_type not in blk["modes"]:
                continue

            is_blocked = any(s_min < x_end and e_min > x_start for x_start, x_end in blocked_ranges)
            slot_dt_ist = datetime.combine(target_date, parse_hhmm(start_str), tzinfo=IST_TZ)
            is_past = slot_dt_ist <= current_ist
            booked_state = occupied_by_start.get(start_str)

            if booked_state:
                slot_status = booked_state  # "pending" | "confirmed"
            elif is_blocked:
                slot_status = "blocked"
            elif is_past:
                slot_status = "past"
            else:
                slot_status = "available"

            if is_past and not include_past_status:
                continue

            slots.append(
                {
                    "start_time": start_str,
                    "end_time": end_str,
                    "duration_minutes": blk["slot_duration"],
                    "consultation_modes": blk["modes"],
                    "is_available": slot_status == "available",
                    "slot_status": slot_status,
                }
            )

    slots.sort(key=lambda item: item["start_time"])
    return {
        "date": target_date.isoformat(),
        "timezone": "Asia/Kolkata",
        "day_status": "working" if schedule_blocks else "off_day",
        "reason": None,
        "slots": slots,
    }


def find_next_available_slot(
    db: Session,
    *,
    doctor: Doctor,
    consultation_type: Optional[str] = None,
    horizon_days: int = 14,
) -> Optional[Dict[str, Any]]:
    start_day = today_ist()
    for offset in range(horizon_days):
        d = start_day + timedelta(days=offset)
        day_info = compute_doctor_day_slots(db, doctor=doctor, target_date=d, consultation_type=consultation_type)
        free_slot = next((s for s in day_info["slots"] if s["is_available"]), None)
        if free_slot:
            return {
                "date": d.isoformat(),
                "start_time": free_slot["start_time"],
                "end_time": free_slot["end_time"],
                "consultation_modes": free_slot["consultation_modes"],
            }
    return None


def serialize_clinic(clinic: Optional[Clinic]) -> Optional[Dict[str, Any]]:
    if not clinic:
        return None
    return {
        "id": clinic.id,
        "name": clinic.name,
        "address": clinic.address,
        "city": clinic.city,
        "state": clinic.state,
        "postal_code": clinic.postal_code,
        "contact_information": clinic.contact_information,
        "latitude": clinic.latitude,
        "longitude": clinic.longitude,
    }


def serialize_doctor(
    db: Session,
    doctor: Doctor,
    *,
    include_next_slot: bool = True,
    user_lat: Optional[float] = None,
    user_lng: Optional[float] = None,
) -> Dict[str, Any]:
    spec_map = {s.id: s for s in db.query(Speciality).all()}
    primary = spec_map.get(doctor.primary_speciality_id)
    secondary_ids = _safe_json_list(doctor.secondary_speciality_ids_json)
    secondary_specs = [
        {"id": sid, "name": spec_map[sid].name}
        for sid in secondary_ids
        if sid in spec_map
    ]
    clinic = doctor.clinic or (db.query(Clinic).filter(Clinic.id == doctor.clinic_id).first() if doctor.clinic_id else None)
    distance_km: Optional[float] = None
    if user_lat is not None and user_lng is not None and clinic and clinic.latitude is not None and clinic.longitude is not None:
        distance_km = round(haversine_km(user_lat, user_lng, clinic.latitude, clinic.longitude), 2)

    next_slot = find_next_available_slot(db, doctor=doctor) if include_next_slot and doctor.verification_status == "verified" else None

    return {
        "id": doctor.id,
        "user_id": doctor.user_id,
        "full_name": doctor.full_name,
        "qualifications": doctor.qualifications,
        "registration_number": doctor.registration_number if doctor.verification_status == "verified" else None,
        "registration_number_masked": (
            f"***{doctor.registration_number[-4:]}" if doctor.registration_number and len(doctor.registration_number) >= 4 else doctor.registration_number
        ),
        "primary_speciality": {
            "id": primary.id,
            "name": primary.name,
            "slug": primary.slug,
            "category": primary.category,
        }
        if primary
        else None,
        "secondary_specialities": secondary_specs if doctor.verification_status == "verified" else [],
        "experience_years": doctor.experience_years,
        "consultation_fee": doctor.consultation_fee,
        "consultation_modes": _safe_json_list(doctor.consultation_modes_json) or ["in_person"],
        "languages": _safe_json_list(doctor.languages_json) or ["English"],
        "biography": doctor.biography,
        "contact_phone": doctor.contact_phone,
        "auto_confirm": doctor.auto_confirm,
        "has_photo": bool(doctor.photo_filename),
        "photo_url": f"/api/doctors/{doctor.id}/photo" if doctor.photo_filename else None,
        "clinic": serialize_clinic(clinic),
        "distance_km": distance_km,
        "verification_status": doctor.verification_status,
        "verification_notes": doctor.verification_notes,
        "verified_at": doctor.verified_at.isoformat() if doctor.verified_at else None,
        "next_available_slot": next_slot,
        "created_at": doctor.created_at.isoformat(),
    }


def serialize_appointment(db: Session, appt: Appointment) -> Dict[str, Any]:
    doctor = appt.doctor or db.query(Doctor).filter(Doctor.id == appt.doctor_id).first()
    clinic = appt.clinic or (db.query(Clinic).filter(Clinic.id == appt.clinic_id).first() if appt.clinic_id else None)
    patient = db.query(User).filter(User.id == appt.patient_id).first()
    spec = db.query(Speciality).filter(Speciality.id == doctor.primary_speciality_id).first() if doctor else None
    doctor_user = db.query(User).filter(User.id == doctor.user_id).first() if doctor else None

    return {
        "id": appt.id,
        "patient_id": appt.patient_id,
        "patient_name": patient.full_name if patient else "Patient",
        "doctor_id": appt.doctor_id,
        "doctor_user_id": doctor.user_id if doctor else None,
        "doctor_email": doctor_user.email if doctor_user else None,
        "doctor_name": doctor.full_name if doctor else "Doctor",
        "doctor_speciality": spec.name if spec else None,
        "doctor_qualifications": doctor.qualifications if doctor else None,
        "clinic": serialize_clinic(clinic),
        "appointment_date": appt.appointment_date.isoformat(),
        "start_time": appt.start_time,
        "end_time": appt.end_time,
        "timezone": appt.timezone_name,
        "slot_start_utc": appt.slot_start_utc.isoformat(),
        "slot_end_utc": appt.slot_end_utc.isoformat(),
        "consultation_type": appt.consultation_type,
        "appointment_status": appt.appointment_status,
        "consultation_fee": appt.consultation_fee,
        "patient_notes": appt.patient_notes,
        "doctor_notes": appt.doctor_notes,
        "cancellation_reason": appt.cancellation_reason,
        "rescheduled_from_id": appt.rescheduled_from_id,
        "share_session_id": appt.share_session_id,
        "created_at": appt.created_at.isoformat(),
        "updated_at": appt.updated_at.isoformat(),
    }


def book_appointment_atomic(
    db: Session,
    *,
    patient: User,
    doctor_id: int,
    appt_date: date,
    start_time: str,
    consultation_type: str,
    patient_notes: Optional[str],
) -> Appointment:
    """Atomically validate slot availability and lock the slot via DB transaction + UNIQUE active_slot_key."""
    query = db.query(Doctor).filter(Doctor.id == doctor_id)
    if not settings.is_sqlite:
        query = query.with_for_update()
    doctor = query.first()
    if not doctor or doctor.verification_status != "verified":
        raise BookingValidationError("Doctor profile is unavailable or not yet verified.")

    if doctor.user_id == patient.id:
        raise BookingValidationError("You cannot book an appointment with your own clinician account.")

    day_info = compute_doctor_day_slots(
        db,
        doctor=doctor,
        target_date=appt_date,
        consultation_type=consultation_type,
    )
    matching_slot = next((s for s in day_info["slots"] if s["start_time"] == start_time), None)
    if not matching_slot:
        raise BookingConflictError("Selected appointment slot is unavailable on this date for the chosen consultation mode.")
    if not matching_slot["is_available"]:
        raise BookingConflictError(f"This slot is no longer available (status: {matching_slot['slot_status']}). Please select another slot.")

    slot_start_utc, slot_end_utc = slot_to_utc(appt_date, matching_slot["start_time"], matching_slot["end_time"])
    initial_status = "confirmed" if doctor.auto_confirm else "pending"
    active_key = make_active_slot_key(doctor.id, appt_date, matching_slot["start_time"])

    appt = Appointment(
        patient_id=patient.id,
        doctor_id=doctor.id,
        clinic_id=doctor.clinic_id,
        appointment_date=appt_date,
        start_time=matching_slot["start_time"],
        end_time=matching_slot["end_time"],
        slot_start_utc=slot_start_utc,
        slot_end_utc=slot_end_utc,
        timezone_name="Asia/Kolkata",
        consultation_type=consultation_type,
        appointment_status=initial_status,
        consultation_fee=doctor.consultation_fee,
        patient_notes=patient_notes.strip() if patient_notes else None,
        active_slot_key=active_key,
    )
    db.add(appt)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise BookingConflictError("This slot was just booked by another patient. Please select another available slot.") from exc

    create_notification(
        db,
        recipient_user_id=patient.id,
        notification_type=f"appointment_{initial_status}",
        title="Appointment Confirmed" if initial_status == "confirmed" else "Appointment Request Submitted",
        message=(
            f"Your {consultation_type.replace('_', ' ')} consultation with {doctor.full_name} on "
            f"{appt_date.isoformat()} at {matching_slot['start_time']} IST is {initial_status}."
        ),
        related_entity_type="appointment",
        related_entity_id=appt.id,
    )
    create_notification(
        db,
        recipient_user_id=doctor.user_id,
        notification_type="new_appointment",
        title="New Confirmed Appointment" if initial_status == "confirmed" else "New Appointment Request",
        message=(
            f"{patient.full_name} scheduled a {consultation_type.replace('_', ' ')} slot on "
            f"{appt_date.isoformat()} at {matching_slot['start_time']} IST."
        ),
        related_entity_type="appointment",
        related_entity_id=appt.id,
    )
    db.commit()
    db.refresh(appt)
    return appt


def cancel_appointment(
    db: Session,
    *,
    appt: Appointment,
    actor: User,
    reason: Optional[str],
) -> Appointment:
    if appt.appointment_status not in {"pending", "confirmed"}:
        raise BookingValidationError(f"Cannot cancel an appointment with status '{appt.appointment_status}'.")

    # Patients must abide by minimum cancellation notice window before start time
    if actor.role_name == "patient":
        slot_start_utc = appt.slot_start_utc
        if slot_start_utc.tzinfo is None:
            slot_start_utc = slot_start_utc.replace(tzinfo=timezone.utc)
        minutes_remaining = (slot_start_utc - datetime.now(timezone.utc)).total_seconds() / 60.0
        if minutes_remaining < CANCELLATION_MIN_NOTICE_MINUTES:
            raise BookingValidationError(
                f"Cancellation policy requires at least {CANCELLATION_MIN_NOTICE_MINUTES} minutes notice before the scheduled slot."
            )

    doctor = db.query(Doctor).filter(Doctor.id == appt.doctor_id).first()
    appt.appointment_status = "cancelled"
    appt.active_slot_key = None
    appt.cancellation_reason = reason.strip() if reason else f"Cancelled by {actor.role_name}"

    if doctor:
        other_uid = doctor.user_id if actor.id == appt.patient_id else appt.patient_id
        create_notification(
            db,
            recipient_user_id=other_uid,
            notification_type="appointment_cancelled",
            title="Appointment Cancelled",
            message=(
                f"Appointment on {appt.appointment_date.isoformat()} at {appt.start_time} IST was cancelled"
                f"{f': {appt.cancellation_reason}' if appt.cancellation_reason else '.'}"
            ),
            related_entity_type="appointment",
            related_entity_id=appt.id,
        )

    db.commit()
    db.refresh(appt)
    return appt


def reschedule_appointment_atomic(
    db: Session,
    *,
    appt: Appointment,
    actor: User,
    new_date: date,
    new_start_time: str,
    consultation_type: Optional[str],
    reason: Optional[str],
) -> Appointment:
    if appt.appointment_status not in {"pending", "confirmed"}:
        raise BookingValidationError(f"Cannot reschedule an appointment with status '{appt.appointment_status}'.")

    query = db.query(Doctor).filter(Doctor.id == appt.doctor_id)
    if not settings.is_sqlite:
        query = query.with_for_update()
    doctor = query.first()
    if not doctor or doctor.verification_status != "verified":
        raise BookingValidationError("Doctor profile is unavailable for rescheduling.")

    target_mode = consultation_type or appt.consultation_type
    day_info = compute_doctor_day_slots(db, doctor=doctor, target_date=new_date, consultation_type=target_mode)
    matching_slot = next((s for s in day_info["slots"] if s["start_time"] == new_start_time), None)
    if not matching_slot or not matching_slot["is_available"]:
        raise BookingConflictError("Requested new slot is unavailable. Please select another available slot.")

    # Release old slot lock and mark old booking rescheduled
    appt.appointment_status = "rescheduled"
    appt.active_slot_key = None
    appt.cancellation_reason = reason.strip() if reason else f"Rescheduled by {actor.role_name}"

    slot_start_utc, slot_end_utc = slot_to_utc(new_date, matching_slot["start_time"], matching_slot["end_time"])
    new_status = "confirmed" if doctor.auto_confirm else "pending"
    new_appt = Appointment(
        patient_id=appt.patient_id,
        doctor_id=doctor.id,
        clinic_id=doctor.clinic_id,
        appointment_date=new_date,
        start_time=matching_slot["start_time"],
        end_time=matching_slot["end_time"],
        slot_start_utc=slot_start_utc,
        slot_end_utc=slot_end_utc,
        timezone_name="Asia/Kolkata",
        consultation_type=target_mode,
        appointment_status=new_status,
        consultation_fee=doctor.consultation_fee,
        patient_notes=appt.patient_notes,
        rescheduled_from_id=appt.id,
        share_session_id=appt.share_session_id,
        active_slot_key=make_active_slot_key(doctor.id, new_date, matching_slot["start_time"]),
    )
    db.add(new_appt)
    try:
        db.flush()
    except IntegrityError as exc:
        db.rollback()
        raise BookingConflictError("New slot was just booked concurrently. Please choose another slot.") from exc

    create_notification(
        db,
        recipient_user_id=appt.patient_id,
        notification_type="appointment_rescheduled",
        title="Appointment Rescheduled",
        message=f"Consultation with {doctor.full_name} moved to {new_date.isoformat()} at {matching_slot['start_time']} IST.",
        related_entity_type="appointment",
        related_entity_id=new_appt.id,
    )
    create_notification(
        db,
        recipient_user_id=doctor.user_id,
        notification_type="appointment_rescheduled",
        title="Appointment Rescheduled",
        message=f"Appointment rescheduled to {new_date.isoformat()} at {matching_slot['start_time']} IST.",
        related_entity_type="appointment",
        related_entity_id=new_appt.id,
    )
    db.commit()
    db.refresh(new_appt)
    return new_appt


async def suggest_speciality_with_ai(
    *,
    db: Session,
    user: User,
    concern: str,
    use_vault_context: bool,
    follow_up_answers: Optional[str] = None,
) -> Dict[str, Any]:
    """Match patient health concerns to controlled Speciality catalog via Gemini API + clinical safety guardrails."""
    disclaimer = (
        "These suggestions help you identify a relevant medical speciality. "
        "They are not a medical diagnosis or a replacement for professional evaluation."
    )
    specialities = db.query(Speciality).filter(Speciality.is_active.is_(True)).order_by(Speciality.name.asc()).all()
    spec_names = [s.name for s in specialities]
    spec_by_low = {s.name.lower(): s for s in specialities}

    combined_text = f"{concern} {follow_up_answers or ''}".strip()
    lower_q = combined_text.lower()
    matched_red_flags = [kw for kw in EMERGENCY_KEYWORDS if kw in lower_q]
    if matched_red_flags:
        return {
            "ai_configured": bool(get_active_gemini_key()),
            "ai_available": True,
            "is_emergency": True,
            "red_flags": matched_red_flags,
            "recommended_speciality": None,
            "alternative_specialities": [],
            "reasoning": (
                f"Your concern mentions potential emergency symptoms ({', '.join(matched_red_flags)}). "
                "Do NOT wait for a routine appointment booking — seek immediate emergency medical care or call emergency services right away."
            ),
            "clarifying_questions": [],
            "uncertainty_note": "Emergency symptoms require urgent in-person clinical evaluation rather than online booking.",
            "context_used": False,
            "context_reason": "emergency_bypass",
            "provider_mode": "emergency_safety_rule",
            "disclaimer": disclaimer,
        }

    api_key = get_active_gemini_key()
    if not api_key:
        return {
            "ai_configured": False,
            "ai_available": False,
            "is_emergency": False,
            "red_flags": [],
            "recommended_speciality": None,
            "alternative_specialities": [],
            "reasoning": (
                "Live Gemini AI speciality matching is currently unavailable because GEMINI_API_KEY is not configured. "
                "Please browse verified medical specialities directly using the speciality filter below."
            ),
            "clarifying_questions": [],
            "uncertainty_note": "Integration inactive — no AI triage executed.",
            "context_used": False,
            "context_reason": "ai_unconfigured",
            "provider_mode": "unconfigured_fallback_catalogue",
            "available_specialities": [{"id": s.id, "name": s.name, "category": s.category, "description": s.description} for s in specialities],
            "disclaimer": disclaimer,
        }

    vault_ctx, ctx_meta = _select_relevant_patient_context(
        db=db,
        user=user,
        user_message=combined_text,
        use_vault_context=use_vault_context,
        attached_doc=None,
    )

    context_block = (
        f"CONSENTED PATIENT MEDICAL CONTEXT (only cite facts explicitly present): {json.dumps(vault_ctx, default=str)[:2500]}"
        if ctx_meta["context_used"]
        else f"PATIENT MEDICAL CONTEXT: Disabled ({ctx_meta['reason']}). Rely only on the reported concern."
    )

    prompt = (
        f"CONTROLLED SPECIALITY CATALOGUE:\n{json.dumps(spec_names)}\n\n"
        f"{context_block}\n\n"
        f"PATIENT CONCERN:\n{concern}\n"
        + (f"\nADDITIONAL CLARIFICATION ANSWERS:\n{follow_up_answers}\n" if follow_up_answers else "")
        + "\nRespond ONLY with valid JSON containing keys:\n"
        '{\n'
        '  "is_urgent_warning": boolean,\n'
        '  "recommended_speciality": string (MUST be an exact string from CONTROLLED SPECIALITY CATALOGUE or "General Physician"),\n'
        '  "alternative_specialities": array of 0-2 exact strings from CONTROLLED SPECIALITY CATALOGUE,\n'
        '  "reasoning": string (2-4 concise educational sentences explaining relevance without diagnosing or prescribing),\n'
        '  "clarifying_questions": array of 1-3 short clarifying questions for the patient or doctor visit,\n'
        '  "uncertainty_note": string (honest note explaining ambiguity/overlap and that only a clinician can evaluate)\n'
        '}\n'
        "Safety rules: Never state a definitive diagnosis, never prescribe medication, never advise delaying urgent care."
    )

    contents = [genai_types.Content(role="user", parts=[genai_types.Part.from_text(text=prompt)])]
    model_name = get_active_gemini_model()

    try:
        raw_text, provider_mode = await asyncio.wait_for(
            asyncio.to_thread(_call_gemini_sync, api_key=api_key, model_name=model_name, contents=contents),
            timeout=settings.GEMINI_TIMEOUT_SECONDS,
        )
    except (GeminiServiceError, asyncio.TimeoutError) as exc:
        detail = getattr(exc, "detail", None) or "Gemini AI service temporarily unavailable or timed out."
        return {
            "ai_configured": True,
            "ai_available": False,
            "is_emergency": False,
            "red_flags": [],
            "recommended_speciality": None,
            "alternative_specialities": [],
            "reasoning": f"{detail} You can still select any speciality manually from the verified directory below.",
            "clarifying_questions": [],
            "uncertainty_note": "AI speciality matching failed cleanly without inventing recommendations.",
            "context_used": False,
            "context_reason": "ai_error",
            "provider_mode": "ai_unavailable",
            "available_specialities": [{"id": s.id, "name": s.name, "category": s.category, "description": s.description} for s in specialities],
            "disclaimer": disclaimer,
        }

    # Parse structured JSON cleanly
    cleaned = raw_text.strip()
    if "```" in cleaned:
        cleaned = cleaned.replace("```json", "").replace("```", "").strip()
    parsed: Dict[str, Any] = {}
    try:
        start_i = cleaned.find("{")
        end_i = cleaned.rfind("}")
        parsed = json.loads(cleaned[start_i : end_i + 1]) if start_i != -1 and end_i != -1 else json.loads(cleaned)
    except Exception:
        parsed = {"reasoning": cleaned}

    rec_name = str(parsed.get("recommended_speciality") or "").strip()
    rec_spec = spec_by_low.get(rec_name.lower())
    if not rec_spec:
        # Match partial substring only against controlled DB specialities, otherwise default to General Physician
        rec_spec = next((s for s in specialities if s.name.lower() in rec_name.lower()), None) or spec_by_low.get("general physician")

    alt_specs = []
    for alt in (parsed.get("alternative_specialities") or []):
        s_obj = spec_by_low.get(str(alt).strip().lower())
        if s_obj and (not rec_spec or s_obj.id != rec_spec.id):
            alt_specs.append({"id": s_obj.id, "name": s_obj.name, "category": s_obj.category, "description": s_obj.description})

    return {
        "ai_configured": True,
        "ai_available": True,
        "is_emergency": bool(parsed.get("is_urgent_warning", False)),
        "red_flags": [],
        "recommended_speciality": {
            "id": rec_spec.id,
            "name": rec_spec.name,
            "category": rec_spec.category,
            "description": rec_spec.description,
        }
        if rec_spec
        else None,
        "alternative_specialities": alt_specs[:2],
        "reasoning": str(parsed.get("reasoning") or "Consult a qualified physician for an evaluation."),
        "clarifying_questions": [str(q) for q in (parsed.get("clarifying_questions") or [])[:3]],
        "uncertainty_note": str(parsed.get("uncertainty_note") or "Speciality suggestions depend on your symptoms and require professional examination."),
        "context_used": ctx_meta["context_used"],
        "context_reason": ctx_meta["reason"],
        "context_categories": ctx_meta.get("categories_included", []),
        "provider_mode": provider_mode,
        "disclaimer": disclaimer,
    }
