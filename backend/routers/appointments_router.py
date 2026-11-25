from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from sqlalchemy.orm import Session

from backend.auth import get_current_user, log_access, require_roles
from backend.database import get_db
from backend.models import (
    Appointment,
    Clinic,
    Doctor,
    DoctorReport,
    Notification,
    Speciality,
    User,
)
from backend.schemas import (
    AdminReportResolveIn,
    AppointmentCancelRequest,
    AppointmentCompleteRequest,
    AppointmentCreateRequest,
    AppointmentDecisionRequest,
    AppointmentRescheduleRequest,
    AppointmentShareRecordsRequest,
    ClinicUpsertIn,
    DoctorVerificationAction,
    SpecialityCreateIn,
)
from backend.services.doctor_booking_service import (
    BookingConflictError,
    BookingValidationError,
    book_appointment_atomic,
    cancel_appointment,
    create_notification,
    reschedule_appointment_atomic,
    serialize_appointment,
    serialize_clinic,
    serialize_doctor,
    today_ist,
)
from backend.services.sharing_service import create_share_session

router = APIRouter(prefix="/api", tags=["Appointments, Notifications & Admin Directory"])


# ======================== PATIENT & DOCTOR APPOINTMENTS ========================

@router.post("/appointments", status_code=status.HTTP_201_CREATED)
def book_appointment(
    payload: AppointmentCreateRequest,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    try:
        appt = book_appointment_atomic(
            db,
            patient=current_user,
            doctor_id=payload.doctor_id,
            appt_date=payload.appointment_date,
            start_time=payload.start_time,
            consultation_type=payload.consultation_type,
            patient_notes=payload.patient_notes,
        )
    except BookingConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except BookingValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    log_access(
        db,
        actor_user_id=current_user.id,
        actor_role=current_user.role_name,
        action="appointment_booked",
        resource_type="appointment",
        resource_id=str(appt.id),
        details=f"doctor_id={appt.doctor_id}, date={appt.appointment_date}, time={appt.start_time}, status={appt.appointment_status}",
    )
    return {"appointment": serialize_appointment(db, appt)}


@router.get("/appointments/my")
def list_my_patient_appointments(
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    appts = (
        db.query(Appointment)
        .filter(Appointment.patient_id == current_user.id)
        .order_by(Appointment.appointment_date.desc(), Appointment.start_time.desc())
        .all()
    )
    today = today_ist()
    serialized = [serialize_appointment(db, a) for a in appts]
    upcoming = [
        a
        for a in serialized
        if a["appointment_status"] in {"pending", "confirmed"} and a["appointment_date"] >= today.isoformat()
    ]
    past = [a for a in serialized if a not in upcoming]
    return {"upcoming": upcoming, "past": past, "all": serialized, "timezone": "Asia/Kolkata"}


@router.get("/appointments/doctor")
def list_doctor_appointments(
    status_filter: Optional[str] = Query(default=None, alias="status"),
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
):
    doctor = db.query(Doctor).filter(Doctor.user_id == current_user.id).first()
    if not doctor:
        return {"has_profile": False, "appointments": [], "timezone": "Asia/Kolkata"}

    query = db.query(Appointment).filter(Appointment.doctor_id == doctor.id)
    if status_filter:
        query = query.filter(Appointment.appointment_status == status_filter)
    appts = query.order_by(Appointment.appointment_date.asc(), Appointment.start_time.asc()).all()
    return {
        "has_profile": True,
        "appointments": [serialize_appointment(db, a) for a in appts],
        "timezone": "Asia/Kolkata",
    }


@router.post("/appointments/{appt_id}/decision")
def decide_pending_appointment(
    appt_id: int,
    payload: AppointmentDecisionRequest,
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
):
    doctor = db.query(Doctor).filter(Doctor.user_id == current_user.id).first()
    if not doctor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Doctor profile not found.")
    appt = db.query(Appointment).filter(Appointment.id == appt_id, Appointment.doctor_id == doctor.id).first()
    if not appt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Appointment not found.")
    if appt.appointment_status != "pending":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=f"Appointment status is '{appt.appointment_status}', not pending.")

    dec = payload.decision.strip().lower()
    if dec not in {"confirm", "reject"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Decision must be 'confirm' or 'reject'.")

    if dec == "confirm":
        appt.appointment_status = "confirmed"
        appt.doctor_notes = payload.doctor_notes.strip() if payload.doctor_notes else appt.doctor_notes
        notif_title = "Appointment Confirmed by Doctor"
        notif_msg = f"Dr. {doctor.full_name} confirmed your appointment on {appt.appointment_date.isoformat()} at {appt.start_time} IST."
    else:
        appt.appointment_status = "rejected"
        appt.active_slot_key = None
        appt.cancellation_reason = payload.doctor_notes.strip() if payload.doctor_notes else "Declined by clinician"
        notif_title = "Appointment Request Declined"
        notif_msg = f"Dr. {doctor.full_name} could not accommodate {appt.appointment_date.isoformat()} at {appt.start_time} IST ({appt.cancellation_reason})."

    create_notification(
        db,
        recipient_user_id=appt.patient_id,
        notification_type=f"appointment_{appt.appointment_status}",
        title=notif_title,
        message=notif_msg,
        related_entity_type="appointment",
        related_entity_id=appt.id,
    )
    db.commit()
    db.refresh(appt)
    log_access(
        db,
        actor_user_id=current_user.id,
        actor_role=current_user.role_name,
        action=f"appointment_{appt.appointment_status}",
        resource_type="appointment",
        resource_id=str(appt.id),
    )
    return {"appointment": serialize_appointment(db, appt)}


@router.post("/appointments/{appt_id}/complete")
def complete_appointment(
    appt_id: int,
    payload: AppointmentCompleteRequest,
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
):
    doctor = db.query(Doctor).filter(Doctor.user_id == current_user.id).first()
    if not doctor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Doctor profile not found.")
    appt = db.query(Appointment).filter(Appointment.id == appt_id, Appointment.doctor_id == doctor.id).first()
    if not appt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Appointment not found.")
    if appt.appointment_status != "confirmed":
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Only confirmed appointments can be marked completed.")

    appt.appointment_status = "completed"
    appt.active_slot_key = None
    if payload.doctor_notes:
        appt.doctor_notes = payload.doctor_notes.strip()
    create_notification(
        db,
        recipient_user_id=appt.patient_id,
        notification_type="appointment_completed",
        title="Consultation Completed",
        message=f"Your appointment with Dr. {doctor.full_name} on {appt.appointment_date.isoformat()} has been marked completed.",
        related_entity_type="appointment",
        related_entity_id=appt.id,
    )
    db.commit()
    db.refresh(appt)
    return {"appointment": serialize_appointment(db, appt)}


@router.post("/appointments/{appt_id}/cancel")
def cancel_existing_appointment(
    appt_id: int,
    payload: AppointmentCancelRequest,
    current_user: User = Depends(require_roles("patient", "doctor")),
    db: Session = Depends(get_db),
):
    appt = db.query(Appointment).filter(Appointment.id == appt_id).first()
    if not appt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Appointment not found.")

    if current_user.role_name == "patient" and appt.patient_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot cancel another patient's appointment.")
    if current_user.role_name == "doctor":
        doc = db.query(Doctor).filter(Doctor.user_id == current_user.id).first()
        if not doc or appt.doctor_id != doc.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot cancel another doctor's appointment.")

    try:
        updated = cancel_appointment(db, appt=appt, actor=current_user, reason=payload.reason)
    except BookingValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    log_access(
        db,
        actor_user_id=current_user.id,
        actor_role=current_user.role_name,
        action="appointment_cancelled",
        resource_type="appointment",
        resource_id=str(updated.id),
    )
    return {"appointment": serialize_appointment(db, updated)}


@router.post("/appointments/{appt_id}/reschedule")
def reschedule_existing_appointment(
    appt_id: int,
    payload: AppointmentRescheduleRequest,
    current_user: User = Depends(require_roles("patient", "doctor")),
    db: Session = Depends(get_db),
):
    appt = db.query(Appointment).filter(Appointment.id == appt_id).first()
    if not appt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Appointment not found.")

    if current_user.role_name == "patient" and appt.patient_id != current_user.id:
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot reschedule another patient's appointment.")
    if current_user.role_name == "doctor":
        doc = db.query(Doctor).filter(Doctor.user_id == current_user.id).first()
        if not doc or appt.doctor_id != doc.id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Cannot reschedule another doctor's appointment.")

    try:
        new_appt = reschedule_appointment_atomic(
            db,
            appt=appt,
            actor=current_user,
            new_date=payload.appointment_date,
            new_start_time=payload.start_time,
            consultation_type=payload.consultation_type,
            reason=payload.reason,
        )
    except BookingConflictError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
    except BookingValidationError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    log_access(
        db,
        actor_user_id=current_user.id,
        actor_role=current_user.role_name,
        action="appointment_rescheduled",
        resource_type="appointment",
        resource_id=str(new_appt.id),
        details=f"from={appt.id}",
    )
    return {"appointment": serialize_appointment(db, new_appt)}


@router.post("/appointments/{appt_id}/share-records", status_code=status.HTTP_201_CREATED)
def share_vault_records_for_appointment(
    appt_id: int,
    payload: AppointmentShareRecordsRequest,
    request: Request,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    """Explicit patient consent action to share selected medical documents with the booked doctor separately from booking."""
    appt = db.query(Appointment).filter(Appointment.id == appt_id, Appointment.patient_id == current_user.id).first()
    if not appt:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Appointment not found.")

    doctor = db.query(Doctor).filter(Doctor.id == appt.doctor_id).first()
    doctor_user = db.query(User).filter(User.id == doctor.user_id).first() if doctor else None
    if not doctor or not doctor_user:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Booked clinician account not found.")

    try:
        share_session = create_share_session(
            db,
            patient=current_user,
            title=f"Consultation Share — {appt.appointment_date.isoformat()} ({doctor.full_name})",
            document_ids=payload.document_ids,
            include_summary=payload.include_summary,
            expiry_minutes=payload.expiry_minutes,
            pin=payload.pin,
            recipient_doctor_email=doctor_user.email,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    appt.share_session_id = share_session.id
    create_notification(
        db,
        recipient_user_id=doctor_user.id,
        notification_type="medical_records_shared",
        title="Patient Shared Selected Medical Records",
        message=f"{current_user.full_name} explicitly shared {len(payload.document_ids)} record(s) for their {appt.appointment_date.isoformat()} consultation.",
        related_entity_type="sharing_session",
        related_entity_id=share_session.id,
    )
    db.commit()

    log_access(
        db,
        actor_user_id=current_user.id,
        actor_role=current_user.role_name,
        share_session_id=share_session.id,
        action="appointment_records_shared",
        resource_type="appointment",
        resource_id=str(appt.id),
        details=f"docs={len(payload.document_ids)}, include_summary={payload.include_summary}",
    )

    origin = request.headers.get("origin") or "http://localhost:5173"
    return {
        "appointment": serialize_appointment(db, appt),
        "share_session": {
            "id": share_session.id,
            "token": share_session.token,
            "share_url": f"{origin}/share/{share_session.token}",
            "expires_at": share_session.expires_at.isoformat(),
            "document_count": len(payload.document_ids),
            "include_summary": payload.include_summary,
            "pin_protected": bool(payload.pin),
        },
    }


# ======================== IN-APP NOTIFICATIONS ========================

@router.get("/notifications")
def list_notifications(
    unread_only: bool = Query(default=False),
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    q = db.query(Notification).filter(Notification.recipient_user_id == current_user.id)
    if unread_only:
        q = q.filter(Notification.read_status.is_(False))
    items = q.order_by(Notification.created_at.desc()).limit(50).all()
    unread_count = (
        db.query(Notification)
        .filter(Notification.recipient_user_id == current_user.id, Notification.read_status.is_(False))
        .count()
    )
    return {
        "unread_count": unread_count,
        "notifications": [
            {
                "id": n.id,
                "notification_type": n.notification_type,
                "title": n.title,
                "message": n.message,
                "related_entity_type": n.related_entity_type,
                "related_entity_id": n.related_entity_id,
                "read_status": n.read_status,
                "created_at": n.created_at.isoformat(),
            }
            for n in items
        ],
    }


@router.post("/notifications/{notif_id}/read")
def mark_notification_read(
    notif_id: int,
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    notif = db.query(Notification).filter(Notification.id == notif_id, Notification.recipient_user_id == current_user.id).first()
    if not notif:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Notification not found.")
    notif.read_status = True
    db.commit()
    return {"id": notif.id, "read_status": True}


@router.post("/notifications/read-all")
def mark_all_notifications_read(
    current_user: User = Depends(get_current_user),
    db: Session = Depends(get_db),
):
    db.query(Notification).filter(Notification.recipient_user_id == current_user.id, Notification.read_status.is_(False)).update(
        {"read_status": True}
    )
    db.commit()
    return {"marked_all_read": True}


# ======================== ADMIN DIRECTORY & VERIFICATION ========================

@router.get("/admin/directory/overview")
def admin_directory_overview(
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    doctors = db.query(Doctor).order_by(Doctor.created_at.desc()).all()
    specialities = db.query(Speciality).order_by(Speciality.name.asc()).all()
    clinics = db.query(Clinic).order_by(Clinic.created_at.desc()).all()
    reports = db.query(DoctorReport).order_by(DoctorReport.created_at.desc()).all()

    appts_all = db.query(Appointment).all()
    status_counts = {}
    for a in appts_all:
        status_counts[a.appointment_status] = status_counts.get(a.appointment_status, 0) + 1

    return {
        "doctors": [serialize_doctor(db, d, include_next_slot=False) for d in doctors],
        "specialities": [
            {
                "id": s.id,
                "name": s.name,
                "slug": s.slug,
                "description": s.description,
                "category": s.category,
                "is_active": s.is_active,
            }
            for s in specialities
        ],
        "clinics": [serialize_clinic(c) for c in clinics],
        "reports": [
            {
                "id": r.id,
                "doctor_id": r.doctor_id,
                "reason": r.reason,
                "status": r.status,
                "admin_notes": r.admin_notes,
                "created_at": r.created_at.isoformat(),
            }
            for r in reports
        ],
        "appointment_stats": {
            "total": len(appts_all),
            "by_status": status_counts,
        },
    }


@router.post("/admin/doctors/{doctor_id}/verify")
def admin_verify_doctor(
    doctor_id: int,
    payload: DoctorVerificationAction,
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    target_status = payload.status.strip().lower()
    if target_status not in {"verified", "rejected", "suspended"}:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Status must be verified, rejected, or suspended.")

    doctor = db.query(Doctor).filter(Doctor.id == doctor_id).first()
    if not doctor:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Doctor profile not found.")

    doctor.verification_status = target_status
    doctor.verification_notes = payload.notes.strip() if payload.notes else None
    if target_status == "verified":
        doctor.verified_by_user_id = current_user.id
        doctor.verified_at = datetime.now(timezone.utc)
        if not payload.allow_secondary_specialities:
            doctor.secondary_speciality_ids_json = "[]"
    else:
        doctor.verified_at = None

    create_notification(
        db,
        recipient_user_id=doctor.user_id,
        notification_type=f"doctor_verification_{target_status}",
        title=f"Doctor Profile {target_status.title()}",
        message=(
            f"An administrator updated your verification status to '{target_status}'."
            + (f" Notes: {doctor.verification_notes}" if doctor.verification_notes else "")
        ),
        related_entity_type="doctor",
        related_entity_id=doctor.id,
    )
    db.commit()
    db.refresh(doctor)
    log_access(
        db,
        actor_user_id=current_user.id,
        actor_role=current_user.role_name,
        action=f"admin_doctor_{target_status}",
        resource_type="doctor",
        resource_id=str(doctor.id),
        details=doctor.verification_notes,
    )
    return {"doctor": serialize_doctor(db, doctor, include_next_slot=False)}


@router.post("/admin/specialities", status_code=status.HTTP_201_CREATED)
def admin_create_speciality(
    payload: SpecialityCreateIn,
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    name = payload.name.strip()
    slug = "-".join(name.lower().split())
    if db.query(Speciality).filter((Speciality.name == name) | (Speciality.slug == slug)).first():
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="Speciality already exists.")
    spec = Speciality(name=name, slug=slug, description=payload.description.strip(), category=payload.category.strip(), is_active=payload.is_active)
    db.add(spec)
    db.commit()
    db.refresh(spec)
    log_access(
        db,
        actor_user_id=current_user.id,
        actor_role=current_user.role_name,
        action="admin_speciality_created",
        resource_type="speciality",
        resource_id=str(spec.id),
    )
    return {"id": spec.id, "name": spec.name, "slug": spec.slug, "description": spec.description, "category": spec.category, "is_active": spec.is_active}


@router.patch("/admin/specialities/{spec_id}")
def admin_update_speciality(
    spec_id: int,
    payload: SpecialityCreateIn,
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    spec = db.query(Speciality).filter(Speciality.id == spec_id).first()
    if not spec:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Speciality not found.")
    spec.name = payload.name.strip()
    spec.description = payload.description.strip()
    spec.category = payload.category.strip()
    spec.is_active = payload.is_active
    db.commit()
    return {"id": spec.id, "name": spec.name, "slug": spec.slug, "description": spec.description, "category": spec.category, "is_active": spec.is_active}


@router.post("/admin/clinics", status_code=status.HTTP_201_CREATED)
def admin_create_clinic(
    payload: ClinicUpsertIn,
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    clinic = Clinic(
        name=payload.name.strip(),
        address=payload.address.strip(),
        city=payload.city.strip(),
        state=payload.state.strip(),
        postal_code=payload.postal_code.strip(),
        contact_information=payload.contact_information,
        latitude=payload.latitude,
        longitude=payload.longitude,
        is_active=True,
    )
    db.add(clinic)
    db.commit()
    db.refresh(clinic)
    return {"clinic": serialize_clinic(clinic)}


@router.patch("/admin/clinics/{clinic_id}")
def admin_update_clinic(
    clinic_id: int,
    payload: ClinicUpsertIn,
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    clinic = db.query(Clinic).filter(Clinic.id == clinic_id).first()
    if not clinic:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Clinic not found.")
    clinic.name = payload.name.strip()
    clinic.address = payload.address.strip()
    clinic.city = payload.city.strip()
    clinic.state = payload.state.strip()
    clinic.postal_code = payload.postal_code.strip()
    clinic.contact_information = payload.contact_information
    clinic.latitude = payload.latitude
    clinic.longitude = payload.longitude
    db.commit()
    db.refresh(clinic)
    return {"clinic": serialize_clinic(clinic)}


@router.post("/admin/reports/{report_id}/resolve")
def admin_resolve_report(
    report_id: int,
    payload: AdminReportResolveIn,
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    report = db.query(DoctorReport).filter(DoctorReport.id == report_id).first()
    if not report:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Report not found.")
    report.status = payload.status
    report.admin_notes = payload.admin_notes
    db.commit()
    log_access(
        db,
        actor_user_id=current_user.id,
        actor_role=current_user.role_name,
        action="admin_report_resolved",
        resource_type="doctor_report",
        resource_id=str(report.id),
    )
    return {"id": report.id, "status": report.status}


@router.get("/admin/appointments")
def admin_monitor_appointments(
    current_user: User = Depends(require_roles("admin")),
    db: Session = Depends(get_db),
):
    appts = db.query(Appointment).order_by(Appointment.created_at.desc()).limit(100).all()
    return {
        "appointments": [
            {
                "id": a.id,
                "doctor_id": a.doctor_id,
                "appointment_date": a.appointment_date.isoformat(),
                "start_time": a.start_time,
                "end_time": a.end_time,
                "consultation_type": a.consultation_type,
                "appointment_status": a.appointment_status,
                "consultation_fee": a.consultation_fee,
                "created_at": a.created_at.isoformat(),
            }
            for a in appts
        ],
        "timezone": "Asia/Kolkata",
    }
