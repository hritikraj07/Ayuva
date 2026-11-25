import json
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.auth import get_optional_user, log_access, require_roles
from backend.config import get_settings
from backend.database import get_db
from backend.models import AccessLog, MedicalDocument, ShareSession, User
from backend.schemas import SharePinVerifyRequest, ShareSessionCreate
from backend.services.sharing_service import (
    check_share_status,
    create_share_session,
    generate_qr_data_url,
    serialize_shared_payload,
    verify_share_pin,
)

router = APIRouter(prefix="/api/shares", tags=["Temporary Record Sharing & Doctor Viewer"])
settings = get_settings()


def _format_share_session(session: ShareSession, base_origin: str) -> dict:
    status_info = check_share_status(session)
    share_url = f"{base_origin}/share/{session.token}"
    doc_ids = json.loads(session.document_ids_json or "[]")
    return {
        "id": session.id,
        "token": session.token,
        "title": session.title,
        "recipient_doctor_email": session.recipient_doctor_email,
        "document_ids": doc_ids,
        "document_count": len(doc_ids),
        "include_summary": session.include_summary,
        "share_url": share_url,
        "qr_data_url": generate_qr_data_url(share_url),
        "access_count": session.access_count,
        "last_accessed_at": session.last_accessed_at.isoformat() if session.last_accessed_at else None,
        "created_at": session.created_at.isoformat(),
        **status_info,
    }


