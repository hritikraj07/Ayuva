import asyncio
import json
import os
import re
import time
from typing import Any, Dict, List, Optional, Tuple

import httpx
from google import genai
from google.genai import errors as genai_errors
from google.genai import types as genai_types
from sqlalchemy.orm import Session

from backend.config import get_settings
from backend.models import (
    Allergy,
    DoctorSummary,
    LabResult,
    MedicalCondition,
    MedicalDocument,
    MedicalTimelineEvent,
    MedicationRecord,
    PatientProfile,
    User,
)
from backend.services.ocr_extraction import extract_structured_from_text, run_ocr_on_bytes

settings = get_settings()

FALLBACK_GEMINI_MODELS = [
    "gemini-3-flash-preview",
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite-preview",
    "gemini-flash-latest",
]

_GEMINI_CLIENT_CACHE: Dict[Tuple[str, int], genai.Client] = {}
_UNHEALTHY_MODEL_UNTIL: Dict[str, float] = {}
_MODEL_COOLDOWN_SECONDS = 300.0


def _get_gemini_client(api_key: str) -> genai.Client:
    cache_key = (api_key, id(genai.Client))
    client = _GEMINI_CLIENT_CACHE.get(cache_key)
    if client is None:
        client = genai.Client(
            api_key=api_key,
            http_options=genai_types.HttpOptions(
                api_version="v1beta",
                timeout=12000,
                retry_options=genai_types.HttpRetryOptions(attempts=1),
            ),
        )
        _GEMINI_CLIENT_CACHE[cache_key] = client
    return client

HEALTHCARE_SAFETY_SYSTEM_INSTRUCTION = """You are Ayuva Clinical Assistant, an educational healthcare information assistant. You are NOT a licensed physician, medical practitioner, or diagnostic tool.

NON-NEGOTIABLE CLINICAL SAFETY & GROUNDING RULES:
1. Role & Scope: Always act as a calm, plain-language educational healthcare guide. Never claim a definitive medical diagnosis, never independently prescribe medication, and never advise changing or stopping a doctor-prescribed treatment.
2. Strict Grounding: Distinguish clearly between (a) facts documented in the user's provided medical records/attachments and (b) general educational medical knowledge. NEVER invent patient history, past reports, lab values, allergies, prescriptions, or external URLs/citations. If requested personal information is missing from the provided context, state explicitly that it is not available in their records.
3. Images & Attachments: For uploaded prescription, lab report, or packaging images, extract and explain only what is visibly readable. Never claim that a photo establishes a definitive diagnosis. If image text is blurry, partial, or ambiguous, clearly explain the uncertainty and ask the user to confirm or upload a clearer photo.
4. Emergency Recognition: If the user describes potential red-flag symptoms (e.g., chest pain, shortness of breath, severe bleeding, stroke signs, anaphylaxis, suicidal thoughts, overdose), prioritize immediate emergency guidance right at the top without delaying care with lengthy follow-up questions. Avoid unnecessary alarmism for routine non-urgent questions.
5. Output Structure: Keep answers concise, well-structured, and easy to read using Markdown headings when helpful (`### Documented Facts`, `### Plain-Language Explanation`, `### Precautions & Questions for Your Doctor`) and short bullet points. Recommend professional medical evaluation when symptoms, abnormal results, or medication changes are involved.
6. Limitations: Do not fabricate citations or claim external source verification unless source facts were explicitly provided in context."""

EMERGENCY_KEYWORDS = [
    "chest pain",
    "chest tightness",
    "crushing chest",
    "shortness of breath",
    "difficulty breathing",
    "can't breathe",
    "cannot breathe",
    "trouble breathing",
    "throat swelling",
    "tongue swelling",
    "anaphylaxis",
    "slurred speech",
    "facial droop",
    "sudden weakness",
    "sudden numbness",
    "severe bleeding",
    "coughing up blood",
    "vomiting blood",
    "unconscious",
    "passed out",
    "seizure",
    "suicidal",
    "kill myself",
    "self harm",
    "overdose",
]


