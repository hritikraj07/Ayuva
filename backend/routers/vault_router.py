import json
from datetime import date, datetime
from pathlib import Path
from typing import Optional
from uuid import uuid4

from fastapi import APIRouter, Depends, File, Form, HTTPException, Query, UploadFile, status
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from backend.auth import log_access, require_roles
from backend.config import get_settings
from backend.database import get_db
from backend.models import (
    AccessLog,
    Allergy,
    DoctorSummary,
    ExtractedMedicalInfo,
    LabResult,
    MedicalCondition,
    MedicalDocument,
    MedicalTimelineEvent,
    MedicationRecord,
    PatientProfile,
    User,
)
from backend.schemas import (
    AllergyCreate,
    DocumentVerifyRequest,
    MedicalConditionCreate,
    MedicationCreate,
    PatientProfileOut,
    PatientProfileUpdate,
)
from backend.services.ocr_extraction import (
    extract_with_optional_llm,
    infer_category,
    run_ocr_on_bytes,
    validate_upload_bytes,
)
from backend.services.summary_service import generate_and_persist_summary

router = APIRouter(prefix="/api/vault", tags=["Medical Vault & Patient Profile"])
settings = get_settings()


def _serialize_document(doc: MedicalDocument) -> dict:
    info = doc.extracted_info
    return {
        "id": doc.id,
        "title": doc.title,
        "category": doc.category,
        "original_filename": doc.original_filename,
        "mime_type": doc.mime_type,
        "file_size": doc.file_size,
        "document_date": doc.document_date.isoformat() if doc.document_date else None,
        "doctor_name": doc.doctor_name,
        "hospital_name": doc.hospital_name,
        "primary_condition": doc.primary_condition,
        "ocr_text": doc.ocr_text,
        "extraction_status": doc.extraction_status,
        "extraction_confidence": doc.extraction_confidence,
        "extraction_provider": doc.extraction_provider,
        "is_verified": doc.is_verified,
        "notes": doc.notes,
        "created_at": doc.created_at.isoformat(),
        "extracted": {
            "patient_name": info.patient_name if info else None,
            "doctor_name": info.doctor_name if info else None,
            "hospital_name": info.hospital_name if info else None,
            "document_date": info.document_date if info else None,
            "diagnosis": info.diagnosis if info else None,
            "medications": json.loads(info.medications_json) if info else [],
            "lab_values": json.loads(info.lab_values_json) if info else [],
            "allergies": json.loads(info.allergies_json) if info else [],
            "observations": json.loads(info.observations_json) if info else [],
            "missing_fields": json.loads(info.missing_fields_json) if info else [],
            "uncertain_fields": (
                ["Low OCR confidence (<70%) - verify fields against the original scan."]
                if doc.extraction_confidence < 0.7
                else []
            ),
        },
    }


