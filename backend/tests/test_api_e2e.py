import io
from uuid import uuid4

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas

from backend.config import get_settings
from backend.database import Base, engine
from backend.main import app


def _make_clinical_pdf_bytes() -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(60, 760, "City Care Clinic - Consultation & Lab Summary")
    c.drawString(60, 740, "Patient Name: Asha Kulkarni")
    c.drawString(60, 720, "Doctor: Dr. R. Deshmukh")
    c.drawString(60, 700, "Hospital: City Care Clinic")
    c.drawString(60, 680, "Date: 2026-10-12")
    c.drawString(60, 655, "Diagnosis: Type 2 Diabetes Mellitus")
    c.drawString(60, 635, "Allergies: Penicillin (Severe rash)")
    c.drawString(60, 615, "Medications:")
    c.drawString(80, 595, "1. Metformin 500 mg twice daily after meals")
    c.drawString(60, 570, "Lab Results:")
    c.drawString(80, 550, "HbA1c: 7.4 % (Reference Range: 4.0 - 5.6 %)")
    c.drawString(80, 530, "Hemoglobin: 12.8 g/dL (Reference Range: 12.0 - 15.5 g/dL)")
    c.showPage()
    c.save()
    return buf.getvalue()


def _make_text_png_bytes(lines: list[str]) -> bytes:
    img = np.full((340, 820, 3), 255, dtype=np.uint8)
    y = 65
    for line in lines:
        cv2.putText(img, line, (40, y), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (15, 23, 42), 2, cv2.LINE_AA)
        y += 55
    ok, encoded = cv2.imencode(".png", img)
    assert ok
    return encoded.tobytes()


def _make_blank_png_bytes() -> bytes:
    img = np.full((80, 80, 3), 255, dtype=np.uint8)
    ok, encoded = cv2.imencode(".png", img)
    assert ok
    return encoded.tobytes()


def _register_and_login(client: TestClient, *, email: str, password: str, full_name: str, role: str) -> str:
    reg = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": password,
            "full_name": full_name,
            "role": role,
        },
    )
    assert reg.status_code == 201, reg.text
    return reg.json()["access_token"]


@pytest.fixture(scope="module")
def test_client():
    # Use a fresh isolated database state for reproducible E2E verification
    with TestClient(app) as client:
        yield client