@router.post("", status_code=status.HTTP_201_CREATED)
def create_share(
    payload: ShareSessionCreate,
    request: Request,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    try:
        session = create_share_session(
            db,
            patient=current_user,
            title=payload.title,
            document_ids=payload.document_ids,
            include_summary=payload.include_summary,
            expiry_minutes=payload.expiry_minutes,
            pin=payload.pin,
            recipient_doctor_email=payload.recipient_doctor_email,
        )
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    log_access(
        db,
        actor_user_id=current_user.id,
        actor_role=current_user.role_name,
        share_session_id=session.id,
        action="share_created",
        resource_type="sharing_session",
        resource_id=str(session.id),
        details=f"docs={len(payload.document_ids)}, expiry_min={payload.expiry_minutes}, pin={bool(payload.pin)}",
    )
    origin = request.headers.get("origin") or "http://localhost:5173"
    return _format_share_session(session, origin)


@router.get("")
def list_my_shares(
    request: Request,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    sessions = (
        db.query(ShareSession)
        .filter(ShareSession.patient_id == current_user.id)
        .order_by(ShareSession.created_at.desc())
        .all()
    )
    origin = request.headers.get("origin") or "http://localhost:5173"
    logs = (
        db.query(AccessLog)
        .filter(AccessLog.share_session_id.in_([s.id for s in sessions]))
        .order_by(AccessLog.created_at.desc())
        .limit(20)
        .all()
        if sessions
        else []
    )
    return {
        "shares": [_format_share_session(s, origin) for s in sessions],
        "audit_logs": [
            {
                "id": l.id,
                "share_session_id": l.share_session_id,
                "actor_role": l.actor_role,
                "action": l.action,
                "details": l.details,
                "created_at": l.created_at.isoformat(),
            }
            for l in logs
        ],
    }


@router.post("/{share_id}/revoke")
def revoke_share(
    share_id: int,
    request: Request,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    session = (
        db.query(ShareSession)
        .filter(ShareSession.id == share_id, ShareSession.patient_id == current_user.id)
        .first()
    )
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Share session not found.")
    session.is_revoked = True
    session.revoked_at = datetime.now(timezone.utc)
    db.commit()
    db.refresh(session)
    log_access(
        db,
        actor_user_id=current_user.id,
        actor_role=current_user.role_name,
        share_session_id=session.id,
        action="share_revoked",
        resource_type="sharing_session",
        resource_id=str(session.id),
    )
    origin = request.headers.get("origin") or "http://localhost:5173"
    return _format_share_session(session, origin)


@router.get("/doctor/assigned")
def list_doctor_assigned_shares(
    current_user: User = Depends(require_roles("doctor")),
    db: Session = Depends(get_db),
):
    """Doctors only see share sessions explicitly addressed to their email and still valid."""
    sessions = (
        db.query(ShareSession)
        .filter(ShareSession.recipient_doctor_email == current_user.email.lower())
        .order_by(ShareSession.created_at.desc())
        .all()
    )
    items = []
    for s in sessions:
        status_info = check_share_status(s)
        patient = db.query(User).filter(User.id == s.patient_id).first()
        doc_ids = json.loads(s.document_ids_json or "[]")
        items.append(
            {
                "id": s.id,
                "token": s.token,
                "title": s.title,
                "patient_name": patient.full_name if patient else "Patient",
                "document_count": len(doc_ids),
                "include_summary": s.include_summary,
                "access_count": s.access_count,
                "created_at": s.created_at.isoformat(),
                **status_info,
            }
        )
    return {"assigned_shares": items}


@router.get("/public/{token}")
def get_public_share_metadata_or_content(
    token: str,
    pin: Optional[str] = Query(default=None),
    actor: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    session = db.query(ShareSession).filter(ShareSession.token == token).first()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sharing link not found.")

    status_info = check_share_status(session)
    if not status_info["is_active"]:
        raise HTTPException(
            status_code=status.HTTP_410_GONE,
            detail=f"This medical record share link is {status_info['status']}.",
        )

    if status_info["requires_pin"]:
        if not pin:
            return {
                "pin_required": True,
                "title": session.title,
                "status": status_info,
            }
        if not verify_share_pin(session, pin):
            log_access(
                db,
                actor_user_id=actor.id if actor else None,
                actor_role=actor.role_name if actor else "external_viewer",
                share_session_id=session.id,
                action="share_pin_failed",
                resource_type="sharing_session",
                resource_id=str(session.id),
            )
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Incorrect PIN for this shared medical record.")

    session.access_count += 1
    session.last_accessed_at = datetime.now(timezone.utc)
    db.commit()

    log_access(
        db,
        actor_user_id=actor.id if actor else None,
        actor_role=actor.role_name if actor else "external_doctor_viewer",
        share_session_id=session.id,
        action="shared_record_viewed",
        resource_type="sharing_session",
        resource_id=str(session.id),
    )

    payload = serialize_shared_payload(db, session)
    payload["pin_required"] = False
    return payload


@router.post("/public/{token}/verify")
def verify_public_share_pin(
    token: str,
    body: SharePinVerifyRequest,
    actor: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    return get_public_share_metadata_or_content(token=token, pin=body.pin, actor=actor, db=db)


@router.get("/public/{token}/documents/{doc_id}/file")
def view_shared_document_file(
    token: str,
    doc_id: int,
    pin: Optional[str] = Query(default=None),
    actor: Optional[User] = Depends(get_optional_user),
    db: Session = Depends(get_db),
):
    session = db.query(ShareSession).filter(ShareSession.token == token).first()
    if not session:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Sharing link not found.")
    status_info = check_share_status(session)
    if not status_info["is_active"]:
        raise HTTPException(status_code=status.HTTP_410_GONE, detail=f"Share link is {status_info['status']}.")
    if status_info["requires_pin"] and (not pin or not verify_share_pin(session, pin)):
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Valid PIN required.")

    allowed_ids = set(json.loads(session.document_ids_json or "[]"))
    if doc_id not in allowed_ids:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Document is not included in this temporary share session.",
        )

    doc = db.query(MedicalDocument).filter(MedicalDocument.id == doc_id, MedicalDocument.patient_id == session.patient_id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    path = settings.UPLOAD_DIR / doc.stored_filename
    if not path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="File not found on disk.")

    log_access(
        db,
        actor_user_id=actor.id if actor else None,
        actor_role=actor.role_name if actor else "external_doctor_viewer",
        share_session_id=session.id,
        action="shared_file_opened",
        resource_type="medical_document",
        resource_id=str(doc.id),
    )
    return FileResponse(path=path, media_type=doc.mime_type, filename=doc.original_filename)