class GeminiServiceError(Exception):
    """Structured server-side error for Gemini API configuration or runtime failures."""

    def __init__(self, status_code: int, detail: str, error_code: str = "gemini_error"):
        super().__init__(detail)
        self.status_code = status_code
        self.detail = detail
        self.error_code = error_code


def get_active_gemini_key() -> str:
    return (os.getenv("GEMINI_API_KEY", "") or settings.GEMINI_API_KEY or "").strip()


def get_active_gemini_model() -> str:
    return (os.getenv("LLM_MODEL", "") or settings.LLM_MODEL or "gemini-flash-latest").strip()


def _sanitize_error_text(raw: str) -> str:
    cleaned = re.sub(r"(AIza[0-9A-Za-z\-_]{10,}|key=[^&\s]+)", "[REDACTED]", str(raw))
    return cleaned[:280]


def _truncate_text(values: Any, max_len: int = 420) -> Optional[str]:
    if not values:
        return None
    raw = " ".join(str(v) for v in values) if isinstance(values, list) else str(values)
    cleaned = re.sub(r"\s+", " ", raw).strip()
    if len(cleaned) <= max_len:
        return cleaned
    return cleaned[: max_len - 3].rstrip() + "..."


async def search_openfda_medicines(query: str) -> Dict[str, Any]:
    """Query the live OpenFDA official drug label API for medicine safety & label metadata."""
    q = (query or "").strip()
    if not q:
        return {"medicines": [], "source": "OpenFDA Drug Label API (api.fda.gov)", "error": None}

    safe_q = re.sub(r"[^a-zA-Z0-9\-\s]", " ", q).strip()
    if not safe_q:
        return {"medicines": [], "source": "OpenFDA Drug Label API (api.fda.gov)", "error": None}

    search_expr = f'openfda.generic_name:"{safe_q}" OR openfda.brand_name:"{safe_q}"'
    try:
        async with httpx.AsyncClient(timeout=12.0) as client:
            resp = await client.get(
                "https://api.fda.gov/drug/label.json",
                params={"search": search_expr, "limit": 5},
            )
            if resp.status_code == 404:
                resp = await client.get(
                    "https://api.fda.gov/drug/label.json",
                    params={"search": f"openfda.generic_name:{safe_q}", "limit": 5},
                )
            if resp.status_code == 404:
                return {"medicines": [], "source": "OpenFDA Drug Label API (api.fda.gov)", "error": None}
            if resp.status_code != 200:
                return {
                    "medicines": [],
                    "source": "OpenFDA Drug Label API (api.fda.gov)",
                    "error": f"OpenFDA returned HTTP {resp.status_code}.",
                }
            payload = resp.json()
    except Exception:
        return {
            "medicines": [],
            "source": "OpenFDA Drug Label API (api.fda.gov)",
            "error": "Unable to reach OpenFDA drug reference API right now.",
        }

    results: List[Dict[str, Any]] = []
    seen_keys = set()
    for item in payload.get("results", []):
        openfda = item.get("openfda") or {}
        generic_names = openfda.get("generic_name") or []
        brand_names = openfda.get("brand_name") or []
        pharm_classes = openfda.get("pharm_class_epc") or openfda.get("pharm_class_moa") or []
        generic_label = generic_names[0] if generic_names else (brand_names[0] if brand_names else safe_q.title())
        dedup_key = generic_label.lower()
        if dedup_key in seen_keys:
            continue
        seen_keys.add(dedup_key)

        set_id = item.get("set_id") or item.get("id") or ""
        results.append(
            {
                "key": dedup_key,
                "generic_name": generic_label,
                "brand_names": brand_names[:4],
                "drug_class": ", ".join(pharm_classes[:2]) if pharm_classes else "FDA Listed Drug Product",
                "uses": _truncate_text(item.get("indications_and_usage"), 360) or "Refer to official FDA label indications.",
                "precautions": _truncate_text(item.get("warnings_and_cautions") or item.get("warnings") or item.get("boxed_warning"), 400)
                or "Review full prescribing warnings with a licensed clinician or pharmacist.",
                "side_effects": _truncate_text(item.get("adverse_reactions"), 340) or "Not summarized in label snippet.",
                "interactions": _truncate_text(item.get("drug_interactions"), 340) or "Check interactions with your pharmacist.",
                "storage": _truncate_text(item.get("storage_and_handling"), 220) or "Follow manufacturer package storage instructions.",
                "source": "OpenFDA Drug Label API",
                "source_url": f"https://dailymed.nlm.nih.gov/dailymed/search.cfm?query={generic_label.replace(' ', '+')}" if not set_id else f"https://api.fda.gov/drug/label.json?search=set_id:{set_id}",
            }
        )

    return {"medicines": results, "source": "OpenFDA Drug Label API (api.fda.gov)", "error": None}


