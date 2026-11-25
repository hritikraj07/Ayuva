import asyncio
import io
import json
import os
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import httpx
import numpy as np
from google import genai
from google.genai import types as genai_types
from pypdf import PdfReader

from backend.config import get_settings

settings = get_settings()

VISION_MODEL_CANDIDATES = [
    "gemini-flash-lite-latest",
    "gemini-3.1-flash-lite-preview",
    "gemini-3-flash-preview",
    "gemini-flash-latest",
]

_RAPID_OCR_INSTANCE = None


def _get_ocr_engine():
    global _RAPID_OCR_INSTANCE
    if _RAPID_OCR_INSTANCE is None:
        from rapidocr_onnxruntime import RapidOCR

        _RAPID_OCR_INSTANCE = RapidOCR()
    return _RAPID_OCR_INSTANCE


ALLOWED_EXTENSIONS = {".pdf", ".jpg", ".jpeg", ".png"}
ALLOWED_MIME_TYPES = {
    ".pdf": "application/pdf",
    ".jpg": "image/jpeg",
    ".jpeg": "image/jpeg",
    ".png": "image/png",
}


def validate_upload_bytes(filename: str, content: bytes) -> Tuple[str, str]:
    """Validate file extension, size, and magic-byte header."""
    ext = Path(filename).suffix.lower()
    if ext not in ALLOWED_EXTENSIONS:
        raise ValueError("Unsupported file type. Allowed formats: PDF, JPG, JPEG, PNG.")
    if len(content) == 0:
        raise ValueError("Uploaded file is empty.")
    if len(content) > settings.MAX_UPLOAD_SIZE_BYTES:
        max_mb = settings.MAX_UPLOAD_SIZE_BYTES // (1024 * 1024)
        raise ValueError(f"File exceeds maximum size of {max_mb} MB.")

    if ext == ".pdf" and not content.lstrip().startswith(b"%PDF"):
        raise ValueError("Invalid PDF header bytes.")
    if ext in {".jpg", ".jpeg"} and not content.startswith(b"\xff\xd8\xff"):
        raise ValueError("Invalid JPEG image signature.")
    if ext == ".png" and not content.startswith(b"\x89PNG\r\n\x1a\n"):
        raise ValueError("Invalid PNG image signature.")

    return ext, ALLOWED_MIME_TYPES[ext]


def _preprocess_image_for_ocr(image_bytes: bytes) -> np.ndarray:
    arr = np.frombuffer(image_bytes, dtype=np.uint8)
    img = cv2.imdecode(arr, cv2.IMREAD_COLOR)
    if img is None:
        raise ValueError("Unable to decode uploaded image.")
    h, w = img.shape[:2]
    if max(h, w) < 1200:
        scale = min(2.0, 1400.0 / max(h, w))
        img = cv2.resize(img, None, fx=scale, fy=scale, interpolation=cv2.INTER_CUBIC)
    lab = cv2.cvtColor(img, cv2.COLOR_BGR2LAB)
    l_ch, a_ch, b_ch = cv2.split(lab)
    clahe = cv2.createCLAHE(clipLimit=2.0, tileGridSize=(8, 8))
    cl = clahe.apply(l_ch)
    merged = cv2.merge((cl, a_ch, b_ch))
    enhanced = cv2.cvtColor(merged, cv2.COLOR_LAB2BGR)
    return enhanced


def run_ocr_on_bytes(content: bytes, ext: str) -> Tuple[str, float, str]:
    """Extract text from PDF or image bytes via pypdf and RapidOCR."""
    if ext == ".pdf":
        reader = PdfReader(io.BytesIO(content))
        page_texts: List[str] = []
        for page in reader.pages:
            txt = (page.extract_text() or "").strip()
            if txt:
                page_texts.append(txt)
        joined = "\n\n".join(page_texts).strip()
        if len(joined) >= 25:
            return joined, 0.96, "pypdf_text"

        # Scanned PDF fallback: check embedded images on pages with RapidOCR
        ocr_lines: List[str] = []
        confidences: List[float] = []
        ocr = _get_ocr_engine()
        for page in reader.pages:
            for image_file in getattr(page, "images", []):
                try:
                    img = _preprocess_image_for_ocr(image_file.data)
                    result, _ = ocr(img)
                    if result:
                        for item in result:
                            ocr_lines.append(item[1])
                            confidences.append(float(item[2]))
                except Exception:
                    continue
        if ocr_lines:
            avg_conf = sum(confidences) / max(len(confidences), 1)
            return "\n".join(ocr_lines), round(avg_conf, 3), "rapidocr_pdf_images"
        return joined or "", 0.35 if not joined else 0.75, "pypdf_sparse"

    img = _preprocess_image_for_ocr(content)
    ocr = _get_ocr_engine()
    result, _ = ocr(img)
    if not result:
        return "", 0.0, "rapidocr_image"
    lines: List[str] = []
    confs: List[float] = []
    for item in result:
        lines.append(str(item[1]).strip())
        confs.append(float(item[2]))
    avg_conf = sum(confs) / max(len(confs), 1)
    return "\n".join(lines), round(avg_conf, 3), "rapidocr_image"


