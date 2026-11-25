import json
from collections import defaultdict
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Dict, List
from uuid import uuid4

from reportlab.lib import colors
from reportlab.lib.pagesizes import LETTER
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import inch
from reportlab.platypus import Paragraph, SimpleDocTemplate, Spacer, Table, TableStyle
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

settings = get_settings()


def build_doctor_summary_payload(db: Session, patient: User) -> Dict[str, Any]:
    """Build a consultation-ready One-Minute Doctor Summary separating facts from synthesis."""
    profile = db.query(PatientProfile).filter(PatientProfile.user_id == patient.id).first()
    allergies = db.query(Allergy).filter(Allergy.patient_id == patient.id).order_by(Allergy.created_at.desc()).all()
    meds = db.query(MedicationRecord).filter(MedicationRecord.patient_id == patient.id).order_by(MedicationRecord.is_current.desc(), MedicationRecord.prescribed_date.desc()).all()
    conditions = db.query(MedicalCondition).filter(MedicalCondition.patient_id == patient.id).order_by(MedicalCondition.diagnosed_date.desc()).all()
    labs = db.query(LabResult).filter(LabResult.patient_id == patient.id).order_by(LabResult.test_date.asc(), LabResult.id.asc()).all()
    timeline = db.query(MedicalTimelineEvent).filter(MedicalTimelineEvent.patient_id == patient.id).order_by(MedicalTimelineEvent.event_date.desc()).all()
    docs = db.query(MedicalDocument).filter(MedicalDocument.patient_id == patient.id).order_by(MedicalDocument.document_date.desc()).all()

    # Historical lab trends (only compare matching test_name and matching unit when >=2 numeric readings exist)
    grouped_labs: Dict[str, List[LabResult]] = defaultdict(list)
    for row in labs:
        key = f"{row.test_name.strip().lower()}::{row.unit or ''}"
        grouped_labs[key].append(row)

    lab_trends: List[Dict[str, Any]] = []
    latest_abnormal_labs: List[Dict[str, Any]] = []
    for _key, series in grouped_labs.items():
        latest = series[-1]
        if latest.is_abnormal:
            latest_abnormal_labs.append(
                {
                    "test_name": latest.test_name,
                    "value": f"{latest.value_text} {latest.unit or ''}".strip(),
                    "reference_range": latest.reference_range or "Not printed",
                    "flag": latest.flag,
                    "date": latest.test_date.isoformat() if latest.test_date else "Date unknown",
                }
            )
        numeric_points = [s for s in series if s.value_numeric is not None]
        if len(numeric_points) >= 2:
            first_pt = numeric_points[0]
            last_pt = numeric_points[-1]
            delta = round(last_pt.value_numeric - first_pt.value_numeric, 2)
            direction = "increased" if delta > 0 else ("decreased" if delta < 0 else "unchanged")
            lab_trends.append(
                {
                    "test_name": last_pt.test_name,
                    "unit": last_pt.unit or "",
                    "earliest_value": first_pt.value_numeric,
                    "earliest_date": first_pt.test_date.isoformat() if first_pt.test_date else "Unknown",
                    "latest_value": last_pt.value_numeric,
                    "latest_date": last_pt.test_date.isoformat() if last_pt.test_date else "Unknown",
                    "delta": delta,
                    "trend": direction,
                    "latest_flag": last_pt.flag,
                    "reference_range": last_pt.reference_range,
                }
            )
        else:
            lab_trends.append(
                {
                    "test_name": latest.test_name,
                    "unit": latest.unit or "",
                    "earliest_value": latest.value_numeric,
                    "earliest_date": latest.test_date.isoformat() if latest.test_date else "Unknown",
                    "latest_value": latest.value_numeric,
                    "latest_date": latest.test_date.isoformat() if latest.test_date else "Unknown",
                    "delta": 0.0,
                    "trend": "single_reading",
                    "latest_flag": latest.flag,
                    "reference_range": latest.reference_range,
                }
            )

    previous_surgeries = [
        {
            "date": ev.event_date.isoformat(),
            "event_type": ev.event_type,
            "title": ev.title,
            "hospital_name": ev.hospital_name,
            "description": ev.description,
        }
        for ev in timeline
        if ev.event_type == "surgery" or (ev.is_major_procedure and "hospital" not in ev.event_type)
    ]

    important_hospitalizations = [
        {
            "date": ev.event_date.isoformat(),
            "event_type": ev.event_type,
            "title": ev.title,
            "hospital_name": ev.hospital_name,
            "description": ev.description,
        }
        for ev in timeline
        if ev.event_type in {"hospitalization", "discharge_summary"}
    ]

    surgeries_hospitalizations = previous_surgeries + important_hospitalizations

    recent_consultations = [
        {
            "date": ev.event_date.isoformat(),
            "title": ev.title,
            "doctor_name": ev.doctor_name,
            "hospital_name": ev.hospital_name,
            "condition_tag": ev.condition_tag,
            "notes": ev.description,
        }
        for ev in timeline[:5]
    ]

    recency_cutoff = date.today() - timedelta(days=90)
    current_meds = []
    older_unverified_meds = []
    for m in meds:
        item = {
            "medicine_name": m.medicine_name,
            "generic_name": m.generic_name,
            "dosage": m.dosage,
            "frequency": m.frequency,
            "instructions": m.instructions,
            "prescribed_date": m.prescribed_date.isoformat() if m.prescribed_date else None,
            "source_type": m.source_type,
            "is_current": m.is_current,
        }
        if not m.is_current:
            older_unverified_meds.append({**item, "status_note": "Marked past / completed"})
        elif m.prescribed_date and m.prescribed_date < recency_cutoff and m.source_type == "extracted":
            older_unverified_meds.append({**item, "status_note": "Prescription >90 days old; confirm if still active"})
        else:
            current_meds.append(item)

    missing_or_uncertain: List[str] = []
    if not profile or not profile.blood_group:
        missing_or_uncertain.append("Blood group is not recorded in profile.")
    if not profile or not profile.date_of_birth:
        missing_or_uncertain.append("Date of birth / age is not recorded in profile.")
    if not allergies:
        missing_or_uncertain.append("No allergies documented (confirm NKDA vs. unrecorded allergies during consultation).")
    unverified_docs = [d.title for d in docs if not d.is_verified]
    if unverified_docs:
        missing_or_uncertain.append(f"{len(unverified_docs)} uploaded document(s) pending patient verification: {', '.join(unverified_docs[:3])}.")
    if older_unverified_meds:
        missing_or_uncertain.append(
            f"{len(older_unverified_meds)} older or past prescription record(s) require confirmation on whether they are still taken."
        )
    if not surgeries_hospitalizations:
        missing_or_uncertain.append("No surgical or inpatient hospitalization records found in vault.")

    source_records = [
        {
            "id": d.id,
            "title": d.title,
            "category": d.category,
            "document_date": d.document_date.isoformat() if d.document_date else None,
            "is_verified": d.is_verified,
        }
        for d in docs
    ]

    extracted_facts = {
        "patient": {
            "full_name": patient.full_name,
            "date_of_birth": profile.date_of_birth.isoformat() if profile and profile.date_of_birth else None,
            "age_years": (
                (date.today().year - profile.date_of_birth.year - ((date.today().month, date.today().day) < (profile.date_of_birth.month, profile.date_of_birth.day)))
                if profile and profile.date_of_birth
                else None
            ),
            "gender": profile.gender if profile else None,
            "blood_group": profile.blood_group if profile else None,
            "emergency_contact": f"{profile.emergency_contact_name} ({profile.emergency_contact_phone})"
            if profile and profile.emergency_contact_name
            else None,
        },
        "known_allergies": [
            {
                "allergen": a.allergen,
                "reaction": a.reaction,
                "severity": a.severity,
                "recorded_date": a.recorded_date.isoformat() if a.recorded_date else None,
                "source_type": a.source_type,
            }
            for a in allergies
        ],
        "current_medications": current_meds,
        "past_or_older_medications": older_unverified_meds,
        "documented_conditions": [
            {
                "condition_name": c.condition_name,
                "status": c.status,
                "diagnosed_date": c.diagnosed_date.isoformat() if c.diagnosed_date else None,
                "notes": c.notes,
                "source_type": c.source_type,
            }
            for c in conditions
        ],
        "previous_surgeries": previous_surgeries,
        "important_hospitalizations": important_hospitalizations,
        "surgeries_and_hospitalizations": surgeries_hospitalizations,
        "lab_trends": lab_trends,
        "flagged_lab_results": latest_abnormal_labs,
        "recent_consultations": recent_consultations,
        "source_records": source_records,
        "total_documents_in_vault": len(docs),
        "verified_documents_count": sum(1 for d in docs if d.is_verified),
    }

    # Build clearly separated AI synthesis paragraph + consultation focus points
    cond_names = [c.condition_name for c in conditions if c.status in {"active", "chronic", "monitoring"}]
    allergy_names = [f"{a.allergen} ({a.severity})" for a in allergies]
    abn_names = [f"{l['test_name']} ({l['value']}, {l['flag']})" for l in latest_abnormal_labs]

    synthesis_bullets: List[str] = []
    if cond_names:
        synthesis_bullets.append(f"Active or monitored conditions in vault: {', '.join(cond_names)}.")
    if current_meds:
        med_str = ", ".join(f"{m['medicine_name']} {m['dosage'] or ''}".strip() for m in current_meds[:6])
        synthesis_bullets.append(f"Current documented regimen ({len(current_meds)} medication(s)): {med_str}.")
    if allergy_names:
        synthesis_bullets.append(f"Critical allergy alert: {', '.join(allergy_names)}.")
    if abn_names:
        synthesis_bullets.append(f"Out-of-range lab markers requiring clinician review: {'; '.join(abn_names)}.")
    if not synthesis_bullets:
        synthesis_bullets.append("Vault contains limited verified clinical entries; review uploaded documents directly with the patient.")

    model_mode = f"gemini:{settings.LLM_MODEL}" if settings.GEMINI_API_KEY else (
        "openai:gpt-4o-mini" if settings.OPENAI_API_KEY else "structured_local_synthesis"
    )

    ai_generated_summary = {
        "provenance_label": "Automated Consultation Brief (derived strictly from verified vault records; not a clinical diagnosis)",
        "model_mode": model_mode,
        "one_minute_brief": " ".join(synthesis_bullets),
        "key_clinical_highlights": synthesis_bullets,
        "suggested_clinician_review_topics": [
            "Confirm current adherence and tolerances for documented medications." if current_meds else "Collect complete current medication history.",
            "Review flagged lab trends and repeat interval testing if clinically indicated." if latest_abnormal_labs else "Assess baseline preventive lab screening needs.",
            "Verify allergy status and any undocumented reactions." if not allergies else f"Avoid cross-reactive prescriptions with documented allergies ({', '.join(a.allergen for a in allergies)}).",
        ],
        "missing_or_uncertain_information": missing_or_uncertain,
    }

    return {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "extracted_facts": extracted_facts,
        "ai_generated_summary": ai_generated_summary,
    }


