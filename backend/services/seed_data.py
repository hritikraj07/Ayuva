from sqlalchemy.orm import Session

from backend.auth import hash_password
from backend.models import PatientProfile, Role, User


def seed_database(db: Session) -> None:
    """Ensure RBAC roles and optional clean-slate demo login accounts exist without preloaded mock records."""
    roles_spec = [
        ("patient", "Individual user managing personal medical vault, timeline, and assistant"),
        ("doctor", "Licensed clinician viewing strictly patient-shared records and summaries"),
        ("admin", "Public health authority monitoring regional outbreak intelligence and simulations"),
    ]
    role_map: dict[str, Role] = {}
    for name, desc in roles_spec:
        existing = db.query(Role).filter(Role.name == name).first()
        if not existing:
            existing = Role(name=name, description=desc)
            db.add(existing)
            db.flush()
        role_map[name] = existing

    demo_users = [
        {
            "email": "patient@medledger.demo",
            "password": "Patient@2026",
            "full_name": "Demo Patient",
            "role_name": "patient",
            "specialty_or_department": None,
        },
        {
            "email": "doctor@medledger.demo",
            "password": "Doctor@2026",
            "full_name": "Demo Physician",
            "role_name": "doctor",
            "specialty_or_department": "General Medicine",
        },
        {
            "email": "admin@medledger.demo",
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