def infer_category(text: str, filename: str) -> str:
    lower = f"{filename}\n{text}".lower()
    if any(k in lower for k in ["discharge summary", "admission date", "date of discharge", "hospital course", "ward"]):
        return "discharge_summary"
    if any(k in lower for k in ["reference range", "hemoglobin", "hba1c", "platelet", "creatinine", "cbc", "lipid", "pathology", "lab report", "specimen"]):
        return "lab_report"
    if any(k in lower for k in ["rx", "tab.", "tablet", "cap.", "capsule", "twice daily", "once daily", "mg", "prescribed", "prescription", "syrup"]):
        return "prescription"
    if any(k in lower for k in ["medical certificate", "fit to resume", "unfit for", "rest advised", "fitness certificate"]):
        return "medical_certificate"
    if any(k in lower for k in ["x-ray", "mri", "ct scan", "ultrasound", "ecg", "echocardiogram", "impression:", "radiology"]):
        return "diagnostic_report"
    return "lab_report" if ":" in lower and any(u in lower for u in ["mg/dl", "g/dl", "u/l", "%"]) else "prescription"


def _parse_date_candidate(raw: str) -> Optional[str]:
    cleaned = raw.strip().replace(".", "-").replace("/", "-")
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d-%m-%y", "%m-%d-%Y", "%d %b %Y", "%d %B %Y", "%b %d, %Y", "%B %d, %Y"):
        try:
            dt = datetime.strptime(raw.strip(), fmt).date()
            return dt.isoformat()
        except ValueError:
            continue
    for fmt in ("%Y-%m-%d", "%d-%m-%Y", "%d-%m-%y"):
        try:
            dt = datetime.strptime(cleaned, fmt).date()
            return dt.isoformat()
        except ValueError:
            continue
    return None


def _evaluate_lab_flag(value: Optional[float], ref_range: Optional[str]) -> Tuple[str, bool]:
    if value is None or not ref_range:
        return "normal", False
    ref = ref_range.strip()
    range_match = re.search(r"(\d+(?:\.\d+)?)\s*[-–to]+\s*(\d+(?:\.\d+)?)", ref, re.IGNORECASE)
    if range_match:
        low = float(range_match.group(1))
        high = float(range_match.group(2))
        if value < low:
            return ("critical" if value < low * 0.7 else "low"), True
        if value > high:
            return ("critical" if value > high * 1.4 else "high"), True
        return "normal", False
    lt_match = re.search(r"<\s*=?\s*(\d+(?:\.\d+)?)", ref)
    if lt_match:
        limit = float(lt_match.group(1))
        if value > limit:
            return ("critical" if value > limit * 1.4 else "high"), True
        return "normal", False
    gt_match = re.search(r">\s*=?\s*(\d+(?:\.\d+)?)", ref)
    if gt_match:
        limit = float(gt_match.group(1))
        if value < limit:
            return "low", True
        return "normal", False
    return "normal", False


