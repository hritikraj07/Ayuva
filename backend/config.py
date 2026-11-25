from functools import lru_cache
from pathlib import Path
from typing import List
import os
from dotenv import load_dotenv

BASE_DIR = Path(__file__).resolve().parent.parent
load_dotenv(BASE_DIR / ".env")


class Settings:
    """Application settings loaded from environment variables."""

    APP_NAME: str = "Ayuva"
    APP_VERSION: str = "2.0.0"
    DEMO_MODE: bool = os.getenv("DEMO_MODE", "false").strip().lower() == "true"

    DATABASE_URL: str = (
        os.getenv("DATABASE_URL", "").strip()
        or f"sqlite:///{(BASE_DIR / 'data' / 'ayuva.db').as_posix()}"
    )
    SECRET_KEY: str = os.getenv("SECRET_KEY", "ayuva-hackathon-dev-secret-change-in-production")
    ACCESS_TOKEN_EXPIRE_MINUTES: int = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "720"))

    _default_runtime_root = Path("/tmp/ayuva") if os.getenv("VERCEL") else BASE_DIR
    UPLOAD_DIR: Path = Path(os.getenv("UPLOAD_DIR", str(_default_runtime_root / "uploads")))
    SUMMARY_DIR: Path = Path(os.getenv("SUMMARY_DIR", str(_default_runtime_root / "data" / "summaries")))
    MAX_UPLOAD_SIZE_BYTES: int = int(os.getenv("MAX_UPLOAD_SIZE_MB", "10")) * 1024 * 1024

    GEMINI_API_KEY: str = os.getenv("GEMINI_API_KEY", "").strip()
    OPENAI_API_KEY: str = os.getenv("OPENAI_API_KEY", "").strip()
    LLM_MODEL: str = os.getenv("LLM_MODEL", "gemini-flash-latest").strip()
    GEMINI_TIMEOUT_SECONDS: float = float(os.getenv("GEMINI_TIMEOUT_SECONDS", "30"))

    CORS_ORIGINS: List[str] = [
        origin.strip()
        for origin in os.getenv(
            "CORS_ORIGINS",
            "http://localhost:5173,http://127.0.0.1:5173,http://localhost:4173,http://127.0.0.1:4173,https://ayuva-omega.vercel.app",
        ).split(",")
        if origin.strip()
    ]

    @property
    def is_sqlite(self) -> bool:
        return self.DATABASE_URL.startswith("sqlite")

    @property
    def has_live_llm(self) -> bool:
        return bool(self.GEMINI_API_KEY or self.OPENAI_API_KEY)


@lru_cache
def get_settings() -> Settings:
    settings = Settings()
    settings.UPLOAD_DIR.mkdir(parents=True, exist_ok=True)
    settings.SUMMARY_DIR.mkdir(parents=True, exist_ok=True)
    data_dir = Path("/tmp/ayuva/data") if os.getenv("VERCEL") else (BASE_DIR / "data")
    data_dir.mkdir(parents=True, exist_ok=True)
    return settings