def extract_attachment_ocr(file_bytes: bytes, ext: str) -> Dict[str, Any]:
    """Run local pypdf + RapidOCR on user-uploaded chat attachments without inventing text."""
    ocr_text, confidence, engine = run_ocr_on_bytes(file_bytes, ext)
    extracted = extract_structured_from_text(ocr_text, "lab_report") if ocr_text.strip() else {}
    return {
        "ocr_text": ocr_text.strip(),
        "confidence": confidence,
        "engine": engine,
        "extracted": extracted,
        "uncertain": confidence < 0.72 or len(ocr_text.strip()) < 15,
    }


def _select_relevant_patient_context(
    db: Session,
    user: User,
    user_message: str,
    use_vault_context: bool,
    attached_doc: Optional[MedicalDocument],
) -> Tuple[Dict[str, Any], Dict[str, Any]]:
    """Retrieve ONLY relevant, authenticated, and consented records for the current query."""
    profile = db.query(PatientProfile).filter(PatientProfile.user_id == user.id).first()
    if profile and not profile.ai_consent:
        return {"enabled": False}, {
            "context_used": False,
            "reason": "disabled_by_profile_consent",
            "categories_included": [],
        }

    if not use_vault_context:
        return {"enabled": False}, {
            "context_used": False,
            "reason": "disabled_for_conversation",
            "categories_included": [],
        }

    lower_q = user_message.lower()
    wants_allergy = any(k in lower_q for k in ["allerg", "reaction", "rash", "sensitiv", "penicillin", "safe", "interact", "take", "medicine", "med", "pill", "tablet", "drug", "prescription", "rx", "summary", "history"])
    wants_meds = any(k in lower_q for k in ["med", "pill", "tablet", "rx", "prescription", "drug", "dosage", "dose", "interact", "side effect", "summary", "history", "compare", "allerg"])
    wants_labs = any(k in lower_q for k in ["lab", "test", "blood", "hba1c", "glucose", "sugar", "hemoglobin", "platelet", "creatinine", "cbc", "lipid", "cholesterol", "range", "abnormal", "compare", "trend", "report", "summary", "history"])
    wants_history = any(k in lower_q for k in ["history", "condition", "diagnos", "disease", "summary", "timeline", "hospital", "surgery", "discharge", "doctor", "visit", "preference"])
    wants_docs = any(k in lower_q for k in ["document", "record", "file", "upload", "report", "prescription", "summary", "history"])

    # Default to broad targeted overview only when query asks about personal records specifically
    mentions_personal = any(k in lower_q for k in ["my ", "me ", "i have", "i take", "vault", "profile", "record"])
    if mentions_personal and not (wants_allergy or wants_meds or wants_labs or wants_history):
        wants_allergy = True
        wants_meds = True
        wants_labs = True
        wants_history = True

    ctx: Dict[str, Any] = {
        "enabled": True,
        "patient_name": user.full_name,
    }
    categories_included: List[str] = []
    citations: List[Dict[str, Any]] = []

    if profile:
        prefs = {}
        try:
            prefs = json.loads(profile.health_preferences_json or "{}")
        except Exception:
            prefs = {}
        if wants_history or profile.blood_group or prefs:
            ctx["profile"] = {
                "blood_group": profile.blood_group,
                "gender": profile.gender,
                "health_preferences": prefs if wants_history else None,
            }

    if wants_allergy:
        allergies = (
            db.query(Allergy)
            .filter(Allergy.patient_id == user.id)
            .order_by(Allergy.severity.desc())
            .limit(12)
            .all()
        )
        ctx["allergies"] = [
            {"allergen": a.allergen, "severity": a.severity, "reaction": a.reaction}
            for a in allergies
        ]
        categories_included.append("allergies")

    if wants_meds:
        meds = (
            db.query(MedicationRecord)
            .filter(MedicationRecord.patient_id == user.id)
            .order_by(MedicationRecord.is_current.desc(), MedicationRecord.created_at.desc())
            .limit(12)
            .all()
        )
        ctx["medications"] = [
            {
                "name": m.medicine_name,
                "dosage": m.dosage,
                "frequency": m.frequency,
                "instructions": m.instructions,
                "is_current": m.is_current,
            }
            for m in meds
        ]
        categories_included.append("medications")

    if wants_labs:
        all_labs = (
            db.query(LabResult)
            .filter(LabResult.patient_id == user.id)
            .order_by(LabResult.test_date.desc().nullslast(), LabResult.id.desc())
            .limit(20)
            .all()
        )
        # Filter down to specifically named tests if mentioned in question
        specific_labs = [l for l in all_labs if l.test_name.lower() in lower_q]
        selected_labs = specific_labs[:10] if specific_labs else all_labs[:8]
        ctx["lab_results"] = [
            {
                "test_name": l.test_name,
                "value": l.value_text if l.value_text is not None else l.value_numeric,
                "unit": l.unit,
                "reference_range": l.reference_range,
                "flag": l.flag,
                "is_abnormal": l.is_abnormal,
                "date": l.test_date.isoformat() if l.test_date else None,
            }
            for l in selected_labs
        ]
        categories_included.append("lab_results")

    if wants_history:
        conditions = (
            db.query(MedicalCondition)
            .filter(MedicalCondition.patient_id == user.id)
            .order_by(MedicalCondition.diagnosed_date.desc().nullslast())
            .limit(10)
            .all()
        )
        events = (
            db.query(MedicalTimelineEvent)
            .filter(MedicalTimelineEvent.patient_id == user.id)
            .order_by(MedicalTimelineEvent.event_date.desc())
            .limit(8)
            .all()
        )
        latest_summary = (
            db.query(DoctorSummary)
            .filter(DoctorSummary.patient_id == user.id)
            .order_by(DoctorSummary.generated_at.desc())
            .first()
        )
        ctx["conditions"] = [
            {"name": c.condition_name, "status": c.status, "date": c.diagnosed_date.isoformat() if c.diagnosed_date else None}
            for c in conditions
        ]
        ctx["recent_timeline"] = [
            {"title": e.title, "type": e.event_type, "date": e.event_date.isoformat(), "description": e.description}
            for e in events
        ]
        if latest_summary:
            ctx["latest_summary_text"] = (latest_summary.summary_json or "")[:1200]
        categories_included.append("medical_history")

    if wants_docs or attached_doc is not None:
        docs_q = (
            db.query(MedicalDocument)
            .filter(MedicalDocument.patient_id == user.id)
            .order_by(MedicalDocument.document_date.desc().nullslast(), MedicalDocument.created_at.desc())
            .limit(10)
            .all()
        )
        relevant_docs = [
            d for d in docs_q
            if attached_doc and d.id == attached_doc.id
            or any(tok in (d.title + " " + (d.primary_condition or "")).lower() for tok in lower_q.split() if len(tok) >= 4)
        ]
        selected_docs = relevant_docs[:4] if relevant_docs else docs_q[:3]
        for d in selected_docs:
            citations.append({"type": "vault_document", "document_id": d.id, "label": f"{d.title} ({d.category})"})
        if selected_docs:
            ctx["relevant_documents"] = [
                {
                    "id": d.id,
                    "title": d.title,
                    "category": d.category,
                    "date": d.document_date.isoformat() if d.document_date else None,
                    "doctor": d.doctor_name,
                    "condition": d.primary_condition,
                    "is_verified": d.is_verified,
                }
                for d in selected_docs
            ]
            categories_included.append("vault_documents")

    return ctx, {
        "context_used": True,
        "reason": "matched_relevant_records" if categories_included else "vault_enabled_no_specific_match",
        "categories_included": categories_included,
        "citations": citations,
    }