def extract_structured_from_text(ocr_text: str, category: str) -> Dict[str, Any]:
    """Extract only explicitly present medical entities without inventing missing fields."""
    lines = [line.strip() for line in ocr_text.splitlines() if line.strip()]

    patient_name: Optional[str] = None
    doctor_name: Optional[str] = None
    hospital_name: Optional[str] = None
    doc_date: Optional[str] = None
    diagnosis: Optional[str] = None
    medications: List[Dict[str, Any]] = []
    lab_values: List[Dict[str, Any]] = []
    allergies: List[str] = []
    observations: List[str] = []

    for line in lines:
        low = line.lower()

        if patient_name is None:
            m = re.match(r"^(?:patient\s*name|name\s*of\s*patient|patient)\s*[:\-]\s*(.+)$", line, re.IGNORECASE)
            if m:
                candidate = re.split(r"\b(?:age|sex|gender|dob|id|uhid)\b", m.group(1), flags=re.IGNORECASE)[0].strip(" ,|-")
                if len(candidate) >= 2:
                    patient_name = candidate[:140]

        if doctor_name is None:
            m = re.search(r"(?:doctor|consultant|physician|dr\.?)\s*[:\-]?\s*(Dr\.?\s+[A-Z][A-Za-z.\s]{2,60})", line)
            if m:
                doctor_name = re.split(r"\s{2,}|,|\b(?:MD|MBBS|MS|DM|Reg|Dept)\b", m.group(1))[0].strip()

        if hospital_name is None:
            if any(k in low for k in ["hospital", "clinic", "medical center", "diagnostics", "institute", "healthcare"]) and not low.startswith("diagnosis"):
                m = re.match(r"^(?:hospital|facility|center|clinic)\s*[:\-]\s*(.+)$", line, re.IGNORECASE)
                hospital_name = m.group(1).strip()[:160] if m else line[:160]

        if doc_date is None:
            m = re.search(
                r"(?:date|report\s*date|visit\s*date|collected|discharge\s*date)\s*[:\-]?\s*(\d{4}[-/]\d{1,2}[-/]\d{1,2}|\d{1,2}[-/]\d{1,2}[-/]\d{2,4}|\d{1,2}\s+[A-Za-z]{3,9}\s+\d{4}|[A-Za-z]{3,9}\s+\d{1,2},\s*\d{4})",
                line,
                re.IGNORECASE,
            )
            if m:
                doc_date = _parse_date_candidate(m.group(1))
            elif not doc_date:
                any_date = re.search(r"\b(\d{4}-\d{2}-\d{2}|\d{2}/\d{2}/\d{4})\b", line)
                if any_date:
                    doc_date = _parse_date_candidate(any_date.group(1))

        if diagnosis is None:
            m = re.match(r"^(?:diagnosis|impression|assessment|clinical\s*condition|condition|provisional\s*diagnosis)\s*[:\-]\s*(.+)$", line, re.IGNORECASE)
            if m:
                diagnosis = m.group(1).strip()[:240]

        if "allerg" in low:
            m = re.search(r"allerg(?:y|ies)\s*[:\-]\s*(.+)$", line, re.IGNORECASE)
            if m:
                val = m.group(1).strip()
                if not any(neg in val.lower() for neg in ["none", "no known", "nil", "nkda", "nka"]):
                    for item in re.split(r"[,;/]+", val):
                        cleaned = item.strip()
                        if len(cleaned) >= 2 and cleaned not in allergies:
                            allergies.append(cleaned)

        if any(low.startswith(p) for p in ["observation:", "note:", "notes:", "advice:", "recommendation:", "clinical note:"]):
            obs_text = line.split(":", 1)[1].strip()
            if obs_text:
                observations.append(obs_text)

        # Medication extraction
        med_match = re.match(
            r"^(?:[-*\d.)\s]+)?(?:tab\.?|tablet|cap\.?|capsule|syp\.?|syrup|inj\.?|rx)?\s*([A-Z][A-Za-z0-9\-\s]{2,40}?)\s+(\d+(?:\.\d+)?\s*(?:mg|mcg|g|ml|iu))\b(.*)$",
            line,
            re.IGNORECASE,
        )
        if med_match and not any(u in low for u in ["mg/dl", "g/dl", "reference", "ref:"]):
            med_name = med_match.group(1).strip(" :-")
            dosage = med_match.group(2).strip()
            tail = med_match.group(3).strip(" ,-|:")
            freq = None
            freq_match = re.search(
                r"\b(once daily|twice daily|thrice daily|OD|BD|TDS|TID|BID|QID|HS|at bedtime|every \d+ hours|morning|night|\d-\d-\d)\b",
                tail,
                re.IGNORECASE,
            )
            if freq_match:
                freq = freq_match.group(1)
            medications.append(
                {
                    "medicine_name": med_name,
                    "dosage": dosage,
                    "frequency": freq,
                    "instructions": tail if tail else None,
                }
            )
            continue

        # Lab test extraction (supports "Test Name: 10.8 g/dL (Ref: 12.0 - 15.5)" or pipe/tab columns)
        lab_match = re.match(
            r"^([A-Za-z][A-Za-z0-9\s/()\-]{2,48}?)\s*[:|\t]\s*(\d+(?:\.\d+)?)\s*([A-Za-z%/µu]+(?:/[A-Za-z]+)?)?\s*(?:\((?:ref(?:erence)?\s*(?:range)?\s*[:\-]?)?\s*([^)]+)\)|\[([^\]]+)\])?",
            line,
            re.IGNORECASE,
        )
        if lab_match and not any(skip in low for skip in ["date", "age", "phone", "bed", "reg", "uhid", "page", "dosage"]):
            t_name = lab_match.group(1).strip(" :-")
            val_str = lab_match.group(2).strip()
            unit = lab_match.group(3).strip() if lab_match.group(3) else None
            ref_range = (lab_match.group(4) or lab_match.group(5) or "").strip() or None
            if unit and unit.lower() in {"mg", "mcg", "ml"} and category == "prescription":
                pass
            else:
                val_num = float(val_str)
                flag, is_abn = _evaluate_lab_flag(val_num, ref_range)
                lab_values.append(
                    {
                        "test_name": t_name,
                        "value_numeric": val_num,
                        "value_text": val_str,
                        "unit": unit,
                        "reference_range": ref_range,
                        "flag": flag,
                        "is_abnormal": is_abn,
                    }
                )

    if not observations and diagnosis:
        observations.append(f"Documented clinical note: {diagnosis}")

    uncertain_fields: List[str] = []
    if len(ocr_text.strip()) < 30:
        uncertain_fields.append("Low readable text extracted; verify all fields manually against the original document.")
    for med in medications:
        if len(med["medicine_name"]) < 4 or not med.get("dosage"):
            uncertain_fields.append(f"Confirm medicine name/strength: {med['medicine_name']}")

    missing_fields: List[str] = []
    if not patient_name:
        missing_fields.append("patient_name")
    if not doctor_name:
        missing_fields.append("doctor_name")
    if not hospital_name:
        missing_fields.append("hospital_name")
    if not doc_date:
        missing_fields.append("document_date")
    if not diagnosis:
        missing_fields.append("diagnosis")
    if not allergies:
        missing_fields.append("allergies (not explicitly stated)")

    return {
        "patient_name": patient_name,
        "doctor_name": doctor_name,
        "hospital_name": hospital_name,
        "document_date": doc_date,
        "diagnosis": diagnosis,
        "medications": medications,
        "lab_values": lab_values,
        "allergies": allergies,
        "observations": observations[:6],
        "missing_fields": missing_fields,
        "uncertain_fields": uncertain_fields,
    }


