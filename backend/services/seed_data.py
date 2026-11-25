from sqlalchemy.orm import Session

from backend.auth import hash_password
from backend.models import PatientProfile, Role, Speciality, User

DEFAULT_SPECIALITIES = [
    ("General Physician", "general-physician", "Primary care diagnosis, fevers, preventive checkups, and chronic care coordination.", "Primary Care"),
    ("Dermatologist", "dermatologist", "Skin rashes, acne, eczema, hair/nail disorders, and dermatological evaluations.", "Medical"),
    ("Cardiologist", "cardiologist", "Heart rhythm, blood pressure, chest discomfort assessment, and cardiovascular prevention.", "Medical"),
    ("Neurologist", "neurologist", "Migraines, dizziness, seizures, neuropathy, and nervous system evaluation.", "Medical"),
    ("Orthopedist", "orthopedist", "Joint pain, fractures, back or spine issues, sports injuries, and mobility care.", "Surgical"),
    ("Pediatrician", "pediatrician", "Infant, child, and adolescent growth, immunizations, and acute pediatric care.", "Primary Care"),
    ("Gynecologist", "gynecologist", "Women's reproductive health, menstrual care, prenatal guidance, and screenings.", "Medical"),
    ("ENT Specialist", "ent-specialist", "Ear infections, sinus issues, throat pain, vertigo, and hearing concerns.", "Surgical"),
    ("Ophthalmologist", "ophthalmologist", "Vision changes, eye infections, glaucoma screening, and retinal evaluations.", "Surgical"),
    ("Psychiatrist", "psychiatrist", "Anxiety, depression, sleep disorders, stress management, and mental health care.", "Mental Health"),
    ("Gastroenterologist", "gastroenterologist", "Digestive pain, acidity, liver health, IBS, and gastrointestinal evaluations.", "Medical"),
    ("Endocrinologist", "endocrinologist", "Diabetes, thyroid disorders, hormonal balance, and metabolic conditions.", "Medical"),
    ("Dentist", "dentist", "Oral hygiene, toothache, gum care, dental restorations, and preventive checkups.", "Dental"),
    ("Pulmonologist", "pulmonologist", "Chronic cough, asthma, shortness of breath, sleep apnea, and respiratory care.", "Medical"),
]


def seed_database(db: Session) -> None:
    """Ensure RBAC roles, controlled speciality catalog, and clean-slate login accounts exist without mock doctors/records."""
    roles_spec = [
        ("patient", "Individual user managing personal medical vault, timeline, and assistant"),
        ("doctor", "Licensed clinician managing verified practice profile, schedule, and patient-shared records"),
        ("admin", "Public health authority and directory administrator managing verifications and surveillance"),
    ]
    role_map: dict[str, Role] = {}
    for name, desc in roles_spec:
        existing = db.query(Role).filter(Role.name == name).first()
        if not existing:
            existing = Role(name=name, description=desc)
            db.add(existing)
            db.flush()
        role_map[name] = existing

    for name, slug, desc, category in DEFAULT_SPECIALITIES:
        if not db.query(Speciality).filter(Speciality.slug == slug).first():
            db.add(Speciality(name=name, slug=slug, description=desc, category=category, is_active=True))

    demo_users = [
        {
            "email": "patient@ayuva.demo",
            "password": "Patient@2026",
            "full_name": "Demo Patient",
            "role_name": "patient",
            "specialty_or_department": None,
        },
        {
            "email": "doctor@ayuva.demo",
            "password": "Doctor@2026",
            "full_name": "Demo Physician",
            "role_name": "doctor",
            "specialty_or_department": "General Medicine",
        },
        {
            "email": "admin@ayuva.demo",
            "password": "Admin@2026",
            "full_name": "Demo Public Health Officer",
            "role_name": "admin",
            "specialty_or_department": "Epidemiological Surveillance",
        },
    ]

    for spec in demo_users:
        user = db.query(User).filter(User.email == spec["email"]).first()
        if not user:
            role_obj = role_map[spec["role_name"]]
            user = User(
                email=spec["email"],
                password_hash=hash_password(spec["password"]),
                full_name=spec["full_name"],
                role_id=role_obj.id,
                role_name=spec["role_name"],
                specialty_or_department=spec["specialty_or_department"],
            )
            db.add(user)
            db.flush()
            if spec["role_name"] == "patient":
                db.add(PatientProfile(user_id=user.id, ai_consent=True, sharing_consent=True))

    db.commit()