@router.get("/profile", response_model=PatientProfileOut)
def get_profile(
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    profile = db.query(PatientProfile).filter(PatientProfile.user_id == current_user.id).first()
    if not profile:
        profile = PatientProfile(user_id=current_user.id)
        db.add(profile)
        db.commit()
        db.refresh(profile)

    return PatientProfileOut(
        user_id=current_user.id,
        full_name=current_user.full_name,
        email=current_user.email,
        date_of_birth=profile.date_of_birth,
        gender=profile.gender,
        blood_group=profile.blood_group,
        phone=profile.phone,
        emergency_contact_name=profile.emergency_contact_name,
        emergency_contact_phone=profile.emergency_contact_phone,
        ai_consent=profile.ai_consent,
        sharing_consent=profile.sharing_consent,
        health_preferences=json.loads(profile.health_preferences_json or "{}"),
    )


@router.put("/profile", response_model=PatientProfileOut)
def update_profile(
    payload: PatientProfileUpdate,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    profile = db.query(PatientProfile).filter(PatientProfile.user_id == current_user.id).first()
    if not profile:
        profile = PatientProfile(user_id=current_user.id)
        db.add(profile)

    if payload.full_name is not None:
        current_user.full_name = payload.full_name.strip()
    if payload.date_of_birth is not None:
        profile.date_of_birth = payload.date_of_birth
    if payload.gender is not None:
        profile.gender = payload.gender
    if payload.blood_group is not None:
        profile.blood_group = payload.blood_group
    if payload.phone is not None:
        profile.phone = payload.phone
    if payload.emergency_contact_name is not None:
        profile.emergency_contact_name = payload.emergency_contact_name
    if payload.emergency_contact_phone is not None:
        profile.emergency_contact_phone = payload.emergency_contact_phone
    if payload.ai_consent is not None:
        profile.ai_consent = payload.ai_consent
    if payload.sharing_consent is not None:
        profile.sharing_consent = payload.sharing_consent
    if payload.health_preferences is not None:
        profile.health_preferences_json = json.dumps(payload.health_preferences)

    db.commit()
    db.refresh(profile)
    return get_profile(current_user=current_user, db=db)


@router.get("/overview")
def get_patient_overview(
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    docs = db.query(MedicalDocument).filter(MedicalDocument.patient_id == current_user.id).order_by(MedicalDocument.document_date.desc()).all()
    conditions = db.query(MedicalCondition).filter(MedicalCondition.patient_id == current_user.id).all()
    meds = db.query(MedicationRecord).filter(MedicationRecord.patient_id == current_user.id, MedicationRecord.is_current.is_(True)).all()
    allergies = db.query(Allergy).filter(Allergy.patient_id == current_user.id).all()
    labs = db.query(LabResult).filter(LabResult.patient_id == current_user.id).order_by(LabResult.test_date.desc()).all()
    logs = db.query(AccessLog).filter(AccessLog.actor_user_id == current_user.id).order_by(AccessLog.created_at.desc()).limit(8).all()

    return {
        "counts": {
            "documents": len(docs),
            "pending_review": sum(1 for d in docs if not d.is_verified),
            "active_medications": len(meds),
            "conditions": len(conditions),
            "allergies": len(allergies),
            "flagged_labs": sum(1 for l in labs if l.is_abnormal),
        },
        "recent_documents": [_serialize_document(d) for d in docs[:4]],
        "allergies": [{"id": a.id, "allergen": a.allergen, "severity": a.severity, "reaction": a.reaction} for a in allergies],
        "active_medications": [{"id": m.id, "medicine_name": m.medicine_name, "dosage": m.dosage, "frequency": m.frequency} for m in meds],
        "recent_activity": [{"action": l.action, "resource_type": l.resource_type, "created_at": l.created_at.isoformat()} for l in logs],
    }


@router.post("/documents/upload", status_code=status.HTTP_201_CREATED)
async def upload_medical_document(
    file: UploadFile = File(...),
    title: Optional[str] = Form(default=None),
    category: Optional[str] = Form(default=None),
    notes: Optional[str] = Form(default=None),
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    content = await file.read()
    try:
        ext, mime_type = validate_upload_bytes(file.filename or "upload.pdf", content)
    except ValueError as exc:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc)) from exc

    stored_name = f"{current_user.id}_{uuid4().hex}{ext}"
    save_path = settings.UPLOAD_DIR / stored_name
    save_path.write_bytes(content)

    ocr_text, confidence, ocr_engine = run_ocr_on_bytes(content, ext)
    resolved_category = category if category in {
        "prescription",
        "lab_report",
        "medical_certificate",
        "diagnostic_report",
        "discharge_summary",
    } else infer_category(ocr_text, file.filename or "")

    profile = db.query(PatientProfile).filter(PatientProfile.user_id == current_user.id).first()
    ai_consent = bool(profile.ai_consent) if profile else True
    extracted_dict, provider_used = await extract_with_optional_llm(ocr_text, resolved_category, ai_consent)

    parsed_doc_date: Optional[date] = None
    if extracted_dict.get("document_date"):
        try:
            parsed_doc_date = date.fromisoformat(extracted_dict["document_date"])
        except ValueError:
            parsed_doc_date = None

    doc_title = (title or Path(file.filename or "Medical Document").stem.replace("_", " ").title())[:200]
    doc = MedicalDocument(
        patient_id=current_user.id,
        title=doc_title,
        category=resolved_category,
        original_filename=Path(file.filename or "document" + ext).name,
        stored_filename=stored_name,
        mime_type=mime_type,
        file_size=len(content),
        document_date=parsed_doc_date,
        doctor_name=extracted_dict.get("doctor_name"),
        hospital_name=extracted_dict.get("hospital_name"),
        primary_condition=extracted_dict.get("diagnosis"),
        ocr_text=ocr_text,
        extraction_status="pending_review",
        extraction_confidence=confidence,
        extraction_provider=f"{ocr_engine}+{provider_used}",
        is_verified=False,
        notes=notes,
    )
    db.add(doc)
    db.commit()
    db.refresh(doc)

    ext_info = ExtractedMedicalInfo(
        document_id=doc.id,
        patient_name=extracted_dict.get("patient_name"),
        doctor_name=extracted_dict.get("doctor_name"),
        hospital_name=extracted_dict.get("hospital_name"),
        document_date=extracted_dict.get("document_date"),
        diagnosis=extracted_dict.get("diagnosis"),
        medications_json=json.dumps(extracted_dict.get("medications", [])),
        lab_values_json=json.dumps(extracted_dict.get("lab_values", [])),
        allergies_json=json.dumps(extracted_dict.get("allergies", [])),
        observations_json=json.dumps(extracted_dict.get("observations", [])),
        missing_fields_json=json.dumps(extracted_dict.get("missing_fields", [])),
    )
    db.add(ext_info)
    db.commit()
    db.refresh(doc)

    log_access(
        db,
        actor_user_id=current_user.id,
        actor_role=current_user.role_name,
        action="document_uploaded",
        resource_type="medical_document",
        resource_id=str(doc.id),
        details=f"category={doc.category}, confidence={confidence}",
    )
    return _serialize_document(doc)


@router.put("/documents/{doc_id}/verify")
def verify_and_save_document(
    doc_id: int,
    payload: DocumentVerifyRequest,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    doc = db.query(MedicalDocument).filter(MedicalDocument.id == doc_id, MedicalDocument.patient_id == current_user.id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    doc.title = payload.title.strip()
    doc.category = payload.category
    doc.document_date = payload.document_date
    doc.doctor_name = payload.doctor_name
    doc.hospital_name = payload.hospital_name
    doc.primary_condition = payload.primary_condition or payload.extracted.diagnosis
    doc.notes = payload.notes
    doc.is_verified = True
    doc.extraction_status = "verified"

    info = doc.extracted_info or ExtractedMedicalInfo(document_id=doc.id)
    info.patient_name = payload.extracted.patient_name
    info.doctor_name = payload.extracted.doctor_name or payload.doctor_name
    info.hospital_name = payload.extracted.hospital_name or payload.hospital_name
    info.document_date = payload.document_date.isoformat() if payload.document_date else payload.extracted.document_date
    info.diagnosis = payload.extracted.diagnosis or payload.primary_condition
    info.medications_json = json.dumps([m.model_dump() for m in payload.extracted.medications])
    info.lab_values_json = json.dumps([l.model_dump() for l in payload.extracted.lab_values])
    info.allergies_json = json.dumps(payload.extracted.allergies)
    info.observations_json = json.dumps(payload.extracted.observations)
    info.missing_fields_json = json.dumps(payload.extracted.missing_fields)
    if doc.extracted_info is None:
        db.add(info)

    if payload.commit_to_profile:
        # Refresh lab rows and timeline entry tied to this document cleanly without duplicating
        db.query(LabResult).filter(LabResult.document_id == doc.id).delete()
        db.query(MedicalTimelineEvent).filter(MedicalTimelineEvent.document_id == doc.id).delete()
        db.query(MedicationRecord).filter(MedicationRecord.document_id == doc.id).delete()
        db.query(MedicalCondition).filter(MedicalCondition.document_id == doc.id).delete()
        db.query(Allergy).filter(Allergy.document_id == doc.id).delete()

        eff_date = doc.document_date or date.today()
        if info.diagnosis:
            db.add(
                MedicalCondition(
                    patient_id=current_user.id,
                    document_id=doc.id,
                    condition_name=info.diagnosis,
                    status="resolved" if doc.category == "discharge_summary" else "active",
                    diagnosed_date=eff_date,
                    notes="; ".join(payload.extracted.observations[:2]) if payload.extracted.observations else None,
                    source_type="extracted",
                )
            )
        for med in payload.extracted.medications:
            db.add(
                MedicationRecord(
                    patient_id=current_user.id,
                    document_id=doc.id,
                    medicine_name=med.medicine_name,
                    dosage=med.dosage,
                    frequency=med.frequency,
                    instructions=med.instructions,
                    prescribed_date=eff_date,
                    is_current=True,
                    source_type="extracted",
                )
            )
        for allergen in payload.extracted.allergies:
            db.add(
                Allergy(
                    patient_id=current_user.id,
                    document_id=doc.id,
                    allergen=allergen,
                    severity="moderate",
                    recorded_date=eff_date,
                    source_type="extracted",
                )
            )
        for lab in payload.extracted.lab_values:
            db.add(
                LabResult(
                    patient_id=current_user.id,
                    document_id=doc.id,
                    test_name=lab.test_name,
                    value_numeric=lab.value_numeric,
                    value_text=lab.value_text,
                    unit=lab.unit,
                    reference_range=lab.reference_range,
                    flag=lab.flag,
                    is_abnormal=lab.is_abnormal,
                    test_date=eff_date,
                )
            )

        ev_type = "hospitalization" if doc.category == "discharge_summary" else (
            "lab_test" if doc.category in {"lab_report", "diagnostic_report"} else doc.category
        )
        db.add(
            MedicalTimelineEvent(
                patient_id=current_user.id,
                document_id=doc.id,
                event_date=eff_date,
                event_type=ev_type,
                title=doc.title,
                description="; ".join(payload.extracted.observations[:2]) or info.diagnosis or "Verified medical document",
                doctor_name=doc.doctor_name,
                hospital_name=doc.hospital_name,
                condition_tag=doc.primary_condition,
                is_major_procedure=(doc.category == "discharge_summary"),
            )
        )

    db.commit()
    db.refresh(doc)
    log_access(
        db,
        actor_user_id=current_user.id,
        actor_role=current_user.role_name,
        action="document_verified",
        resource_type="medical_document",
        resource_id=str(doc.id),
    )
    return _serialize_document(doc)


@router.get("/documents")
def list_documents(
    category: Optional[str] = Query(default=None),
    doctor: Optional[str] = Query(default=None),
    condition: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    search: Optional[str] = Query(default=None),
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    query = db.query(MedicalDocument).filter(MedicalDocument.patient_id == current_user.id)
    if category and category != "all":
        query = query.filter(MedicalDocument.category == category)
    if doctor:
        query = query.filter(MedicalDocument.doctor_name.ilike(f"%{doctor}%"))
    if condition:
        query = query.filter(MedicalDocument.primary_condition.ilike(f"%{condition}%"))
    if date_from:
        query = query.filter(MedicalDocument.document_date >= date_from)
    if date_to:
        query = query.filter(MedicalDocument.document_date <= date_to)
    if search:
        like = f"%{search}%"
        query = query.filter(
            (MedicalDocument.title.ilike(like))
            | (MedicalDocument.ocr_text.ilike(like))
            | (MedicalDocument.primary_condition.ilike(like))
            | (MedicalDocument.doctor_name.ilike(like))
        )

    docs = query.order_by(MedicalDocument.document_date.desc(), MedicalDocument.created_at.desc()).all()
    return {"documents": [_serialize_document(d) for d in docs]}


@router.get("/documents/{doc_id}/file")
def download_or_preview_document(
    doc_id: int,
    download: bool = Query(default=False),
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    doc = db.query(MedicalDocument).filter(MedicalDocument.id == doc_id, MedicalDocument.patient_id == current_user.id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")
    file_path = settings.UPLOAD_DIR / doc.stored_filename
    if not file_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Stored document file not found.")

    disposition = "attachment" if download else "inline"
    return FileResponse(
        path=file_path,
        media_type=doc.mime_type,
        filename=doc.original_filename,
        headers={"Content-Disposition": f'{disposition}; filename="{doc.original_filename}"'},
    )


@router.delete("/documents/{doc_id}")
def delete_document(
    doc_id: int,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    doc = db.query(MedicalDocument).filter(MedicalDocument.id == doc_id, MedicalDocument.patient_id == current_user.id).first()
    if not doc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Document not found.")

    file_path = settings.UPLOAD_DIR / doc.stored_filename
    db.query(MedicalTimelineEvent).filter(MedicalTimelineEvent.document_id == doc.id).delete()
    db.query(MedicationRecord).filter(MedicationRecord.document_id == doc.id).delete()
    db.query(MedicalCondition).filter(MedicalCondition.document_id == doc.id).delete()
    db.query(Allergy).filter(Allergy.document_id == doc.id).delete()
    db.delete(doc)
    db.commit()
    if file_path.exists():
        file_path.unlink(missing_ok=True)

    log_access(
        db,
        actor_user_id=current_user.id,
        actor_role=current_user.role_name,
        action="document_deleted",
        resource_type="medical_document",
        resource_id=str(doc_id),
    )
    return {"deleted": True, "id": doc_id}


@router.get("/timeline")
def get_medical_timeline(
    category: Optional[str] = Query(default=None),
    doctor: Optional[str] = Query(default=None),
    condition: Optional[str] = Query(default=None),
    date_from: Optional[date] = Query(default=None),
    date_to: Optional[date] = Query(default=None),
    search: Optional[str] = Query(default=None),
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    query = db.query(MedicalTimelineEvent).filter(MedicalTimelineEvent.patient_id == current_user.id)
    if category and category != "all":
        query = query.filter(MedicalTimelineEvent.event_type == category)
    if doctor:
        query = query.filter(MedicalTimelineEvent.doctor_name.ilike(f"%{doctor}%"))
    if condition:
        query = query.filter(MedicalTimelineEvent.condition_tag.ilike(f"%{condition}%"))
    if date_from:
        query = query.filter(MedicalTimelineEvent.event_date >= date_from)
    if date_to:
        query = query.filter(MedicalTimelineEvent.event_date <= date_to)
    if search:
        like = f"%{search}%"
        query = query.filter(
            (MedicalTimelineEvent.title.ilike(like))
            | (MedicalTimelineEvent.description.ilike(like))
            | (MedicalTimelineEvent.condition_tag.ilike(like))
        )
    events = query.order_by(MedicalTimelineEvent.event_date.desc()).all()

    conditions = db.query(MedicalCondition).filter(MedicalCondition.patient_id == current_user.id).all()
    medications = db.query(MedicationRecord).filter(MedicationRecord.patient_id == current_user.id).order_by(MedicationRecord.is_current.desc(), MedicationRecord.prescribed_date.desc()).all()
    allergies = db.query(Allergy).filter(Allergy.patient_id == current_user.id).all()
    labs = db.query(LabResult).filter(LabResult.patient_id == current_user.id).order_by(LabResult.test_date.asc()).all()

    return {
        "events": [
            {
                "id": e.id,
                "document_id": e.document_id,
                "event_date": e.event_date.isoformat(),
                "event_type": e.event_type,
                "title": e.title,
                "description": e.description,
                "doctor_name": e.doctor_name,
                "hospital_name": e.hospital_name,
                "condition_tag": e.condition_tag,
                "is_major_procedure": e.is_major_procedure,
            }
            for e in events
        ],
        "conditions": [
            {"id": c.id, "condition_name": c.condition_name, "status": c.status, "diagnosed_date": c.diagnosed_date.isoformat() if c.diagnosed_date else None, "notes": c.notes}
            for c in conditions
        ],
        "medications": [
            {
                "id": m.id,
                "medicine_name": m.medicine_name,
                "dosage": m.dosage,
                "frequency": m.frequency,
                "is_current": m.is_current,
                "prescribed_date": m.prescribed_date.isoformat() if m.prescribed_date else None,
                "source_type": m.source_type,
            }
            for m in medications
        ],
        "allergies": [
            {"id": a.id, "allergen": a.allergen, "reaction": a.reaction, "severity": a.severity}
            for a in allergies
        ],
        "lab_results": [
            {
                "id": l.id,
                "test_name": l.test_name,
                "value_numeric": l.value_numeric,
                "value_text": l.value_text,
                "unit": l.unit,
                "reference_range": l.reference_range,
                "flag": l.flag,
                "is_abnormal": l.is_abnormal,
                "test_date": l.test_date.isoformat() if l.test_date else None,
            }
            for l in labs
        ],
    }


@router.post("/conditions", status_code=status.HTTP_201_CREATED)
def add_condition(
    payload: MedicalConditionCreate,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    row = MedicalCondition(
        patient_id=current_user.id,
        condition_name=payload.condition_name,
        status=payload.status,
        diagnosed_date=payload.diagnosed_date,
        notes=payload.notes,
        source_type="manual",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "condition_name": row.condition_name, "status": row.status}


@router.post("/medications", status_code=status.HTTP_201_CREATED)
def add_medication(
    payload: MedicationCreate,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    row = MedicationRecord(
        patient_id=current_user.id,
        medicine_name=payload.medicine_name,
        generic_name=payload.generic_name,
        dosage=payload.dosage,
        frequency=payload.frequency,
        instructions=payload.instructions,
        prescribed_date=payload.prescribed_date or date.today(),
        is_current=payload.is_current,
        source_type="manual",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "medicine_name": row.medicine_name}


@router.patch("/medications/{med_id}/toggle")
def toggle_medication_current_status(
    med_id: int,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    row = db.query(MedicationRecord).filter(MedicationRecord.id == med_id, MedicationRecord.patient_id == current_user.id).first()
    if not row:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Medication record not found.")
    row.is_current = not row.is_current
    db.commit()
    return {"id": row.id, "is_current": row.is_current}


@router.post("/allergies", status_code=status.HTTP_201_CREATED)
def add_allergy(
    payload: AllergyCreate,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    row = Allergy(
        patient_id=current_user.id,
        allergen=payload.allergen,
        reaction=payload.reaction,
        severity=payload.severity,
        recorded_date=payload.recorded_date or date.today(),
        source_type="manual",
    )
    db.add(row)
    db.commit()
    db.refresh(row)
    return {"id": row.id, "allergen": row.allergen}


@router.post("/summary/generate")
def generate_doctor_summary(
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    record = generate_and_persist_summary(db, current_user)
    log_access(
        db,
        actor_user_id=current_user.id,
        actor_role=current_user.role_name,
        action="doctor_summary_generated",
        resource_type="doctor_summary",
        resource_id=str(record.id),
    )
    return {
        "summary_id": record.id,
        "generated_at": record.generated_at.isoformat(),
        "pdf_download_url": f"/api/vault/summary/{record.id}/pdf",
        **json.loads(record.summary_json),
    }


@router.get("/summary/latest")
def get_latest_doctor_summary(
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    record = (
        db.query(DoctorSummary)
        .filter(DoctorSummary.patient_id == current_user.id)
        .order_by(DoctorSummary.generated_at.desc())
        .first()
    )
    if not record:
        record = generate_and_persist_summary(db, current_user)
    return {
        "summary_id": record.id,
        "generated_at": record.generated_at.isoformat(),
        "pdf_download_url": f"/api/vault/summary/{record.id}/pdf",
        **json.loads(record.summary_json),
    }


@router.get("/summary/{summary_id}/pdf")
def download_summary_pdf(
    summary_id: int,
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    record = (
        db.query(DoctorSummary)
        .filter(DoctorSummary.id == summary_id, DoctorSummary.patient_id == current_user.id)
        .first()
    )
    if not record or not record.pdf_filename:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Summary PDF not found.")
    pdf_path = settings.SUMMARY_DIR / record.pdf_filename
    if not pdf_path.exists():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Summary PDF missing from storage.")
    return FileResponse(path=pdf_path, media_type="application/pdf", filename=f"MedLedger_Doctor_Summary_{summary_id}.pdf")


@router.delete("/account/data")
def delete_all_patient_records(
    current_user: User = Depends(require_roles("patient")),
    db: Session = Depends(get_db),
):
    """Allow patients to delete all medical records and uploaded files from their vault."""
    docs = db.query(MedicalDocument).filter(MedicalDocument.patient_id == current_user.id).all()
    for d in docs:
        (settings.UPLOAD_DIR / d.stored_filename).unlink(missing_ok=True)
        db.delete(d)
    db.query(MedicalTimelineEvent).filter(MedicalTimelineEvent.patient_id == current_user.id).delete()
    db.query(MedicationRecord).filter(MedicationRecord.patient_id == current_user.id).delete()
    db.query(MedicalCondition).filter(MedicalCondition.patient_id == current_user.id).delete()
    db.query(Allergy).filter(Allergy.patient_id == current_user.id).delete()
    db.query(LabResult).filter(LabResult.patient_id == current_user.id).delete()
    db.query(DoctorSummary).filter(DoctorSummary.patient_id == current_user.id).delete()
    db.commit()
    return {"deleted_all_medical_records": True}