async def extract_with_optional_llm(
    ocr_text: str,
    category: str,
    ai_consent: bool,
    file_bytes: Optional[bytes] = None,
    mime_type: Optional[str] = None,
    filename: str = "",
) -> Tuple[Dict[str, Any], str]:
    """Use Gemini Multimodal Vision (for images/PDFs & handwriting) or text LLM if consented; never invent absent facts."""
    baseline = extract_structured_from_text(ocr_text, category)
    gemini_key = (os.getenv("GEMINI_API_KEY", "") or settings.GEMINI_API_KEY or "").strip()
    openai_key = (os.getenv("OPENAI_API_KEY", "") or settings.OPENAI_API_KEY or "").strip()

    has_media = bool(file_bytes and mime_type in {"image/jpeg", "image/png", "application/pdf"})
    if not ai_consent or (not has_media and not ocr_text.strip()) or (not gemini_key and not openai_key):
        return baseline, "local_ocr_parser"

    prompt = (
        "You are a clinical medical document & handwriting transcription parser. "
        "Carefully examine the attached prescription/lab image or PDF (including cursive/handwritten doctor notes, stamps, printed tables, and OCR hints). "
        "Extract ONLY explicitly visible medical facts into strict JSON matching the schema below.\n"
        "RULES:\n"
        "1. NEVER invent, guess, or fabricate values that are absent. Use null or [] when not stated.\n"
        "2. For handwritten prescriptions: read Rx medicine lines carefully (Tab/Cap/Syp/Inj/Oint/Drops, brand or generic names, strengths like 500 mg, Indian schedules like 1-0-1 / OD / BD / TDS / HS / SOS, before/after food, duration). Fix broken OCR spacing on visible clinic/hospital/doctor/patient names (e.g. 'MAHARAOBHMSNGHHOSPITALKOTA' -> 'Maharao Bhimsingh Hospital, Kota').\n"
        "3. For lab or diagnostic reports: extract every test row into lab_values with numeric value (if numeric), unit, reference_range, flag ('normal'|'low'|'high'|'critical'), and is_abnormal.\n"
        "4. Convert document_date to YYYY-MM-DD when a full date is legible (interpret DD/MM/YYYY for Indian hospital slips); otherwise null.\n"
        "5. Provide detected_category as one of: 'prescription', 'lab_report', 'discharge_summary', 'diagnostic_report', 'medical_certificate'.\n"
        "6. Provide raw_transcription: a clean faithful plain-text transcription of all visible printed & handwritten text on the document. Note partially blurry words in uncertain_fields.\n\n"
        "JSON Schema:\n"
        "{\n"
        '  "detected_category": "prescription|lab_report|discharge_summary|diagnostic_report|medical_certificate",\n'
        '  "raw_transcription": string|null,\n'
        '  "patient_name": string|null,\n'
        '  "doctor_name": string|null,\n'
        '  "hospital_name": string|null,\n'
        '  "document_date": "YYYY-MM-DD"|null,\n'
        '  "diagnosis": string|null,\n'
        '  "medications": [{"medicine_name": string, "dosage": string|null, "frequency": string|null, "instructions": string|null}],\n'
        '  "lab_values": [{"test_name": string, "value_numeric": number|null, "value_text": string, "unit": string|null, "reference_range": string|null, "flag": "normal"|"low"|"high"|"critical", "is_abnormal": boolean}],\n'
        '  "allergies": [string],\n'
        '  "observations": [string],\n'
        '  "uncertain_fields": [string]\n'
        "}\n"
        f"\nFilename hint: {filename or 'document'}\n"
        + (f"Supplementary local OCR hint (may contain spacing/handwriting gaps):\n{ocr_text[:4500]}" if ocr_text.strip() else "Local OCR text was minimal or unavailable; read directly from the attached visual document.")
    )

    if gemini_key:
        configured = (os.getenv("LLM_MODEL", "") or settings.LLM_MODEL or "").strip()
        models_to_try: List[str] = []
        for candidate in ([configured] if configured and configured != "gemini-flash-latest" else []) + VISION_MODEL_CANDIDATES:
            if candidate and candidate not in models_to_try:
                models_to_try.append(candidate)

        contents: List[Any] = []
        if has_media and file_bytes and mime_type:
            contents.append(genai_types.Part.from_bytes(data=file_bytes, mime_type=mime_type))
        contents.append(prompt)

        def _call_gemini_sync(model_name: str) -> str:
            client = genai.Client(
                api_key=gemini_key,
                http_options=genai_types.HttpOptions(
                    api_version="v1beta",
                    timeout=14000,
                    retry_options=genai_types.HttpRetryOptions(attempts=1),
                ),
            )
            resp = client.models.generate_content(
                model=model_name,
                contents=contents,
                config=genai_types.GenerateContentConfig(
                    response_mime_type="application/json",
                    temperature=0.0,
                ),
            )
            return resp.text or ""

        for model_name in models_to_try:
            try:
                raw_json = await asyncio.to_thread(_call_gemini_sync, model_name)
                if not raw_json.strip():
                    continue
                parsed = json.loads(raw_json)
                if isinstance(parsed, dict):
                    return _merge_safe_extraction(parsed, baseline, prefer_llm=True), f"gemini_vision:{model_name}"
            except Exception:
                continue

    if openai_key and ocr_text.strip():
        try:
            async with httpx.AsyncClient(timeout=18.0) as client:
                resp = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {openai_key}"},
                    json={
                        "model": "gpt-4o-mini",
                        "response_format": {"type": "json_object"},
                        "temperature": 0,
                        "messages": [{"role": "user", "content": prompt}],
                    },
                )
                if resp.status_code == 200:
                    txt = resp.json()["choices"][0]["message"]["content"]
                    parsed = json.loads(txt)
                    return _merge_safe_extraction(parsed, baseline, prefer_llm=True), "openai:gpt-4o-mini"
        except Exception:
            pass

    return baseline, "local_ocr_parser"


