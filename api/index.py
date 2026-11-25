# Vercel serverless entry point – imports the FastAPI app from the backend package.
# Vercel auto-detects `app` in api/index.py and wraps it as a Python serverless function.
from backend.main import app  # noqa: F401 – re-exported as `app` for Vercel

__all__ = ["app"]
