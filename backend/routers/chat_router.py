import json
import time
from collections import defaultdict, deque
from typing import Dict, Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from pydantic import BaseModel
from sqlalchemy.orm import Session

from backend.auth import log_access, require_roles
from backend.config import get_settings
from backend.database import get_db
from backend.models import ChatConversation, ChatMessage, MedicalDocument, PatientProfile, User
from backend.schemas import ConversationCreate
from backend.services.assistant_service import (
    GeminiServiceError,
    generate_assistant_reply,
    get_active_gemini_key,
    get_active_gemini_model,
    search_openfda_medicines,
)
from backend.services.ocr_extraction import validate_upload_bytes

router = APIRouter(prefix="/api/chat", tags=["Personalized AI Healthcare Assistant"])
settings = get_settings()

CHAT_RATE_LIMIT_MAX = 20
CHAT_RATE_LIMIT_WINDOW_SECONDS = 60
_USER_REQUEST_TIMESTAMPS: Dict[int, deque] = defaultdict(deque)

SUGGESTED_QUESTIONS = [
    "Explain my latest lab report and highlight any out-of-range values.",
    "What allergies are documented in my records and what should I watch out for?",
    "Summarize the medicines in my current prescriptions and questions for my doctor.",
    "Explain what HbA1c and fasting glucose tests measure in simple words.",
]


class ConversationPatch(BaseModel):
    title: Optional[str] = None
    use_vault_context: Optional[bool] = None


def _check_rate_limit(user_id: int) -> None:
    now = time.monotonic()
    q = _USER_REQUEST_TIMESTAMPS[user_id]
    while q and now - q[0] > CHAT_RATE_LIMIT_WINDOW_SECONDS:
        q.popleft()
    if len(q) >= CHAT_RATE_LIMIT_MAX:
        raise HTTPException(
            status_code=status.HTTP_429_TOO_MANY_REQUESTS,
            detail="Too many chat requests in a short window. Please wait a minute and try again.",
        )
    q.append(now)


def _serialize_message(m: ChatMessage) -> dict:
    return {
        "id": m.id,
        "conversation_id": m.conversation_id,
        "role": m.role,
        "content": m.content,
        "attached_document_id": m.attached_document_id,
        "attachment_image_name": m.attachment_image_name,
        "citations": json.loads(m.citations_json or "[]"),
        "safety_flags": json.loads(m.safety_flags_json or "[]"),
        "is_emergency": m.is_emergency,
        "provider_mode": m.provider_mode,
        "created_at": m.created_at.isoformat(),
    }


@router.get("/status")
def get_chat_status(
    current_user: User = Depends(require_roles("patient", "doctor")),
    db: Session = Depends(get_db),
):
    key_set = bool(get_active_gemini_key())
    profile = db.query(PatientProfile).filter(PatientProfile.user_id == current_user.id).first()
    return {
        "ai_configured": key_set,
        "provider": "gemini" if key_set else "unconfigured",
        "model": get_active_gemini_model() if key_set else None,
        "ai_consent": bool(profile.ai_consent) if profile else True,
        "ocr_available": True,
        "supported_attachment_types": ["pdf", "jpg", "jpeg", "png"],
        "drug_reference_api": "OpenFDA Drug Label API (api.fda.gov)",
        "rate_limit_per_minute": CHAT_RATE_LIMIT_MAX,
    }


@router.get("/suggestions")
def get_chat_suggestions(current_user: User = Depends(require_roles("patient"))):
    return {"suggestions": SUGGESTED_QUESTIONS}


@router.get("/medicines/search")
async def medicine_search(
    q: str = Query(default=""),
    current_user: User = Depends(require_roles("patient", "doctor")),
):
    return await search_openfda_medicines(q)