def _merge_safe_extraction(llm_data: Dict[str, Any], baseline: Dict[str, Any], *, prefer_llm: bool = False) -> Dict[str, Any]:
    merged = dict(baseline)
    valid_cats = {"prescription", "lab_report", "medical_certificate", "diagnostic_report", "discharge_summary"}
    det_cat = str(llm_data.get("detected_category") or "").strip().lower()
    if det_cat in valid_cats:
        merged["detected_category"] = det_cat

    if llm_data.get("raw_transcription"):
        merged["raw_transcription"] = str(llm_data["raw_transcription"]).strip()

    for field in ["patient_name", "doctor_name", "hospital_name", "diagnosis"]:
        val = llm_data.get(field)
        if val and str(val).strip() and str(val).strip().lower() not in {"null", "none", "not stated"}:
            if prefer_llm or not merged.get(field):
                merged[field] = str(val).strip()

    raw_date = llm_data.get("document_date")
    if raw_date and str(raw_date).strip():
        normalized_date = _parse_date_candidate(str(raw_date).strip())
        if normalized_date and (prefer_llm or not merged.get("document_date")):
            merged["document_date"] = normalized_date

    if isinstance(llm_data.get("medications"), list) and llm_data["medications"]:
        cleaned_meds: List[Dict[str, Any]] = []
        for item in llm_data["medications"]:
            if not isinstance(item, dict):
                continue
            med_name = str(item.get("medicine_name") or "").strip()
            if not med_name:
                continue
            cleaned_meds.append(
                {
                    "medicine_name": med_name[:160],
                    "dosage": str(item.get("dosage")).strip()[:80] if item.get("dosage") else None,
                    "frequency": str(item.get("frequency")).strip()[:100] if item.get("frequency") else None,
                    "instructions": str(item.get("instructions")).strip()[:200] if item.get("instructions") else None,
                }
            )
        if cleaned_meds:
            merged["medications"] = cleaned_meds

    if isinstance(llm_data.get("lab_values"), list) and llm_data["lab_values"]:
        cleaned_labs: List[Dict[str, Any]] = []
        for item in llm_data["lab_values"]:
            if not isinstance(item, dict):
                continue
            t_name = str(item.get("test_name") or "").strip()
            if not t_name:
                continue
            raw_num = item.get("value_numeric")
            val_num: Optional[float] = None
            if isinstance(raw_num, (int, float)):
                val_num = float(raw_num)
            elif raw_num is not None:
                try:
                    val_num = float(str(raw_num).strip())
                except ValueError:
                    val_num = None
            val_text = str(item.get("value_text") or (val_num if val_num is not None else "")).strip()
            if val_num is None and val_text:
                m_num = re.search(r"[-+]?\d+(?:\.\d+)?", val_text)
                if m_num:
                    try:
                        val_num = float(m_num.group(0))
                    except ValueError:
                        pass
            ref_range = str(item.get("reference_range")).strip()[:120] if item.get("reference_range") else None
            eval_flag, eval_abn = _evaluate_lab_flag(val_num, ref_range)
            llm_flag = str(item.get("flag") or "").strip().lower()
            flag = llm_flag if llm_flag in {"normal", "low", "high", "critical"} else eval_flag
            is_abn = bool(item["is_abnormal"]) if isinstance(item.get("is_abnormal"), bool) else (flag != "normal" or eval_abn)
            cleaned_labs.append(
                {
                    "test_name": t_name[:140],
                    "value_numeric": val_num,
                    "value_text": val_text[:80] or "N/A",
                    "unit": str(item.get("unit")).strip()[:40] if item.get("unit") else None,
                    "reference_range": ref_range,
                    "flag": flag,
                    "is_abnormal": is_abn,
                }
            )
        if cleaned_labs:
            merged["lab_values"] = cleaned_labs

    if isinstance(llm_data.get("allergies"), list):
        cleaned_allergies = [str(a).strip() for a in llm_data["allergies"] if str(a).strip() and str(a).strip().lower() not in {"none", "nil", "nkda"}]
        if cleaned_allergies:
            merged["allergies"] = cleaned_allergies

    if isinstance(llm_data.get("observations"), list):
        cleaned_obs = [str(o).strip() for o in llm_data["observations"] if str(o).strip()]
        if cleaned_obs:
            merged["observations"] = cleaned_obs[:8]

    if isinstance(llm_data.get("uncertain_fields"), list):
        merged["uncertain_fields"] = [str(u).strip() for u in llm_data["uncertain_fields"] if str(u).strip()][:6]
    elif prefer_llm and (merged.get("medications") or merged.get("lab_values") or merged.get("raw_transcription")):
        merged["uncertain_fields"] = []

    missing = []
    for key in ["patient_name", "doctor_name", "hospital_name", "document_date", "diagnosis"]:
        if not merged.get(key):
            missing.append(key)
    if not merged.get("allergies"):
        missing.append("allergies (not explicitly stated)")
    merged["missing_fields"] = missing
    return merged