def _build_generate_config(model_name: str) -> genai_types.GenerateContentConfig:
    low = model_name.lower()
    if any(tag in low for tag in ("3.5-flash", "3.6-flash", "3.7-flash")):
        return genai_types.GenerateContentConfig(
            system_instruction=HEALTHCARE_SAFETY_SYSTEM_INSTRUCTION,
            temperature=0.2,
            max_output_tokens=750,
            thinking_config=genai_types.ThinkingConfig(thinking_level=genai_types.ThinkingLevel.MINIMAL),
        )
    return genai_types.GenerateContentConfig(
        system_instruction=HEALTHCARE_SAFETY_SYSTEM_INSTRUCTION,
        temperature=0.2,
        max_output_tokens=750,
    )


def _call_gemini_sync(
    *,
    api_key: str,
    model_name: str,
    contents: List[genai_types.Content],
) -> Tuple[str, str]:
    """Execute Gemini generate_content using cached google-genai SDK client with instant fallback."""
    client = _get_gemini_client(api_key)
    now = time.monotonic()
    ordered = [model_name] + [m for m in FALLBACK_GEMINI_MODELS if m != model_name]
    candidates = [m for m in ordered if _UNHEALTHY_MODEL_UNTIL.get(m, 0.0) <= now] or ordered

    last_not_found_err: Optional[Exception] = None
    last_rate_limit_err: Optional[Exception] = None
    for candidate_model in candidates:
        try:
            response = client.models.generate_content(
                model=candidate_model,
                contents=contents,
                config=_build_generate_config(candidate_model),
            )
            text = getattr(response, "text", None)
            if text and text.strip():
                return text.strip(), f"gemini:{candidate_model}"

            cands = getattr(response, "candidates", None) or []
            if cands:
                finish_reason = getattr(cands[0], "finish_reason", None)
                raise GeminiServiceError(
                    502,
                    f"Gemini returned an empty or filtered response (finish_reason={finish_reason}). Please rephrase or verify the attachment.",
                    "gemini_empty_response",
                )
            raise GeminiServiceError(
                502,
                "Gemini returned a malformed response without content candidates.",
                "gemini_malformed_response",
            )
        except GeminiServiceError:
            raise
        except genai_errors.APIError as exc:
            code = getattr(exc, "code", None) or 502
            msg_low = str(exc).lower()
            if code in (404, 503) or "not found" in msg_low or "not supported" in msg_low or "unavailable" in msg_low:
                _UNHEALTHY_MODEL_UNTIL[candidate_model] = time.monotonic() + _MODEL_COOLDOWN_SECONDS
                last_not_found_err = exc
                continue
            if code == 429 or "resource_exhausted" in msg_low or "quota" in msg_low or "rate limit" in msg_low or "too many requests" in msg_low:
                _UNHEALTHY_MODEL_UNTIL[candidate_model] = time.monotonic() + 60.0
                last_rate_limit_err = exc
                continue
            if code in (401, 403) or "api key" in msg_low or "permission" in msg_low:
                raise GeminiServiceError(
                    502,
                    "Gemini API authentication failed. Please check that GEMINI_API_KEY is valid.",
                    "gemini_auth_error",
                ) from exc
            if code in (500, 502, 504):
                raise GeminiServiceError(
                    503,
                    "Gemini API is temporarily unavailable. Please retry in a few seconds.",
                    "gemini_unavailable",
                ) from exc
            raise GeminiServiceError(
                502,
                f"Gemini API error: {_sanitize_error_text(str(exc))}",
                "gemini_api_error",
            ) from exc
        except Exception as exc:
            raise GeminiServiceError(
                502,
                f"Failed to communicate with Gemini API: {_sanitize_error_text(str(exc))}",
                "gemini_transport_error",
            ) from exc

    if last_rate_limit_err is not None:
        raise GeminiServiceError(
            429,
            "Gemini API rate limit reached. Please wait a moment and click Retry.",
            "gemini_rate_limited",
        ) from last_rate_limit_err

    raise GeminiServiceError(
        503,
        f"Configured Gemini model '{model_name}' is unavailable: {_sanitize_error_text(str(last_not_found_err))}",
        "gemini_model_unavailable",
    )


