from datetime import date, datetime
from typing import Any, Dict, List, Optional
from pydantic import BaseModel, EmailStr, Field, field_validator


class RegisterRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=8, max_length=128)
    full_name: str = Field(min_length=2, max_length=150)
    role: str = Field(default="patient")
    specialty_or_department: Optional[str] = Field(default=None, max_length=150)

    @field_validator("role")
    @classmethod
    def validate_role(cls, v: str) -> str:
        normalized = v.strip().lower()
        if normalized not in {"patient", "doctor", "admin"}:
            raise ValueError("Role must be patient, doctor, or admin.")
        return normalized


class LoginRequest(BaseModel):
    email: EmailStr
    password: str = Field(min_length=1, max_length=128)


class UserOut(BaseModel):
    id: int
    email: str
    full_name: str
    role: str
    specialty_or_department: Optional[str] = None
    created_at: datetime


class AuthResponse(BaseModel):
    access_token: str
    token_type: str = "bearer"
    user: UserOut


class PatientProfileOut(BaseModel):
    user_id: int
    full_name: str
    email: str
    date_of_birth: Optional[date] = None
    gender: Optional[str] = None
    blood_group: Optional[str] = None
    phone: Optional[str] = None
    emergency_contact_name: Optional[str] = None
    emergency_contact_phone: Optional[str] = None
    ai_consent: bool = True
    sharing_consent: bool = True
    health_preferences: Dict[str, Any] = Field(default_factory=dict)


class PatientProfileUpdate(BaseModel):
    full_name: Optional[str] = Field(default=None, min_length=2, max_length=150)
    date_of_birth: Optional[date] = None
    gender: Optional[str] = Field(default=None, max_length=32)
    blood_group: Optional[str] = Field(default=None, max_length=16)
    phone: Optional[str] = Field(default=None, max_length=32)
    emergency_contact_name: Optional[str] = Field(default=None, max_length=150)
    emergency_contact_phone: Optional[str] = Field(default=None, max_length=32)
    ai_consent: Optional[bool] = None
    sharing_consent: Optional[bool] = None
    health_preferences: Optional[Dict[str, Any]] = None


class ExtractedMedicationItem(BaseModel):
    medicine_name: str
    dosage: Optional[str] = None
    frequency: Optional[str] = None
    instructions: Optional[str] = None


class ExtractedLabValueItem(BaseModel):
    test_name: str
    value_numeric: Optional[float] = None
    value_text: str
    unit: Optional[str] = None
    reference_range: Optional[str] = None
    flag: str = "normal"
    is_abnormal: bool = False


class ExtractedInfoPayload(BaseModel):
    patient_name: Optional[str] = None
    doctor_name: Optional[str] = None
    hospital_name: Optional[str] = None
    document_date: Optional[str] = None
    diagnosis: Optional[str] = None
    medications: List[ExtractedMedicationItem] = Field(default_factory=list)
    lab_values: List[ExtractedLabValueItem] = Field(default_factory=list)
    allergies: List[str] = Field(default_factory=list)
    observations: List[str] = Field(default_factory=list)
    missing_fields: List[str] = Field(default_factory=list)


class DocumentVerifyRequest(BaseModel):
    title: str = Field(min_length=1, max_length=200)
    category: str
    document_date: Optional[date] = None
    doctor_name: Optional[str] = None
    hospital_name: Optional[str] = None
    primary_condition: Optional[str] = None
    notes: Optional[str] = None
    extracted: ExtractedInfoPayload
    commit_to_profile: bool = True

    @field_validator("category")
    @classmethod
    def validate_category(cls, v: str) -> str:
        allowed = {
            "prescription",
            "lab_report",
            "medical_certificate",
            "diagnostic_report",
            "discharge_summary",
        }
        if v not in allowed:
            raise ValueError(f"Category must be one of: {', '.join(sorted(allowed))}")
        return v


class MedicalConditionCreate(BaseModel):
    condition_name: str = Field(min_length=2, max_length=180)
    status: str = Field(default="active")
    diagnosed_date: Optional[date] = None
    notes: Optional[str] = None


class MedicationCreate(BaseModel):
    medicine_name: str = Field(min_length=2, max_length=180)
    generic_name: Optional[str] = None
    dosage: Optional[str] = None
    frequency: Optional[str] = None
    instructions: Optional[str] = None
    prescribed_date: Optional[date] = None
    is_current: bool = True


class AllergyCreate(BaseModel):
    allergen: str = Field(min_length=2, max_length=150)
    reaction: Optional[str] = None
    severity: str = Field(default="moderate")
    recorded_date: Optional[date] = None


class ShareSessionCreate(BaseModel):
    title: str = Field(min_length=2, max_length=160)
    document_ids: List[int] = Field(min_length=1)
    include_summary: bool = True
    expiry_minutes: int = Field(default=30, ge=5, le=10080)
    pin: Optional[str] = Field(default=None, min_length=4, max_length=8)
    recipient_doctor_email: Optional[EmailStr] = None


class SharePinVerifyRequest(BaseModel):
    pin: str = Field(min_length=4, max_length=8)


class ConversationCreate(BaseModel):
    title: Optional[str] = Field(default="New Consultation Question", max_length=200)
    use_vault_context: bool = True


class ChatSendRequest(BaseModel):
    message: str = Field(min_length=1, max_length=4000)
    attached_document_id: Optional[int] = None
    use_vault_context: Optional[bool] = None


class SimulationRequest(BaseModel):
    name: str = Field(min_length=2, max_length=160)
    region_id: int
    disease: str = Field(min_length=2, max_length=160)
    initial_active_cases: int = Field(ge=1, le=500000)
    population_override: Optional[int] = Field(default=None, ge=1000, le=50000000)
    available_beds: int = Field(ge=1, le=50000)
    medical_staff: int = Field(ge=1, le=20000)
    prevention_coverage_pct: float = Field(default=30.0, ge=0.0, le=90.0)
    vaccination_coverage_pct: float = Field(default=0.0, ge=0.0, le=90.0)
    budget_usd: float = Field(default=150000.0, ge=0.0, le=50000000.0)
    intervention_start_day: int = Field(default=3, ge=0, le=21)
