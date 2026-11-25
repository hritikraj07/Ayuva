import base64
import io
import json
import secrets
from datetime import datetime, timedelta, timezone
from typing import Any, Dict, List, Optional

import qrcode
from sqlalchemy.orm import Session

from backend.auth import hash_password, verify_password
from backend.models import MedicalDocument, ShareSession, User
from backend.services.summary_service import build_doctor_summary_payload


def _to_aware_utc(dt: datetime) -> datetime:
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def generate_qr_data_url(share_url: str) -> str:
    qr = qrcode.QRCode(version=2, box_size=8, border=2)
    qr.add_data(share_url)
    qr.make(fit=True)
    img = qr.make_image(fill_color="#0F2744", back_color="#FFFFFF")
    buf = io.BytesIO()
    img.save(buf, format="PNG")
    b64 = base64.b64encode(buf.getvalue()).decode("ascii")
    return f"data:image/png;base64,{b64}"


def create_share_session(
    db: Session,
    *,
    patient: User,
    title: str,
    document_ids: List[int],
    include_summary: bool,
    expiry_minutes: int,
    pin: Optional[str],
    recipient_doctor_email: Optional[str],
) -> ShareSession:
    owned_docs = (
        db.query(MedicalDocument.id)
        .filter(MedicalDocument.patient_id == patient.id, MedicalDocument.id.in_(document_ids))
        .all()
    )
    owned_ids = [row[0] for row in owned_docs]
    if len(owned_ids) != len(set(document_ids)):
        raise ValueError("One or more selected documents do not belong to your medical vault.")

    token = secrets.token_urlsafe(24)
    expires_at = datetime.now(timezone.utc) + timedelta(minutes=expiry_minutes)
    session = ShareSession(
        patient_id=patient.id,
        token=token,
        title=title.strip(),
        recipient_doctor_email=recipient_doctor_email.lower().strip() if recipient_doctor_email else None,
        document_ids_json=json.dumps(owned_ids),
        include_summary=include_summary,
        pin_hash=hash_password(pin) if pin else None,
        expires_at=expires_at,
    )
    db.add(session)
    db.commit()
    db.refresh(session)
    return session


def check_share_status(session: ShareSession) -> Dict[str, Any]:
    now = datetime.now(timezone.utc)
    expires = _to_aware_utc(session.expires_at)
    is_expired = now >= expires
    status_label = "revoked" if session.is_revoked else ("expired" if is_expired else "active")
    remaining_seconds = max(0, int((expires - now).total_seconds())) if status_label == "active" else 0
    return {
        "status": status_label,
        "is_active": status_label == "active",
        "is_expired": is_expired,
        "is_revoked": session.is_revoked,
        "requires_pin": bool(session.pin_hash),
        "expires_at": expires.isoformat(),
        "remaining_seconds": remaining_seconds,
    }


def serialize_shared_payload(db: Session, session: ShareSession) -> Dict[str, Any]:
    doc_ids: List[int] = json.loads(session.document_ids_json or "[]")
    docs = (
        db.query(MedicalDocument)
        .filter(MedicalDocument.patient_id == session.patient_id, MedicalDocument.id.in_(doc_ids))
        .order_by(MedicalDocument.document_date.desc())
        .all()
    )
    patient = db.query(User).filter(User.id == session.patient_id).first()

    shared_docs = []
    for d in docs:
        info = d.extracted_info
        shared_docs.append(
            {
                "id": d.id,
                "title": d.title,
                "category": d.category,
                "original_filename": d.original_filename,
                "mime_type": d.mime_type,
                "document_date": d.document_date.isoformat() if d.document_date else None,
                "doctor_name": d.doctor_name,
                "hospital_name": d.hospital_name,
                "primary_condition": d.primary_condition,
                "is_verified": d.is_verified,
                "ocr_text": d.ocr_text,
                "extracted": {
                    "diagnosis": info.diagnosis if info else None,
                    "medications": json.loads(info.medications_json) if info else [],
                    "lab_values": json.loads(info.lab_values_json) if info else [],
                    "allergies": json.loads(info.allergies_json) if info else [],
                    "observations": json.loads(info.observations_json) if info else [],
                },
            }
        )

    # STRICT PRIVACY GUARANTEE:
    # Scoped summary reflects ONLY the explicitly shared documents (plus critical allergies safety header),
    # never exposing unshared vault records, unshared conditions, or chat history.
    scoped_summary = None
    if session.include_summary and patient:
        from backend.models import Allergy, PatientProfile

        profile = db.query(PatientProfile).filter(PatientProfile.user_id == session.patient_id).first()
        allergies = db.query(Allergy).filter(Allergy.patient_id == session.patient_id).all()
        shared_conditions = sorted(
            {
                d["extracted"]["diagnosis"]
                for d in shared_docs
                if d["extracted"].get("diagnosis")
            }
        )
        shared_meds = [m for d in shared_docs for m in d["extracted"].get("medications", [])]
        shared_labs = [
            {**lab, "date": d["document_date"], "document_title": d["title"]}
            for d in shared_docs
            for lab in d["extracted"].get("lab_values", [])
        ]
        scoped_summary = {
            "patient": {
                "full_name": patient.full_name,
                "date_of_birth": profile.date_of_birth.isoformat() if profile and profile.date_of_birth else None,
                "gender": profile.gender if profile else None,
                "blood_group": profile.blood_group if profile else None,
            },
            "known_allergies": [
                {"allergen": a.allergen, "reaction": a.reaction, "severity": a.severity}
                for a in allergies
            ],
            "shared_conditions": shared_conditions,
            "shared_medications": shared_meds,
            "shared_lab_results": shared_labs,
            "scope_note": f"Viewer strictly limited to {len(shared_docs)} explicitly shared document(s). Unshared vault records remain private.",
        }

    return {
        "share_id": session.id,
        "token": session.token,
        "title": session.title,
        "patient_name": patient.full_name if patient else "Patient",
        "status": check_share_status(session),
        "shared_document_count": len(shared_docs),
        "documents": shared_docs,
        "summary": scoped_summary,
    }


def verify_share_pin(session: ShareSession, pin: str) -> bool:
    if not session.pin_hash:
        return True
    return verify_password(pin, session.pin_hash)
