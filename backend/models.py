from datetime import datetime, date, timezone
from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Float,
    ForeignKey,
    Index,
    Integer,
    String,
    Text,
)
from sqlalchemy.orm import Mapped, mapped_column, relationship

from backend.database import Base


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


class Role(Base):
    __tablename__ = "roles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(32), unique=True, nullable=False, index=True)
    description: Mapped[str] = mapped_column(String(255), nullable=False)
    permissions_json: Mapped[str] = mapped_column(Text, nullable=False, default="[]")

    users: Mapped[list["User"]] = relationship("User", back_populates="role")


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, nullable=False, index=True)
    password_hash: Mapped[str] = mapped_column(String(255), nullable=False)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    role_id: Mapped[int] = mapped_column(ForeignKey("roles.id"), nullable=False)
    role_name: Mapped[str] = mapped_column(String(32), nullable=False, index=True)
    specialty_or_department: Mapped[str | None] = mapped_column(String(150), nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    role: Mapped["Role"] = relationship("Role", back_populates="users")
    profile: Mapped["PatientProfile | None"] = relationship(
        "PatientProfile", back_populates="user", uselist=False, cascade="all, delete-orphan"
    )
    documents: Mapped[list["MedicalDocument"]] = relationship(
        "MedicalDocument", back_populates="patient", cascade="all, delete-orphan"
    )


class PatientProfile(Base):
    __tablename__ = "patient_profiles"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False)
    date_of_birth: Mapped[date | None] = mapped_column(Date, nullable=True)
    gender: Mapped[str | None] = mapped_column(String(32), nullable=True)
    blood_group: Mapped[str | None] = mapped_column(String(16), nullable=True)
    phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    emergency_contact_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    emergency_contact_phone: Mapped[str | None] = mapped_column(String(32), nullable=True)
    ai_consent: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    sharing_consent: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    health_preferences_json: Mapped[str] = mapped_column(Text, default="{}", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    user: Mapped["User"] = relationship("User", back_populates="profile")


class MedicalDocument(Base):
    __tablename__ = "medical_documents"
    __table_args__ = (
        Index("ix_docs_patient_date", "patient_id", "document_date"),
        Index("ix_docs_patient_category", "patient_id", "category"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    category: Mapped[str] = mapped_column(String(64), nullable=False)
    original_filename: Mapped[str] = mapped_column(String(255), nullable=False)
    stored_filename: Mapped[str] = mapped_column(String(255), nullable=False, unique=True)
    mime_type: Mapped[str] = mapped_column(String(100), nullable=False)
    file_size: Mapped[int] = mapped_column(Integer, nullable=False)
    document_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    doctor_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    hospital_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    primary_condition: Mapped[str | None] = mapped_column(String(180), nullable=True)
    ocr_text: Mapped[str] = mapped_column(Text, default="", nullable=False)
    extraction_status: Mapped[str] = mapped_column(String(32), default="pending_review", nullable=False)
    extraction_confidence: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    extraction_provider: Mapped[str] = mapped_column(String(64), default="rapidocr_local", nullable=False)
    is_verified: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    patient: Mapped["User"] = relationship("User", back_populates="documents")
    extracted_info: Mapped["ExtractedMedicalInfo | None"] = relationship(
        "ExtractedMedicalInfo", back_populates="document", uselist=False, cascade="all, delete-orphan"
    )
    lab_results: Mapped[list["LabResult"]] = relationship(
        "LabResult", back_populates="document", cascade="all, delete-orphan"
    )


class ExtractedMedicalInfo(Base):
    __tablename__ = "extracted_medical_info"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    document_id: Mapped[int] = mapped_column(
        ForeignKey("medical_documents.id", ondelete="CASCADE"), unique=True, nullable=False
    )
    patient_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    doctor_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    hospital_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    document_date: Mapped[str | None] = mapped_column(String(32), nullable=True)
    diagnosis: Mapped[str | None] = mapped_column(String(255), nullable=True)
    medications_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    lab_values_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    allergies_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    observations_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    missing_fields_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    document: Mapped["MedicalDocument"] = relationship("MedicalDocument", back_populates="extracted_info")


class MedicalCondition(Base):
    __tablename__ = "medical_conditions"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    document_id: Mapped[int | None] = mapped_column(ForeignKey("medical_documents.id", ondelete="SET NULL"), nullable=True)
    condition_name: Mapped[str] = mapped_column(String(180), nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="active", nullable=False)
    diagnosed_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_type: Mapped[str] = mapped_column(String(32), default="extracted", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class MedicationRecord(Base):
    __tablename__ = "medication_records"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    document_id: Mapped[int | None] = mapped_column(ForeignKey("medical_documents.id", ondelete="SET NULL"), nullable=True)
    medicine_name: Mapped[str] = mapped_column(String(180), nullable=False)
    generic_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    dosage: Mapped[str | None] = mapped_column(String(100), nullable=True)
    frequency: Mapped[str | None] = mapped_column(String(120), nullable=True)
    instructions: Mapped[str | None] = mapped_column(Text, nullable=True)
    prescribed_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    is_current: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    source_type: Mapped[str] = mapped_column(String(32), default="extracted", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class Allergy(Base):
    __tablename__ = "allergies"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    document_id: Mapped[int | None] = mapped_column(ForeignKey("medical_documents.id", ondelete="SET NULL"), nullable=True)
    allergen: Mapped[str] = mapped_column(String(150), nullable=False)
    reaction: Mapped[str | None] = mapped_column(String(200), nullable=True)
    severity: Mapped[str] = mapped_column(String(32), default="moderate", nullable=False)
    recorded_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    source_type: Mapped[str] = mapped_column(String(32), default="extracted", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class LabResult(Base):
    __tablename__ = "lab_results"
    __table_args__ = (Index("ix_labs_patient_test_date", "patient_id", "test_name", "test_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    document_id: Mapped[int] = mapped_column(ForeignKey("medical_documents.id", ondelete="CASCADE"), nullable=False, index=True)
    test_name: Mapped[str] = mapped_column(String(150), nullable=False)
    value_numeric: Mapped[float | None] = mapped_column(Float, nullable=True)
    value_text: Mapped[str] = mapped_column(String(80), nullable=False)
    unit: Mapped[str | None] = mapped_column(String(48), nullable=True)
    reference_range: Mapped[str | None] = mapped_column(String(120), nullable=True)
    flag: Mapped[str] = mapped_column(String(24), default="normal", nullable=False)
    is_abnormal: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    test_date: Mapped[date | None] = mapped_column(Date, nullable=True)

    document: Mapped["MedicalDocument"] = relationship("MedicalDocument", back_populates="lab_results")


class MedicalTimelineEvent(Base):
    __tablename__ = "medical_timelines"
    __table_args__ = (Index("ix_timeline_patient_date", "patient_id", "event_date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    document_id: Mapped[int | None] = mapped_column(ForeignKey("medical_documents.id", ondelete="SET NULL"), nullable=True)
    event_date: Mapped[date] = mapped_column(Date, nullable=False)
    event_type: Mapped[str] = mapped_column(String(48), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    doctor_name: Mapped[str | None] = mapped_column(String(150), nullable=True)
    hospital_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    condition_tag: Mapped[str | None] = mapped_column(String(150), nullable=True)
    is_major_procedure: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class DoctorSummary(Base):
    __tablename__ = "doctor_summaries"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    summary_json: Mapped[str] = mapped_column(Text, nullable=False)
    model_mode: Mapped[str] = mapped_column(String(64), default="verified_vault_facts", nullable=False)
    pdf_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    generated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class ShareSession(Base):
    __tablename__ = "sharing_sessions"
    __table_args__ = (Index("ix_share_token", "token"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token: Mapped[str] = mapped_column(String(64), unique=True, nullable=False)
    title: Mapped[str] = mapped_column(String(160), nullable=False)
    recipient_doctor_email: Mapped[str | None] = mapped_column(String(255), nullable=True, index=True)
    document_ids_json: Mapped[str] = mapped_column(Text, nullable=False)
    include_summary: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    pin_hash: Mapped[str | None] = mapped_column(String(255), nullable=True)
    expires_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    is_revoked: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    revoked_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    access_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    last_accessed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class AccessLog(Base):
    __tablename__ = "access_logs"
    __table_args__ = (Index("ix_access_logs_created", "created_at"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    actor_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    actor_role: Mapped[str] = mapped_column(String(32), default="anonymous", nullable=False)
    share_session_id: Mapped[int | None] = mapped_column(ForeignKey("sharing_sessions.id", ondelete="SET NULL"), nullable=True)
    action: Mapped[str] = mapped_column(String(80), nullable=False)
    resource_type: Mapped[str] = mapped_column(String(64), nullable=False)
    resource_id: Mapped[str] = mapped_column(String(64), nullable=False)
    details: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class ChatConversation(Base):
    __tablename__ = "chat_conversations"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    use_vault_context: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    messages: Mapped[list["ChatMessage"]] = relationship(
        "ChatMessage", back_populates="conversation", cascade="all, delete-orphan", order_by="ChatMessage.created_at"
    )


class ChatMessage(Base):
    __tablename__ = "chat_messages"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    conversation_id: Mapped[int] = mapped_column(
        ForeignKey("chat_conversations.id", ondelete="CASCADE"), nullable=False, index=True
    )
    role: Mapped[str] = mapped_column(String(24), nullable=False)
    content: Mapped[str] = mapped_column(Text, nullable=False)
    attached_document_id: Mapped[int | None] = mapped_column(
        ForeignKey("medical_documents.id", ondelete="SET NULL"), nullable=True
    )
    attachment_image_name: Mapped[str | None] = mapped_column(String(255), nullable=True)
    attachment_stored_path: Mapped[str | None] = mapped_column(String(255), nullable=True)
    citations_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    safety_flags_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    is_emergency: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    provider_mode: Mapped[str] = mapped_column(String(64), default="unconfigured", nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)

    conversation: Mapped["ChatConversation"] = relationship("ChatConversation", back_populates="messages")


class DataSyncRun(Base):
    __tablename__ = "data_sync_runs"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    source_name: Mapped[str] = mapped_column(String(120), nullable=False)
    source_url: Mapped[str] = mapped_column(String(300), nullable=False)
    status: Mapped[str] = mapped_column(String(32), nullable=False)
    documents_fetched: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    records_imported: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    duplicates_skipped: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    error_message: Mapped[str | None] = mapped_column(Text, nullable=True)
    started_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    completed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)


class Region(Base):
    __tablename__ = "geographical_regions"
    __table_args__ = (Index("ix_region_state_district", "state", "name", unique=True),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    code: Mapped[str] = mapped_column(String(48), unique=True, nullable=False, index=True)
    name: Mapped[str] = mapped_column(String(120), nullable=False)
    state: Mapped[str] = mapped_column(String(80), nullable=False)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    population: Mapped[int | None] = mapped_column(Integer, nullable=True)
    geocode_source: Mapped[str | None] = mapped_column(String(120), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class OfficialOutbreakReport(Base):
    __tablename__ = "official_outbreak_reports"
    __table_args__ = (
        Index("ix_outbreak_disease_week", "disease", "reporting_year", "reporting_week"),
        Index("ix_outbreak_region_date", "region_id", "reporting_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    unique_outbreak_id: Mapped[str] = mapped_column(String(80), unique=True, nullable=False, index=True)
    region_id: Mapped[int] = mapped_column(ForeignKey("geographical_regions.id", ondelete="CASCADE"), nullable=False)
    state: Mapped[str] = mapped_column(String(80), nullable=False)
    district: Mapped[str] = mapped_column(String(120), nullable=False)
    disease: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    cases: Mapped[int] = mapped_column(Integer, nullable=False)
    deaths: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    start_date: Mapped[date | None] = mapped_column(Date, nullable=True)
    reporting_date: Mapped[date | None] = mapped_column(Date, nullable=True, index=True)
    reporting_week: Mapped[int] = mapped_column(Integer, nullable=False)
    reporting_year: Mapped[int] = mapped_column(Integer, nullable=False)
    reporting_period: Mapped[str] = mapped_column(String(120), nullable=False)
    outbreak_status: Mapped[str] = mapped_column(String(64), nullable=False)
    comments: Mapped[str | None] = mapped_column(Text, nullable=True)
    source_name: Mapped[str] = mapped_column(String(120), nullable=False)
    source_url: Mapped[str] = mapped_column(String(350), nullable=False)
    source_document_id: Mapped[str] = mapped_column(String(160), nullable=False, index=True)
    validation_status: Mapped[str] = mapped_column(String(32), default="validated", nullable=False)
    import_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class WeatherObservation(Base):
    __tablename__ = "weather_observations"
    __table_args__ = (Index("ix_weather_region_date", "region_id", "obs_date", "is_forecast", unique=True),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    region_id: Mapped[int] = mapped_column(ForeignKey("geographical_regions.id", ondelete="CASCADE"), nullable=False)
    obs_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    is_forecast: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    temperature_c: Mapped[float | None] = mapped_column(Float, nullable=True)
    precipitation_mm: Mapped[float | None] = mapped_column(Float, nullable=True)
    humidity_pct: Mapped[float | None] = mapped_column(Float, nullable=True)
    source_name: Mapped[str] = mapped_column(String(80), nullable=False)
    source_url: Mapped[str] = mapped_column(String(350), nullable=False)
    import_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class PredictionResult(Base):
    __tablename__ = "prediction_results"
    __table_args__ = (Index("ix_pred_disease_region", "disease", "region_id"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    region_id: Mapped[int] = mapped_column(ForeignKey("geographical_regions.id", ondelete="CASCADE"), nullable=False)
    disease: Mapped[str] = mapped_column(String(160), nullable=False)
    model_version: Mapped[str] = mapped_column(String(64), nullable=False)
    training_data_period: Mapped[str] = mapped_column(String(120), nullable=False)
    target_period: Mapped[str] = mapped_column(String(120), nullable=False)
    observed_cases_recent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    observed_deaths_recent: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    outbreak_probability: Mapped[float | None] = mapped_column(Float, nullable=True)
    risk_score: Mapped[float | None] = mapped_column(Float, nullable=True)
    risk_level: Mapped[str] = mapped_column(String(32), nullable=False)
    confidence_or_uncertainty: Mapped[str] = mapped_column(String(160), nullable=False)
    model_name: Mapped[str] = mapped_column(String(100), nullable=False)
    cv_roc_auc: Mapped[float | None] = mapped_column(Float, nullable=True)
    cv_accuracy: Mapped[float | None] = mapped_column(Float, nullable=True)
    feature_importances_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    explanation_text: Mapped[str] = mapped_column(Text, nullable=False)
    limitations_text: Mapped[str] = mapped_column(Text, nullable=False)
    source_dataset_ids_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    prediction_timestamp: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class InterventionScenario(Base):
    __tablename__ = "intervention_scenarios"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    created_by_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False)
    name: Mapped[str] = mapped_column(String(160), nullable=False)
    region_id: Mapped[int] = mapped_column(ForeignKey("geographical_regions.id", ondelete="CASCADE"), nullable=False)
    disease: Mapped[str] = mapped_column(String(160), nullable=False)
    initial_active_cases: Mapped[int] = mapped_column(Integer, nullable=False)
    available_beds: Mapped[int] = mapped_column(Integer, nullable=False)
    medical_staff: Mapped[int] = mapped_column(Integer, nullable=False)
    prevention_coverage_pct: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    vaccination_coverage_pct: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    budget_usd: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    intervention_start_day: Mapped[int] = mapped_column(Integer, default=3, nullable=False)
    results_json: Mapped[str] = mapped_column(Text, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class PublicHealthAlert(Base):
    __tablename__ = "public_health_alerts"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    region_id: Mapped[int] = mapped_column(ForeignKey("geographical_regions.id", ondelete="CASCADE"), nullable=False)
    source_outbreak_id: Mapped[str | None] = mapped_column(String(80), nullable=True)
    source_document_id: Mapped[str | None] = mapped_column(String(160), nullable=True)
    disease: Mapped[str] = mapped_column(String(160), nullable=False)
    severity: Mapped[str] = mapped_column(String(24), nullable=False)
    alert_type: Mapped[str] = mapped_column(String(48), nullable=False)
    title: Mapped[str] = mapped_column(String(220), nullable=False)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    recommended_action: Mapped[str] = mapped_column(Text, nullable=False)
    metric_value: Mapped[str] = mapped_column(String(120), nullable=False)
    is_acknowledged: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class Speciality(Base):
    __tablename__ = "specialities"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    name: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    slug: Mapped[str] = mapped_column(String(120), unique=True, nullable=False, index=True)
    description: Mapped[str] = mapped_column(Text, nullable=False)
    category: Mapped[str] = mapped_column(String(64), default="Medical", nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class Clinic(Base):
    __tablename__ = "clinics"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    owner_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True)
    name: Mapped[str] = mapped_column(String(180), nullable=False)
    address: Mapped[str] = mapped_column(String(300), nullable=False)
    city: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    state: Mapped[str] = mapped_column(String(100), nullable=False)
    postal_code: Mapped[str] = mapped_column(String(24), nullable=False, index=True)
    contact_information: Mapped[str | None] = mapped_column(String(180), nullable=True)
    latitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    longitude: Mapped[float | None] = mapped_column(Float, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)


class Doctor(Base):
    __tablename__ = "doctors"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), unique=True, nullable=False, index=True)
    full_name: Mapped[str] = mapped_column(String(150), nullable=False)
    qualifications: Mapped[str] = mapped_column(String(255), nullable=False)
    registration_number: Mapped[str] = mapped_column(String(100), nullable=False, index=True)
    primary_speciality_id: Mapped[int] = mapped_column(ForeignKey("specialities.id"), nullable=False, index=True)
    secondary_speciality_ids_json: Mapped[str] = mapped_column(Text, default="[]", nullable=False)
    experience_years: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    consultation_fee: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    consultation_modes_json: Mapped[str] = mapped_column(Text, default='["in_person","online"]', nullable=False)
    languages_json: Mapped[str] = mapped_column(Text, default='["English"]', nullable=False)
    biography: Mapped[str] = mapped_column(Text, default="", nullable=False)
    clinic_id: Mapped[int | None] = mapped_column(ForeignKey("clinics.id", ondelete="SET NULL"), nullable=True, index=True)
    photo_filename: Mapped[str | None] = mapped_column(String(255), nullable=True)
    contact_phone: Mapped[str | None] = mapped_column(String(48), nullable=True)
    auto_confirm: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    verification_status: Mapped[str] = mapped_column(String(32), default="pending_verification", nullable=False, index=True)
    verification_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    verified_by_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    verified_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    report_count: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    primary_speciality: Mapped["Speciality"] = relationship("Speciality")
    clinic: Mapped["Clinic | None"] = relationship("Clinic")


class DoctorAvailability(Base):
    __tablename__ = "doctor_availability"
    __table_args__ = (Index("ix_doc_avail_day", "doctor_id", "weekday"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctors.id", ondelete="CASCADE"), nullable=False, index=True)
    clinic_id: Mapped[int | None] = mapped_column(ForeignKey("clinics.id", ondelete="SET NULL"), nullable=True)
    weekday: Mapped[int] = mapped_column(Integer, nullable=False)  # 0 = Monday .. 6 = Sunday
    start_time: Mapped[str] = mapped_column(String(8), nullable=False)  # HH:MM
    end_time: Mapped[str] = mapped_column(String(8), nullable=False)    # HH:MM
    slot_duration: Mapped[int] = mapped_column(Integer, default=20, nullable=False)
    break_periods: Mapped[str] = mapped_column(Text, default="[]", nullable=False)  # JSON list of {start, end}
    buffer_duration: Mapped[int] = mapped_column(Integer, default=5, nullable=False)
    consultation_modes_json: Mapped[str] = mapped_column(Text, default='["in_person","online"]', nullable=False)
    active_status: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class AvailabilityException(Base):
    __tablename__ = "availability_exceptions"
    __table_args__ = (Index("ix_avail_exc_doc_date", "doctor_id", "date"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctors.id", ondelete="CASCADE"), nullable=False, index=True)
    date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    start_time: Mapped[str | None] = mapped_column(String(8), nullable=True)
    end_time: Mapped[str | None] = mapped_column(String(8), nullable=True)
    exception_type: Mapped[str] = mapped_column(String(32), nullable=False)  # holiday | blocked | leave | extra_availability
    slot_duration: Mapped[int | None] = mapped_column(Integer, nullable=True)
    reason: Mapped[str | None] = mapped_column(String(240), nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class Appointment(Base):
    __tablename__ = "appointments"
    __table_args__ = (
        Index("ix_appt_doctor_date", "doctor_id", "appointment_date"),
        Index("ix_appt_patient_date", "patient_id", "appointment_date"),
    )

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    patient_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctors.id", ondelete="CASCADE"), nullable=False, index=True)
    clinic_id: Mapped[int | None] = mapped_column(ForeignKey("clinics.id", ondelete="SET NULL"), nullable=True)
    appointment_date: Mapped[date] = mapped_column(Date, nullable=False, index=True)
    start_time: Mapped[str] = mapped_column(String(8), nullable=False)
    end_time: Mapped[str] = mapped_column(String(8), nullable=False)
    slot_start_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, index=True)
    slot_end_utc: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    timezone_name: Mapped[str] = mapped_column(String(64), default="Asia/Kolkata", nullable=False)
    consultation_type: Mapped[str] = mapped_column(String(24), default="in_person", nullable=False)
    appointment_status: Mapped[str] = mapped_column(String(32), default="confirmed", nullable=False, index=True)
    consultation_fee: Mapped[float] = mapped_column(Float, default=0.0, nullable=False)
    patient_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    doctor_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    cancellation_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    rescheduled_from_id: Mapped[int | None] = mapped_column(ForeignKey("appointments.id", ondelete="SET NULL"), nullable=True)
    share_session_id: Mapped[int | None] = mapped_column(ForeignKey("sharing_sessions.id", ondelete="SET NULL"), nullable=True)
    # Atomic DB concurrency lock: populated only for active (pending/confirmed) bookings; cleared on cancel/reject/reschedule/complete
    active_slot_key: Mapped[str | None] = mapped_column(String(64), unique=True, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, onupdate=utc_now, nullable=False)

    doctor: Mapped["Doctor"] = relationship("Doctor")
    clinic: Mapped["Clinic | None"] = relationship("Clinic")


class DoctorReport(Base):
    __tablename__ = "doctor_reports"

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    doctor_id: Mapped[int] = mapped_column(ForeignKey("doctors.id", ondelete="CASCADE"), nullable=False, index=True)
    reporter_user_id: Mapped[int | None] = mapped_column(ForeignKey("users.id", ondelete="SET NULL"), nullable=True)
    reason: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str] = mapped_column(String(32), default="open", nullable=False)
    admin_notes: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)


class Notification(Base):
    __tablename__ = "notifications"
    __table_args__ = (Index("ix_notif_user_read", "recipient_user_id", "read_status"),)

    id: Mapped[int] = mapped_column(Integer, primary_key=True, autoincrement=True)
    recipient_user_id: Mapped[int] = mapped_column(ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    notification_type: Mapped[str] = mapped_column(String(48), nullable=False)
    title: Mapped[str] = mapped_column(String(200), nullable=False)
    message: Mapped[str] = mapped_column(Text, nullable=False)
    related_entity_type: Mapped[str | None] = mapped_column(String(48), nullable=True)
    related_entity_id: Mapped[int | None] = mapped_column(Integer, nullable=True)
    read_status: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), default=utc_now, nullable=False)