@router.get("/conversations")
def list_conversations(
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    convos = (
        db.query(ChatConversation)
        .filter(ChatConversation.user_id == current_user.id)
        .order_by(ChatConversation.updated_at.desc())
        .all()
    )
    return {
        "conversations": [
            {
                "id": c.id,
                "title": c.title,
                "use_vault_context": c.use_vault_context,
                "message_count": len(c.messages),
                "created_at": c.created_at.isoformat(),
                "updated_at": c.updated_at.isoformat(),
            }
            for c in convos
        ]
    }


@router.post("/conversations", status_code=status.HTTP_201_CREATED)
def create_conversation(
    payload: ConversationCreate,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    convo = ChatConversation(
        user_id=current_user.id,
        title=(payload.title or "New Consultation Question").strip(),
        use_vault_context=payload.use_vault_context,
    )
    db.add(convo)
    db.commit()
    db.refresh(convo)
    return {
        "id": convo.id,
        "title": convo.title,
        "use_vault_context": convo.use_vault_context,
        "created_at": convo.created_at.isoformat(),
        "messages": [],
    }


@router.patch("/conversations/{convo_id}")
def update_conversation(
    convo_id: int,
    payload: ConversationPatch,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    convo = (
        db.query(ChatConversation)
        .filter(ChatConversation.id == convo_id, ChatConversation.user_id == current_user.id)
        .first()
    )
    if not convo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    if payload.title is not None and payload.title.strip():
        convo.title = payload.title.strip()[:200]
    if payload.use_vault_context is not None:
        convo.use_vault_context = payload.use_vault_context
    db.commit()
    db.refresh(convo)
    return {
        "id": convo.id,
        "title": convo.title,
        "use_vault_context": convo.use_vault_context,
    }


@router.get("/conversations/{convo_id}")
def get_conversation(
    convo_id: int,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    convo = (
        db.query(ChatConversation)
        .filter(ChatConversation.id == convo_id, ChatConversation.user_id == current_user.id)
        .first()
    )
    if not convo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    return {
        "id": convo.id,
        "title": convo.title,
        "use_vault_context": convo.use_vault_context,
        "created_at": convo.created_at.isoformat(),
        "messages": [_serialize_message(m) for m in convo.messages],
    }


@router.delete("/conversations/{convo_id}")
def delete_conversation(
    convo_id: int,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    convo = (
        db.query(ChatConversation)
        .filter(ChatConversation.id == convo_id, ChatConversation.user_id == current_user.id)
        .first()
    )
    if not convo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")
    db.delete(convo)
    db.commit()
    return {"deleted": True, "id": convo_id}


@router.post("/conversations/{convo_id}/messages")
async def send_chat_message(
    convo_id: int,
    message: str = Form(...),
    attached_document_id: Optional[int] = Form(default=None),
    use_vault_context: Optional[bool] = Form(default=None),
    image: Optional[UploadFile] = File(default=None),
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    _check_rate_limit(current_user.id)

    convo = (
        db.query(ChatConversation)
        .filter(ChatConversation.id == convo_id, ChatConversation.user_id == current_user.id)
        .first()
    )
    if not convo:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Conversation not found.")

    clean_message = message.strip()
    if not clean_message:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message cannot be empty.")
    if len(clean_message) > 4000:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Message exceeds maximum 4000 characters.")

    if use_vault_context is not None:
        convo.use_vault_context = use_vault_context

    attached_doc: Optional[MedicalDocument] = None
    if attached_document_id is not None:
        attached_doc = (
            db.query(MedicalDocument)
            .filter(MedicalDocument.id == attached_document_id, MedicalDocument.patient_id == current_user.id)
            .first()
        )
        if not attached_doc:
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Attached vault document not found.")

    upload_bytes: Optional[bytes] = None
    upload_name: Optional[str] = None
    upload_ext: str = ".png"
    upload_mime: Optional[str] = None
    stored_upload_path: Optional[str] = None
    if image is not None and image.filename:
        upload_bytes = await image.read()
        try:
            upload_ext, upload_mime = validate_upload_bytes(image.filename, upload_bytes)
        except ValueError as exc:
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc
        upload_name = image.filename
        stored_name = f"chat_{current_user.id}_{uuid4().hex}{upload_ext}"
        (settings.UPLOAD_DIR / stored_name).write_bytes(upload_bytes)
        stored_upload_path = stored_name

    # Prior persisted conversation history for genuine follow-up context
    history = [{"role": m.role, "content": m.content} for m in convo.messages]

    try:
        reply = await generate_assistant_reply(
            db=db,
            user=current_user,
            user_message=clean_message,
            use_vault_context=convo.use_vault_context,
            history=history,
            attached_doc=attached_doc,
            uploaded_file_bytes=upload_bytes,
            uploaded_file_ext=upload_ext,
            uploaded_mime_type=upload_mime,
        )
    except GeminiServiceError as exc:
        # Clean up temporary upload if Gemini failed before message persistence
        if stored_upload_path:
            try:
                (settings.UPLOAD_DIR / stored_upload_path).unlink(missing_ok=True)
            except Exception:
                pass
        raise HTTPException(status_code=exc.status_code, detail=exc.detail) from exc

    if len(convo.messages) == 0 and convo.title in {"New Consultation Question", "New Health Inquiry"}:
        convo.title = clean_message[:72]

    user_msg = ChatMessage(
        conversation_id=convo.id,
        role="user",
        content=clean_message,
        attached_document_id=attached_document_id,
        attachment_image_name=upload_name,
        attachment_stored_path=stored_upload_path,
        provider_mode="user",
    )
    db.add(user_msg)
    db.flush()

    assistant_msg = ChatMessage(
        conversation_id=convo.id,
        role="assistant",
        content=reply["content"],
        attached_document_id=attached_document_id,
        citations_json=json.dumps(reply["citations"]),
        safety_flags_json=json.dumps(reply["safety_flags"]),
        is_emergency=reply["is_emergency"],
        provider_mode=reply["provider_mode"],
    )
    db.add(assistant_msg)
    db.commit()
    db.refresh(user_msg)
    db.refresh(assistant_msg)

    log_access(
        db,
        actor_user_id=current_user.id,
        actor_role=current_user.role_name,
        action="assistant_message_processed",
        resource_type="chat_conversation",
        resource_id=str(convo.id),
        details=f"emergency={reply['is_emergency']}, provider={reply['provider_mode']}, context_used={reply.get('context_used')}",
    )

    return {
        "conversation_id": convo.id,
        "conversation_title": convo.title,
        "ai_configured": reply.get("ai_configured", False),
        "context_used": reply.get("context_used", False),
        "context_reason": reply.get("context_reason"),
        "context_categories": reply.get("context_categories", []),
        "user_message": _serialize_message(user_msg),
        "assistant_message": {
            **_serialize_message(assistant_msg),
            "ai_configured": reply.get("ai_configured", False),
            "context_used": reply.get("context_used", False),
            "context_categories": reply.get("context_categories", []),
        },
    }