def render_summary_pdf(summary_payload: Dict[str, Any], patient_name: str) -> Path:
    filename = f"doctor_summary_{uuid4().hex[:12]}.pdf"
    out_path = settings.SUMMARY_DIR / filename
    doc = SimpleDocTemplate(str(out_path), pagesize=LETTER, leftMargin=0.65 * inch, rightMargin=0.65 * inch, topMargin=0.6 * inch, bottomMargin=0.6 * inch)

    styles = getSampleStyleSheet()
    title_style = ParagraphStyle("MLTitle", parent=styles["Heading1"], fontSize=16, textColor=colors.HexColor("#0F2744"), spaceAfter=4)
    sub_style = ParagraphStyle("MLSub", parent=styles["Normal"], fontSize=9, textColor=colors.HexColor("#475569"), spaceAfter=12)
    h2_style = ParagraphStyle("MLH2", parent=styles["Heading2"], fontSize=11.5, textColor=colors.HexColor("#0E7C7B"), spaceBefore=10, spaceAfter=6)
    body_style = ParagraphStyle("MLBody", parent=styles["Normal"], fontSize=9.5, leading=13.5, textColor=colors.HexColor("#1E293B"))
    note_style = ParagraphStyle("MLNote", parent=styles["Normal"], fontSize=8.5, leading=12, textColor=colors.HexColor("#64748B"))

    facts = summary_payload["extracted_facts"]
    ai_block = summary_payload["ai_generated_summary"]
    p_info = facts["patient"]

    story = [
        Paragraph(f"Ayuva One-Minute Doctor Summary: {patient_name}", title_style),
        Paragraph(
            f"Generated UTC: {summary_payload['generated_at'][:19].replace('T', ' ')} | "
            f"DOB: {p_info.get('date_of_birth') or 'Not recorded'} | "
            f"Gender: {p_info.get('gender') or 'Not recorded'} | "
            f"Blood Group: {p_info.get('blood_group') or 'Not recorded'}",
            sub_style,
        ),
        Paragraph("SECTION A: VERIFIED EXTRACTED MEDICAL FACTS (FROM PATIENT VAULT)", h2_style),
    ]

    allergies = facts["known_allergies"]
    allergy_text = ", ".join(f"{a['allergen']} ({a['severity']})" for a in allergies) if allergies else "None documented in vault"
    story.append(Paragraph(f"<b>Known Allergies:</b> {allergy_text}", body_style))
    story.append(Spacer(1, 4))

    conditions = facts["documented_conditions"]
    cond_text = "; ".join(f"{c['condition_name']} [{c['status']}]" for c in conditions) if conditions else "None documented"
    story.append(Paragraph(f"<b>Documented Conditions:</b> {cond_text}", body_style))
    story.append(Spacer(1, 4))

    meds = facts["current_medications"]
    if meds:
        med_rows = [["Medication", "Dosage", "Frequency", "Instructions"]]
        for m in meds:
            med_rows.append([m["medicine_name"], m.get("dosage") or "-", m.get("frequency") or "-", (m.get("instructions") or "-")[:45]])
        tbl = Table(med_rows, colWidths=[1.8 * inch, 1.0 * inch, 1.3 * inch, 2.9 * inch])
        tbl.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0F2744")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
                    ("VALIGN", (0, 0), (-1, -1), "TOP"),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        story.append(Paragraph("<b>Current Medications:</b>", body_style))
        story.append(Spacer(1, 4))
        story.append(tbl)
    else:
        story.append(Paragraph("<b>Current Medications:</b> None documented", body_style))

    story.append(Spacer(1, 6))
    trends = facts["lab_trends"]
    if trends:
        lab_rows = [["Lab Test", "Latest Value", "Reference", "Trend / Delta", "Flag"]]
        for t in trends[:10]:
            latest_str = f"{t['latest_value']} {t['unit']}".strip() if t["latest_value"] is not None else "-"
            trend_str = "Single reading" if t["trend"] == "single_reading" else f"{t['trend']} ({t['delta']:+g})"
            lab_rows.append([t["test_name"], latest_str, t.get("reference_range") or "-", trend_str, t["latest_flag"].upper()])
        ltbl = Table(lab_rows, colWidths=[1.8 * inch, 1.2 * inch, 1.4 * inch, 1.6 * inch, 1.0 * inch])
        ltbl.setStyle(
            TableStyle(
                [
                    ("BACKGROUND", (0, 0), (-1, 0), colors.HexColor("#0E7C7B")),
                    ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
                    ("FONTSIZE", (0, 0), (-1, -1), 8.5),
                    ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#CBD5E1")),
                    ("TOPPADDING", (0, 0), (-1, -1), 4),
                    ("BOTTOMPADDING", (0, 0), (-1, -1), 4),
                ]
            )
        )
        story.append(Paragraph("<b>Laboratory Results & Trends:</b>", body_style))
        story.append(Spacer(1, 4))
        story.append(ltbl)

    story.append(Spacer(1, 8))
    story.append(Paragraph("SECTION B: AUTOMATED CONSULTATION BRIEF (AI SYNTHESIS)", h2_style))
    story.append(Paragraph(f"<i>{ai_block['provenance_label']} (Engine: {ai_block['model_mode']})</i>", note_style))
    story.append(Spacer(1, 4))
    story.append(Paragraph(ai_block["one_minute_brief"], body_style))
    story.append(Spacer(1, 6))
    story.append(Paragraph("<b>Missing or Uncertain Information:</b>", body_style))
    for gap in ai_block["missing_or_uncertain_information"]:
        story.append(Paragraph(f"- {gap}", body_style))

    src_recs = facts.get("source_records", [])
    if src_recs:
        story.append(Spacer(1, 6))
        src_list = ", ".join(f"{r['title']} ({r['document_date'] or 'undated'})" for r in src_recs[:8])
        story.append(Paragraph(f"<b>Source Records Reviewed ({len(src_recs)}):</b> {src_list}", note_style))

    doc.build(story)
    return out_path


def generate_and_persist_summary(db: Session, patient: User) -> DoctorSummary:
    payload = build_doctor_summary_payload(db, patient)
    pdf_path = render_summary_pdf(payload, patient.full_name)
    record = DoctorSummary(
        patient_id=patient.id,
        summary_json=json.dumps(payload),
        model_mode=payload["ai_generated_summary"]["model_mode"],
        pdf_filename=pdf_path.name,
    )
    db.add(record)
    db.commit()
    db.refresh(record)
    return record
