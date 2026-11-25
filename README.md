# MedLedger: AI-Powered Healthcare & Disease Intelligence Platform

MedLedger unifies three healthcare capabilities inside one role-isolated platform:

1. **AI Medical Document Manager (Personal Health Vault):** DigiLocker-style personal storage for prescriptions, laboratory reports, medical certificates, diagnostic reports, and discharge summaries, powered by `pypdf` + `RapidOCR` + OpenCV image enhancement, human-in-the-loop extraction verification, chronological timeline filtering, One-Minute Doctor Summary PDF generation, and scoped temporary QR/PIN record sharing.
2. **Personalized AI Healthcare Assistant:** Conversational assistant that uses consented vault records to explain lab reports in plain language, compare historical test trends, search medicine uses/precautions/interactions, inspect medicine strip or skin concern photos with explicit uncertainty notices, and escalate red-flag emergency symptoms immediately.
3. **AI Disease Outbreak Prediction & Intervention System:** Public-health surveillance workspace featuring a `scikit-learn` `RandomForestRegressor` 7-day forecasting pipeline with feature importances and validation metrics (`MAE`, `R²`), an interactive Leaflet geospatial risk map, smart public-health alerts, and a 30-day SEIR compartmental intervention simulator.

---

## Application Architecture

```text
TechFusion4.0/
├── backend/
│   ├── main.py                     # FastAPI entry point, CORS, DB seeding lifespan
│   ├── config.py                   # Environment variable configuration
│   ├── database.py                 # SQLAlchemy engine (SQLite default / PostgreSQL via DATABASE_URL)
│   ├── models.py                   # 19 relational tables (Users, Roles, Vault, Shares, Chat, Outbreak ML, SEIR)
│   ├── schemas.py                  # Pydantic input/output validation schemas
│   ├── auth.py                     # bcrypt password hashing, PyJWT tokens, RBAC & audit logging
│   ├── routers/
│   │   ├── auth_router.py          # /api/auth/*
│   │   ├── vault_router.py         # /api/vault/* (upload, OCR verify, timeline, summary PDF, deletion)
│   │   ├── sharing_router.py       # /api/shares/* (QR shares, PIN verification, scoped doctor viewer)
│   │   ├── chat_router.py          # /api/chat/* (conversations, attachments, medicine search)
│   │   └── outbreak_router.py      # /api/outbreak/* (overview, ML retrain, alerts, SEIR simulator)
│   ├── services/
│   │   ├── ocr_extraction.py       # Magic-byte validation, OpenCV preprocessing, pypdf + RapidOCR
│   │   ├── summary_service.py      # One-Minute Doctor Summary & ReportLab PDF export
│   │   ├── sharing_service.py      # QR PNG generator, expiration, strictly scoped payload builder
│   │   ├── assistant_service.py    # Emergency guardrails, lab explainer, medicine KB, optional Gemini/OpenAI
│   │   ├── outbreak_ml.py          # RandomForestRegressor 7-day forecaster & feature importances
│   │   ├── simulator_service.py    # Deterministic 30-day SEIR compartmental simulator
│   │   └── seed_data.py            # Synthetic demo accounts, PDFs, and 90-day surveillance dataset
│   └── tests/
│       └── test_api_e2e.py         # Full workflow integration tests
├── frontend/
│   └── src/
│       ├── context/AuthContext.tsx # JWT session persistence
│       ├── components/             # BrandMark, AppShell, UI primitives, OutbreakRiskMap (Leaflet)
│       └── pages/                  # Public, Patient, Doctor, and Public Health Admin views
└── .env.example                    # Environment configuration template
```

---

## Database Setup

MedLedger uses SQLAlchemy 2.x models compatible with both **PostgreSQL** and **SQLite**:

