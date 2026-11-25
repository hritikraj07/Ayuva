from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from backend.config import get_settings
from backend.database import Base, SessionLocal, engine
from backend.routers import appointments_router, auth_router, chat_router, doctors_router, outbreak_router, sharing_router, vault_router
from backend.services.assistant_service import get_active_gemini_key, get_active_gemini_model
from backend.services.seed_data import seed_database

settings = get_settings()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    Base.metadata.create_all(bind=engine)
    db = SessionLocal()
    try:
        seed_database(db)
    finally:
        db.close()
    yield


app = FastAPI(
    title="Ayuva Healthcare & Disease Intelligence API",
    version=settings.APP_VERSION,
    description="Unified Personal Medical Vault, Personalized Clinical AI Assistant, and Outbreak Surveillance Platform.",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.CORS_ORIGINS,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(auth_router.router)
app.include_router(vault_router.router)
app.include_router(sharing_router.router)
app.include_router(chat_router.router)
app.include_router(outbreak_router.router)
app.include_router(doctors_router.router)
app.include_router(appointments_router.router)


@app.get("/api/health")
def health_check():
    gemini_key_set = bool(get_active_gemini_key())
    return {
        "status": "ok",
        "service": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "demo_mode": settings.DEMO_MODE,
        "ai_configured": gemini_key_set,
        "database_mode": "sqlite" if settings.is_sqlite else "postgresql",
        "llm_provider": f"gemini:{get_active_gemini_model()}" if gemini_key_set else "unconfigured",
    }
