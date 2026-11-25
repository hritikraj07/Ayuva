from fastapi import APIRouter, Depends, HTTPException, status
from sqlalchemy.orm import Session

from backend.auth import (
    create_access_token,
    get_current_user,
    hash_password,
    log_access,
    verify_password,
)
from backend.database import get_db
from backend.models import PatientProfile, Role, User
from backend.schemas import AuthResponse, LoginRequest, RegisterRequest, UserOut

router = APIRouter(prefix="/api/auth", tags=["Authentication"])


def _to_user_out(user: User) -> UserOut:
    return UserOut(
        id=user.id,
        email=user.email,
        full_name=user.full_name,
        role=user.role_name,
        specialty_or_department=user.specialty_or_department,
        created_at=user.created_at,
    )


@router.post("/register", response_model=AuthResponse, status_code=status.HTTP_201_CREATED)
def register(payload: RegisterRequest, db: Session = Depends(get_db)):
    email = payload.email.lower().strip()
    existing = db.query(User).filter(User.email == email).first()
    if existing:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail="An account with this email already exists.")

    role = db.query(Role).filter(Role.name == payload.role).first()
    if not role:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail="Requested role is not configured.")

    user = User(
        email=email,
        password_hash=hash_password(payload.password),
        full_name=payload.full_name.strip(),
        role_id=role.id,
        role_name=role.name,
        specialty_or_department=payload.specialty_or_department,
    )
    db.add(user)
    db.commit()
    db.refresh(user)

    if role.name == "patient":
        db.add(PatientProfile(user_id=user.id, ai_consent=True, sharing_consent=True))
        db.commit()

    log_access(
        db,
        actor_user_id=user.id,
        actor_role=user.role_name,
        action="user_registered",
        resource_type="user",
        resource_id=str(user.id),
    )

    token = create_access_token(user)
    return AuthResponse(access_token=token, user=_to_user_out(user))


@router.post("/login", response_model=AuthResponse)
def login(payload: LoginRequest, db: Session = Depends(get_db)):
    email = payload.email.lower().strip()
    user = db.query(User).filter(User.email == email, User.is_active.is_(True)).first()
    if not user or not verify_password(payload.password, user.password_hash):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid email or password.")

    log_access(
        db,
        actor_user_id=user.id,
        actor_role=user.role_name,
        action="user_logged_in",
        resource_type="user",
        resource_id=str(user.id),
    )

    token = create_access_token(user)
    return AuthResponse(access_token=token, user=_to_user_out(user))


@router.get("/me", response_model=UserOut)
def get_me(current_user: User = Depends(get_current_user)):
    return _to_user_out(current_user)