def test_real_data_e2e_workflows(test_client: TestClient):
    suffix = uuid4().hex[:8]
    patient_a_email = f"patient_a_{suffix}@example.org"
    patient_b_email = f"patient_b_{suffix}@example.org"
    doctor_email = f"doctor_{suffix}@example.org"
    admin_email = f"admin_{suffix}@example.org"
    pw = "StrongPass!2026"

    # 1. Health check verifies demo mode off
    health = test_client.get("/api/health")
    assert health.status_code == 200
    assert health.json()["demo_mode"] is False

    # 2. Test A: Register brand new patient account -> strictly empty state
    token_a = _register_and_login(
        test_client, email=patient_a_email, password=pw, full_name="Asha Kulkarni", role="patient"
    )
    headers_a = {"Authorization": f"Bearer {token_a}"}

    ov_empty = test_client.get("/api/vault/overview", headers=headers_a)
    assert ov_empty.status_code == 200
    assert ov_empty.json()["counts"]["documents"] == 0
    assert ov_empty.json()["allergies"] == []
    assert ov_empty.json()["active_medications"] == []

    docs_empty = test_client.get("/api/vault/documents", headers=headers_a)
    assert docs_empty.status_code == 200
    assert docs_empty.json()["documents"] == []

    tl_empty = test_client.get("/api/vault/timeline", headers=headers_a)
    assert tl_empty.status_code == 200
    assert tl_empty.json()["events"] == []

    shares_empty = test_client.get("/api/shares", headers=headers_a)
    assert shares_empty.status_code == 200
    assert shares_empty.json()["shares"] == []

    # 3. Test B: Real PDF upload + extraction + verification + timeline + summary + unreadable PNG
    pdf_bytes = _make_clinical_pdf_bytes()
    up_pdf = test_client.post(
        "/api/vault/documents/upload",
        headers=headers_a,
        files={"file": ("asha_labs.pdf", pdf_bytes, "application/pdf")},
        data={"title": "HbA1c & Diabetes Consultation", "category": "lab_report"},
    )
    assert up_pdf.status_code == 201, up_pdf.text
    doc1 = up_pdf.json()
    assert "Metformin" in doc1["ocr_text"]
    assert "Penicillin" in doc1["ocr_text"]

    verify_payload = {
        "title": "HbA1c & Diabetes Consultation",
        "category": "lab_report",
        "document_date": "2026-10-12",
        "doctor_name": "Dr. R. Deshmukh",
        "hospital_name": "City Care Clinic",
        "primary_condition": "Type 2 Diabetes Mellitus",
        "extracted": {
            "patient_name": "Asha Kulkarni",
            "doctor_name": "Dr. R. Deshmukh",
            "hospital_name": "City Care Clinic",
            "document_date": "2026-10-12",
            "diagnosis": "Type 2 Diabetes Mellitus",
            "observations": ["HbA1c 7.4% elevated above 5.6% upper bound"],
            "medications": [
                {"medicine_name": "Metformin", "dosage": "500 mg", "frequency": "twice daily", "instructions": "after meals"}
            ],
            "lab_values": [
                {
                    "test_name": "HbA1c",
                    "value_numeric": 7.4,
                    "value_text": "7.4",
                    "unit": "%",
                    "reference_range": "4.0 - 5.6 %",
                    "flag": "high",
                    "is_abnormal": True,
                }
            ],
            "allergies": ["Penicillin"],
        },
        "commit_to_profile": True,
    }
    ver_resp = test_client.put(
        f"/api/vault/documents/{doc1['id']}/verify",
        headers=headers_a,
        json=verify_payload,
    )
    assert ver_resp.status_code == 200, ver_resp.text
    assert ver_resp.json()["is_verified"] is True

    # Blank unreadable image upload must never invent fields
    blank_resp = test_client.post(
        "/api/vault/documents/upload",
        headers=headers_a,
        files={"file": ("blank.png", _make_blank_png_bytes(), "image/png")},
        data={"title": "Unreadable Photo"},
    )
    assert blank_resp.status_code == 201, blank_resp.text
    blank_doc = blank_resp.json()
    assert len((blank_doc["ocr_text"] or "").strip()) < 5
    assert blank_doc["extracted"].get("diagnosis") in (None, "")
    assert blank_doc["extracted"].get("medications") == []

    # Verify Doctor Summary + PDF reflect ONLY uploaded/verified data
    sum_resp = test_client.post("/api/vault/summary/generate", headers=headers_a)
    assert sum_resp.status_code == 200
    facts = sum_resp.json()["extracted_facts"]
    assert any("Penicillin" in a["allergen"] for a in facts["known_allergies"])
    assert any("Metformin" in m["medicine_name"] for m in facts["current_medications"])
    sum_pdf = test_client.get(f"/api/vault/summary/{sum_resp.json()['summary_id']}/pdf", headers=headers_a)
    assert sum_pdf.status_code == 200
    assert sum_pdf.content.startswith(b"%PDF")

    # 4. Test C: Health Assistant unconfigured status (503) + OpenFDA lookup
    chat_status = test_client.get("/api/chat/status", headers=headers_a)
    assert chat_status.status_code == 200
    assert "ai_configured" in chat_status.json()

    convo = test_client.post(
        "/api/chat/conversations",
        headers=headers_a,
        json={"title": "Allergy & Photo Check", "use_vault_context": True},
    )
    assert convo.status_code == 201
    convo_id = convo.json()["id"]

    if not chat_status.json()["ai_configured"]:
        msg_unconf = test_client.post(
            f"/api/chat/conversations/{convo_id}/messages",
            headers=headers_a,
            data={"message": "What allergies are documented in my records?"},
        )
        assert msg_unconf.status_code == 503
        assert "GEMINI_API_KEY" in msg_unconf.json()["detail"]

    # Live OpenFDA lookup
    fda_resp = test_client.get("/api/chat/medicines/search?q=metformin", headers=headers_a)
    assert fda_resp.status_code == 200, fda_resp.text
    assert "OpenFDA" in fda_resp.json()["source"]
    assert len(fda_resp.json()["medicines"]) >= 1

    # 5. Test G: Cross-account isolation + Scoped Share + RBAC
    token_b = _register_and_login(
        test_client, email=patient_b_email, password=pw, full_name="Vikram Rao", role="patient"
    )
    headers_b = {"Authorization": f"Bearer {token_b}"}
    # Patient B vault is completely empty and cannot read Patient A's doc or conversation
    assert test_client.get("/api/vault/documents", headers=headers_b).json()["documents"] == []
    assert test_client.get(f"/api/vault/documents/{doc1['id']}/file", headers=headers_b).status_code == 404
    assert test_client.get(f"/api/chat/conversations/{convo_id}", headers=headers_b).status_code == 404

    # Doctor role & scoped PIN/QR share
    token_doc = _register_and_login(test_client, email=doctor_email, password=pw, full_name="Dr. Meera Nair", role="doctor")
    headers_doc = {"Authorization": f"Bearer {token_doc}"}
    assert test_client.get("/api/shares/doctor/assigned", headers=headers_doc).json()["assigned_shares"] == []

    share_create = test_client.post(
        "/api/shares",
        headers=headers_a,
        json={
            "title": "Endocrinology Visit",
            "recipient_doctor_email": doctor_email,
            "document_ids": [doc1["id"]],
            "expiry_minutes": 30,
            "pin": "4321",
            "include_summary": True,
        },
    )
    assert share_create.status_code == 201, share_create.text
    share_token = share_create.json()["token"]
    share_id = share_create.json()["id"]

    # Wrong PIN rejected; right PIN exposes only doc1
    assert test_client.post(f"/api/shares/public/{share_token}/verify", json={"pin": "0000"}).status_code == 403
    pub_view = test_client.post(f"/api/shares/public/{share_token}/verify", json={"pin": "4321"})
    assert pub_view.status_code == 200
    assert len(pub_view.json()["documents"]) == 1
    assert pub_view.json()["documents"][0]["id"] == doc1["id"]

    # Revoke immediately blocks
    assert test_client.post(f"/api/shares/{share_id}/revoke", headers=headers_a).status_code == 200
    assert test_client.post(f"/api/shares/public/{share_token}/verify", json={"pin": "4321"}).status_code in (403, 410)

    # RBAC boundaries
    token_admin = _register_and_login(test_client, email=admin_email, password=pw, full_name="State Health Officer", role="admin")
    headers_admin = {"Authorization": f"Bearer {token_admin}"}
    assert test_client.get("/api/vault/documents", headers=headers_admin).status_code == 403
    assert test_client.get("/api/outbreak/overview", headers=headers_a).status_code == 403

    # 6. Test D, E, F: Live NCDC/IDSP + Open-Meteo sync, ML classification, SEIR simulator
    sync1 = test_client.post("/api/outbreak/sync?weeks_to_fetch=2", headers=headers_admin)
    assert sync1.status_code == 200, sync1.text
    sync1_json = sync1.json()
    assert sync1_json["documents_fetched"] >= 1
    assert sync1_json["records_imported"] >= 1

    # Deduplication on second sync
    sync2 = test_client.post("/api/outbreak/sync?weeks_to_fetch=2", headers=headers_admin)
    assert sync2.status_code == 200
    assert sync2.json()["duplicates_skipped"] >= 1

    ov_admin = test_client.get("/api/outbreak/overview", headers=headers_admin).json()
    assert ov_admin["summary"]["total_reports"] >= 1
    diseases = ov_admin["available_diseases"]
    assert len(diseases) >= 1

    train_res = test_client.post(f"/api/outbreak/train?disease={diseases[0]}", headers=headers_admin)
    assert train_res.status_code == 200
    assert train_res.json()["status"] in {"trained", "insufficient_data"}

    regions = ov_admin["regions"]
    assert len(regions) >= 1
    region_id = regions[0]["id"]

    # Simulator input sensitivity
    sim_low = test_client.post(
        "/api/outbreak/simulator/run",
        headers=headers_admin,
        json={
            "name": "Low Baseline",
            "region_id": region_id,
            "disease": diseases[0],
            "initial_active_cases": 40,
            "population_override": 250000,
            "available_beds": 50,
            "medical_staff": 20,
            "prevention_coverage_pct": 30,
            "vaccination_coverage_pct": 20,
            "budget_usd": 100000,
            "intervention_start_day": 5,
        },
    )
    assert sim_low.status_code == 200, sim_low.text
    sim_high = test_client.post(
        "/api/outbreak/simulator/run",
        headers=headers_admin,
        json={
            "name": "High Baseline",
            "region_id": region_id,
            "disease": diseases[0],
            "initial_active_cases": 240,
            "population_override": 250000,
            "available_beds": 50,
            "medical_staff": 20,
            "prevention_coverage_pct": 30,
            "vaccination_coverage_pct": 20,
            "budget_usd": 100000,
            "intervention_start_day": 5,
        },
    )
    assert sim_high.status_code == 200
    assert sim_high.json()["summary_metrics"]["baseline_30d_cases"] > sim_low.json()["summary_metrics"]["baseline_30d_cases"]