async def generate_assistant_reply(
    *,
    db: Session,
    user: User,
    user_message: str,
    use_vault_context: bool,
    history: List[Dict[str, str]],
    attached_doc: Optional[MedicalDocument] = None,
    uploaded_file_bytes: Optional[bytes] = None,
    uploaded_file_ext: str = ".png",
    uploaded_mime_type: Optional[str] = None,
) -> Dict[str, Any]:
    lower_q = user_message.lower()
    safety_flags: List[str] = []

    # 1. Immediate server-side emergency screening before any model latency
    matched_red_flags = [kw for kw in EMERGENCY_KEYWORDS if kw in lower_q]
    if matched_red_flags:
        safety_flags.append("emergency_red_flag")
        reply = (
            "### Urgent Safety Warning\n\n"
            f"Your message mentions symptoms (**{', '.join(matched_red_flags)}**) that may indicate a medical emergency.\n\n"
            "- **Immediate Action:** Call your local emergency medical services or go to the nearest hospital emergency department right away.\n"
            "- Do not wait for automated guidance or attempt self-treatment for emergency warning signs."
        )
        return {
            "content": reply,
            "citations": [],
            "safety_flags": safety_flags,
            "is_emergency": True,
            "ai_configured": bool(get_active_gemini_key()),
            "context_used": False,
            "context_reason": "emergency_bypass",
            "context_categories": [],
            "provider_mode": "emergency_safety_rule",
        }

    # 2. Enforce GEMINI_API_KEY configuration explicitly (never silently fake AI prose)
    api_key = get_active_gemini_key()
    if not api_key:
        raise GeminiServiceError(
            503,
            "Gemini AI service is not configured. Set GEMINI_API_KEY on the server to enable the AI Healthcare Assistant.",
            "gemini_not_configured",
        )

    # 3. Scoped, consented personal medical context retrieval
    vault_ctx, ctx_meta = _select_relevant_patient_context(
        db=db,
        user=user,
        user_message=user_message,
        use_vault_context=use_vault_context,
        attached_doc=attached_doc,
    )
    citations: List[Dict[str, Any]] = list(ctx_meta.get("citations", []))

    # 4. Process attached Vault Document and/or uploaded file (Image -> multimodal + OCR; PDF -> pypdf/RapidOCR)
    attachment_ocr: Optional[Dict[str, Any]] = None
    is_image_upload = bool(uploaded_file_bytes and uploaded_file_ext.lower() in {".png", ".jpg", ".jpeg"})
    is_pdf_upload = bool(uploaded_file_bytes and uploaded_file_ext.lower() == ".pdf")

    if uploaded_file_bytes:
        attachment_ocr = extract_attachment_ocr(uploaded_file_bytes, uploaded_file_ext)
        safety_flags.append("attachment_processed")

    if attached_doc:
        citations.append(
            {"type": "attached_document", "document_id": attached_doc.id, "label": f"Attached: {attached_doc.title}"}
        )

    # Build multi-turn conversation history for follow-up continuity (last 10 turns)
    contents: List[genai_types.Content] = []
    for turn in history[-10:]:
        role = "model" if turn.get("role") == "assistant" else "user"
        txt = (turn.get("content") or "").strip()
        if txt:
            contents.append(genai_types.Content(role=role, parts=[genai_types.Part.from_text(text=txt)]))

    # Construct grounded current-turn prompt payload
    context_preamble_lines: List[str] = []
    if ctx_meta["context_used"]:
        context_preamble_lines.append(
            "CONSENTED PERSONAL MEDICAL CONTEXT (ONLY use facts explicitly listed below; if absent, say unavailable):\n"
            + json.dumps(vault_ctx, default=str)[:3500]
        )
    else:
        context_preamble_lines.append(
            f"PERSONAL MEDICAL CONTEXT STATUS: Disabled ({ctx_meta['reason']}). Answer strictly using general educational medical information and any files attached to this message."
        )

    if attached_doc:
        doc_ocr = (attached_doc.ocr_text or "").strip()
        context_preamble_lines.append(
            f"ATTACHED VAULT DOCUMENT ({attached_doc.title}, category={attached_doc.category}, verified={attached_doc.is_verified}):\n"
            + (doc_ocr[:3500] if doc_ocr else "[No extracted text available in attached vault document]")
        )

    if is_pdf_upload and attachment_ocr is not None:
        pdf_txt = attachment_ocr.get("ocr_text") or ""
        context_preamble_lines.append(
            f"UPLOADED PDF DOCUMENT OCR EXTRACTION ({attachment_ocr.get('engine')}, confidence={attachment_ocr.get('confidence')}):\n"
            + (pdf_txt[:3500] if pdf_txt else "[No readable text could be extracted from the uploaded PDF; inform user and ask for a clearer PDF.]")
        )
        citations.append({"type": "uploaded_pdf", "label": "Uploaded PDF OCR text"})
    elif is_image_upload and attachment_ocr is not None:
        ocr_txt = attachment_ocr.get("ocr_text") or ""
        context_preamble_lines.append(
            f"UPLOADED IMAGE SUPPLEMENTAL OCR ({attachment_ocr.get('engine')}, confidence={attachment_ocr.get('confidence')}):\n"
            + (ocr_txt[:1500] if ocr_txt else "[Minimal/no text detected by local OCR; inspect attached image carefully and explain uncertainty if unclear.]")
        )
        citations.append({"type": "uploaded_image", "label": "Uploaded image attachment"})

    current_parts: List[genai_types.Part] = [
        genai_types.Part.from_text(
            text="\n\n".join(context_preamble_lines) + f"\n\nUSER QUESTION:\n{user_message}"
        )
    ]
    if is_image_upload and uploaded_file_bytes:
        mime = uploaded_mime_type or ("image/jpeg" if uploaded_file_ext.lower() in {".jpg", ".jpeg"} else "image/png")
        current_parts.append(genai_types.Part.from_bytes(data=uploaded_file_bytes, mime_type=mime))

    contents.append(genai_types.Content(role="user", parts=current_parts))

    model_name = get_active_gemini_model()
    try:
        reply_text, provider_mode = await asyncio.wait_for(
            asyncio.to_thread(_call_gemini_sync, api_key=api_key, model_name=model_name, contents=contents),
            timeout=settings.GEMINI_TIMEOUT_SECONDS,
        )
    except asyncio.TimeoutError as exc:
        raise GeminiServiceError(
            504,
            "Gemini API request timed out. Please check your connection and click Retry.",
            "gemini_timeout",
        ) from exc

    return {
        "content": reply_text,
        "citations": citations,
        "safety_flags": safety_flags,
        "is_emergency": False,
        "ai_configured": True,
        "context_used": ctx_meta["context_used"],
        "context_reason": ctx_meta["reason"],
        "context_categories": ctx_meta["categories_included"],
        "provider_mode": provider_mode,
    }
