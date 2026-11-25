import io
import json
import re
from datetime import date, datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

import cv2
import httpx
import numpy as np
from pypdf import PdfReader

from backend.config import get_settings

settings = get_settings()

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


async def extract_with_optional_llm(ocr_text: str, category: str, ai_consent: bool) -> Tuple[Dict[str, Any], str]:
    """Use Gemini/OpenAI only if API key exists and user consented; never invent absent facts."""
    baseline = extract_structured_from_text(ocr_text, category)
    if not ai_consent or not ocr_text.strip() or not settings.has_live_llm:
        return baseline, "local_ocr_parser"

    prompt = (
        "Extract ONLY explicitly stated medical facts from this OCR text into strict JSON. "
        "NEVER invent or infer missing values; use null or empty arrays when absent.\n"
        "Schema: {patient_name, doctor_name, hospital_name, document_date (YYYY-MM-DD or null), diagnosis, "
        "medications: [{medicine_name, dosage, frequency, instructions}], "
        "lab_values: [{test_name, value_numeric, value_text, unit, reference_range, flag, is_abnormal}], "
        "allergies: [string], observations: [string]}\n\nOCR TEXT:\n"
        + ocr_text[:6000]
    )

    try:
        if settings.GEMINI_API_KEY:
            url = f"https://generativelanguage.googleapis.com/v1beta/models/{settings.LLM_MODEL}:generateContent?key={settings.GEMINI_API_KEY}"
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    url,
                    json={
                        "contents": [{"parts": [{"text": prompt}]}],
                        "generationConfig": {"responseMimeType": "application/json", "temperature": 0.0},
                    },
                )
                if resp.status_code == 200:
                    data = resp.json()
                    txt = data["candidates"][0]["content"]["parts"][0]["text"]
                    parsed = json.loads(txt)
                    return _merge_safe_extraction(parsed, baseline), f"gemini:{settings.LLM_MODEL}"
        elif settings.OPENAI_API_KEY:
            async with httpx.AsyncClient(timeout=15.0) as client:
                resp = await client.post(
                    "https://api.openai.com/v1/chat/completions",
                    headers={"Authorization": f"Bearer {settings.OPENAI_API_KEY}"},
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
                    return _merge_safe_extraction(parsed, baseline), "openai:gpt-4o-mini"
    except Exception:
        pass

    return baseline, "local_ocr_parser"


def _merge_safe_extraction(llm_data: Dict[str, Any], baseline: Dict[str, Any]) -> Dict[str, Any]:
    merged = dict(baseline)
    for field in ["patient_name", "doctor_name", "hospital_name", "document_date", "diagnosis"]:
        if llm_data.get(field) and not merged.get(field):
            merged[field] = str(llm_data[field]).strip()
    if isinstance(llm_data.get("medications"), list) and llm_data["medications"]:
        merged["medications"] = llm_data["medications"]
    if isinstance(llm_data.get("lab_values"), list) and llm_data["lab_values"]:
        merged["lab_values"] = llm_data["lab_values"]
    if isinstance(llm_data.get("allergies"), list) and llm_data["allergies"]:
        merged["allergies"] = llm_data["allergies"]
    if isinstance(llm_data.get("observations"), list) and llm_data["observations"]:
        merged["observations"] = llm_data["observations"]

    missing = []
    for key in ["patient_name", "doctor_name", "hospital_name", "document_date", "diagnosis"]:
        if not merged.get(key):
            missing.append(key)
    if not merged.get("allergies"):
        missing.append("allergies (not explicitly stated)")
    merged["missing_fields"] = missing
    return merged