- **Zero-setup Hackathon Demo (Default):** Leave `DATABASE_URL` unset. On startup, the backend automatically initializes `./data/medledger.db`, creates all 19 tables, seeds synthetic demo accounts/documents, and trains the outbreak forecasting models.
- **PostgreSQL Setup:** Create a PostgreSQL database (for example `medledger`), copy `.env.example` to `.env`, and set:
  ```env
  DATABASE_URL=postgresql+psycopg2://postgres:yourpassword@localhost:5432/medledger
  ```

---

## Environment Variables

Copy `.env.example` to `.env` in the repository root:

| Variable | Required | Default | Description |
| --- | --- | --- | --- |
| `DATABASE_URL` | Optional | `sqlite:///./data/medledger.db` | PostgreSQL or SQLite connection string |
| `SECRET_KEY` | Recommended | Dev fallback key | Random 32+ char JWT signing secret |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | Optional | `720` | JWT expiration window |
| `MAX_UPLOAD_SIZE_MB` | Optional | `10` | Maximum medical document upload size |
| `GEMINI_API_KEY` | Optional | Empty | Enables Gemini multimodal extraction and chat |
| `OPENAI_API_KEY` | Optional | Empty | Alternative live LLM provider (`gpt-4o-mini`) |
| `LLM_MODEL` | Optional | `gemini-2.0-flash` | Gemini model ID when `GEMINI_API_KEY` is set |
| `CORS_ORIGINS` | Optional | `http://localhost:5173,...` | Comma-separated allowed frontend origins |

> **Fallback Transparency:** When `GEMINI_API_KEY` and `OPENAI_API_KEY` are not set, document extraction uses `pypdf` + `RapidOCR` + deterministic clinical parsing, and the health assistant runs a clearly labeled local clinical guidance fallback using verified reference tables and consented vault records.

---

## Running the Backend & Frontend

### 1. Backend (FastAPI)

```bash
pip install -r backend/requirements.txt
uvicorn backend.main:app --reload --port 8000
```

API documentation is available at `http://127.0.0.1:8000/docs`.

### 2. Frontend (React + Vite + TypeScript)

```bash
cd frontend
npm install
npm run dev
```

Open `http://localhost:5173`. Vite proxies `/api/*` requests directly to `http://127.0.0.1:8000`.

### 3. Automated API Verification

```bash
python -m pytest -v backend/tests/test_api_e2e.py
```

---

## Synthetic Demo Login Credentials

| Role | Email | Password | Capabilities |
| --- | --- | --- | --- |
| **Patient** | `patient@medledger.demo` | `Patient@2026` | 5 verified records, HbA1c/glucose lab trends, Penicillin allergy alert, AI assistant, PDF summary, QR sharing |
| **Doctor** | `doctor@medledger.demo` | `Doctor@2026` | Read-only viewer scoped exclusively to patient share sessions assigned or unlocked by token/PIN |
| **Public Health Admin** | `admin@medledger.demo` | `Admin@2026` | 10-district surveillance, RandomForest 7-day forecasts, Leaflet risk map, SEIR simulator, alerts (zero private vault access) |

---

## Known Limitations & Real-World Integration Notes

- **Surveillance Dataset:** Outbreak prediction and mapping currently use an explicitly labeled synthetic 90-day, 10-district epidemiological and meteorological dataset. Production deployment should connect live public-health APIs (e.g., IDSP, WHO FluNet/Dengue feeds, Open-Meteo weather endpoints, and regional hospital capacity feeds).
- **LLM & Vision Capabilities:** Live generative reasoning and complex dermatological/packaging vision benefit from setting `GEMINI_API_KEY` or `OPENAI_API_KEY`; without an external key, the assistant uses local OCR + curated clinical reference matching and states its limitations clearly.
- **Medical Safety:** The assistant and One-Minute Doctor Summary are informational tools only and never diagnose conditions, prescribe medications, or replace licensed clinical care.
- **File Storage:** Uploaded files are stored locally under `./uploads/` and served through authenticated or expiring-token endpoints; production deployments should mount encrypted object storage (S3/GCS with signed URLs).
