import asyncio
import io
from types import SimpleNamespace
from uuid import uuid4

import cv2
import numpy as np
import pytest
from fastapi.testclient import TestClient
from google.genai import errors as genai_errors
from reportlab.pdfgen import canvas

from backend.main import app
from backend.routers import chat_router
from backend.services import assistant_service


def _make_pdf_bytes(lines: list[str]) -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    y = 760
    for line in lines:
        c.drawString(60, y, line)
        y -= 20
    c.showPage()
    c.save()
    return buf.getvalue()


def _make_png_bytes(lines: list[str]) -> bytes:
    img = np.full((260, 760, 3), 255, dtype=np.uint8)
    y = 75
    for line in lines:
        cv2.putText(img, line, (40, y), cv2.FONT_HERSHEY_SIMPLEX, 0.9, (15, 23, 42), 2, cv2.LINE_AA)
        y += 60
    ok, enc = cv2.imencode(".png", img)
    assert ok
    return enc.tobytes()


def _register_and_login(client: TestClient, *, role: str = "patient") -> tuple[str, str]:
    suffix = uuid4().hex[:8]
    email = f"{role}_{suffix}@example.org"
    resp = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "StrongPass!2026",
            "full_name": f"{role.title()} {suffix}",
            "role": role,
        },
    )
    assert resp.status_code == 201, resp.text
    return resp.json()["access_token"], email


@pytest.fixture(autouse=True)
def _reset_rate_limit():
    chat_router._USER_REQUEST_TIMESTAMPS.clear()
    yield
    chat_router._USER_REQUEST_TIMESTAMPS.clear()


def test_gemini_chatbot_comprehensive_suite(monkeypatch):
    with TestClient(app) as client:
        token_a, _ = _register_and_login(client, role="patient")
        token_b, _ = _register_and_login(client, role="patient")
        token_doc, _ = _register_and_login(client, role="doctor")
        headers_a = {"Authorization": f"Bearer {token_a}"}
        headers_b = {"Authorization": f"Bearer {token_b}"}
        headers_doc = {"Authorization": f"Bearer {token_doc}"}

        # Seed Patient A's own real uploaded & verified document (allergy + lab + med)
        pdf_bytes = _make_pdf_bytes([
            "Patient Name: Patient A",
            "Date: 2026-10-10",
            "Diagnosis: Prediabetes",
            "Allergies: Sulfa drugs (hives)",
            "Medications: Metformin 500 mg once daily",
            "HbA1c: 6.8 % (Reference Range: 4.0 - 5.6 %)",
        ])
        up = client.post(
            "/api/vault/documents/upload",
            headers=headers_a,
            files={"file": ("patient_a_lab.pdf", pdf_bytes, "application/pdf")},
            data={"title": "A1c Follow-up Report", "category": "lab_report"},
        )
        assert up.status_code == 201
        doc_a_id = up.json()["id"]
        ver = client.put(
            f"/api/vault/documents/{doc_a_id}/verify",
            headers=headers_a,
            json={
                "title": "A1c Follow-up Report",
                "category": "lab_report",
                "document_date": "2026-10-10",
                "primary_condition": "Prediabetes",
                "extracted": {
                    "diagnosis": "Prediabetes",
                    "allergies": ["Sulfa drugs"],
                    "medications": [{"medicine_name": "Metformin", "dosage": "500 mg", "frequency": "once daily"}],
                    "lab_values": [
                        {
                            "test_name": "HbA1c",
                            "value_numeric": 6.8,
                            "value_text": "6.8",
                            "unit": "%",
                            "reference_range": "4.0 - 5.6 %",
                            "flag": "high",
                            "is_abnormal": True,
                        }
                    ],
                },
                "commit_to_profile": True,
            },
        )
        assert ver.status_code == 200

        # Test 17: Missing API key returns explicit 503 error & never exposes secret/fake AI prose
        monkeypatch.delenv("GEMINI_API_KEY", raising=False)
        monkeypatch.setattr(assistant_service.settings, "GEMINI_API_KEY", "")
        assert client.get("/api/chat/status", headers=headers_a).json()["ai_configured"] is False
        convo = client.post("/api/chat/conversations", headers=headers_a, json={"title": "Gemini Test", "use_vault_context": True}).json()
        convo_id = convo["id"]

        res_no_key = client.post(
            f"/api/chat/conversations/{convo_id}/messages",
            headers=headers_a,
            data={"message": "Explain my HbA1c"},
        )
        assert res_no_key.status_code == 503
        assert "GEMINI_API_KEY" in res_no_key.json()["detail"]

        # Emergency red flag STILL returns urgent safety guidance immediately
        res_emerg = client.post(
            f"/api/chat/conversations/{convo_id}/messages",
            headers=headers_a,
            data={"message": "I have crushing chest pain and shortness of breath"},
        )
        assert res_emerg.status_code == 200
        assert res_emerg.json()["assistant_message"]["is_emergency"] is True

        # Configure fake test key cleanly via env (never returned in HTTP responses!)
        test_secret = "AIzaTestFakeSecretKey99999"
        monkeypatch.setenv("GEMINI_API_KEY", test_secret)

        # Verify API key is never leaked in /api/health or /api/chat/status
        assert test_secret not in client.get("/api/health").text
        status_json = client.get("/api/chat/status", headers=headers_a).json()
        assert status_json["ai_configured"] is True
        assert test_secret not in str(status_json)

        # Capture outgoing SDK arguments to inspect system instruction, scoped context, history, and multimodal parts
        recorded_calls: list[dict] = []

        class _FakeModels:
            def __init__(self, mode: str = "ok"):
                self.mode = mode

            def generate_content(self, *, model, contents, config):
                recorded_calls.append({"model": model, "contents": contents, "config": config})
                if self.mode == "rate_limit":
                    raise genai_errors.APIError(429, {"error": {"message": "Quota exhausted"}})
                if self.mode == "server_error":
                    raise genai_errors.APIError(500, {"error": {"message": f"Backend error with key={test_secret}"}})
                if self.mode == "malformed":
                    return SimpleNamespace(text="", candidates=[SimpleNamespace(finish_reason="SAFETY")])
                if self.mode == "slow":
                    import time
                    time.sleep(1.2)
                    return SimpleNamespace(text="Too late", candidates=[])
                last_text = ""
                for p in contents[-1].parts:
                    if getattr(p, "text", None):
                        last_text += p.text
                return SimpleNamespace(
                    text=f"### Plain-Language Explanation\n- Discussed query cleanly.\n- Turns seen: {len(contents)}.\n- Context snippet length: {len(last_text)}."
                )

        class _FakeClient:
            mode = "ok"

            def __init__(self, api_key=None, **_kwargs):
                assert api_key == test_secret
                self.models = _FakeModels(self.mode)

        monkeypatch.setattr(assistant_service.genai, "Client", _FakeClient)

        # Test 1, 7: Normal text + targeted allergy medical context (does NOT dump labs when only allergy asked)
        r1 = client.post(
            f"/api/chat/conversations/{convo_id}/messages",
            headers=headers_a,
            data={"message": "What allergies do I have?"},
        )
        assert r1.status_code == 200, r1.text
        d1 = r1.json()
        assert d1["context_used"] is True
        assert "allergies" in d1["context_categories"]
        assert "lab_results" not in d1["context_categories"]
        assert "NOT a licensed physician" in recorded_calls[-1]["config"].system_instruction
        last_prompt_sent = recorded_calls[-1]["contents"][-1].parts[0].text
        assert "Sulfa drugs" in last_prompt_sent

        # Test 2, 3, 5: Follow-up question persists and passes prior conversation turns to Gemini
        r2 = client.post(
            f"/api/chat/conversations/{convo_id}/messages",
            headers=headers_a,
            data={"message": "What about my HbA1c test?"},
        )
        assert r2.status_code == 200
        assert len(recorded_calls[-1]["contents"]) >= 3
        assert "lab_results" in r2.json()["context_categories"]
        assert "6.8" in recorded_calls[-1]["contents"][-1].parts[0].text

        persisted = client.get(f"/api/chat/conversations/{convo_id}", headers=headers_a).json()
        assert len(persisted["messages"]) == 6  # emergency (u+a) + r1 (u+a) + r2 (u+a)

        # Test 8: Disable medical context -> zero vault data sent to Gemini
        patch_res = client.patch(
            f"/api/chat/conversations/{convo_id}",
            headers=headers_a,
            json={"use_vault_context": False},
        )
        assert patch_res.status_code == 200
        r3 = client.post(
            f"/api/chat/conversations/{convo_id}/messages",
            headers=headers_a,
            data={"message": "What allergies do I have?"},
        )
        assert r3.status_code == 200
        assert r3.json()["context_used"] is False
        assert "Sulfa drugs" not in recorded_calls[-1]["contents"][-1].parts[0].text

        # Test 9 & 10: Attached vault document + Direct Image & PDF attachment sent properly
        img_png = _make_png_bytes(["RX: METFORMIN 500 MG"])
        r4 = client.post(
            f"/api/chat/conversations/{convo_id}/messages",
            headers=headers_a,
            data={"message": "Check this medicine image and my attached report", "attached_document_id": str(doc_a_id)},
            files={"image": ("med.png", img_png, "image/png")},
        )
        assert r4.status_code == 200
        parts_sent = recorded_calls[-1]["contents"][-1].parts
        assert any(getattr(p, "inline_data", None) is not None for p in parts_sent)
        assert "A1c Follow-up Report" in parts_sent[0].text

        pdf_att = _make_pdf_bytes(["Prescription: Atorvastatin 10 mg at bedtime"])
        r5 = client.post(
            f"/api/chat/conversations/{convo_id}/messages",
            headers=headers_a,
            data={"message": "Explain this attached PDF prescription"},
            files={"image": ("rx.pdf", pdf_att, "application/pdf")},
        )
        assert r5.status_code == 200
        assert "Atorvastatin" in recorded_calls[-1]["contents"][-1].parts[0].text

        # Test 11: Invalid file upload rejected cleanly
        r_bad_file = client.post(
            f"/api/chat/conversations/{convo_id}/messages",
            headers=headers_a,
            data={"message": "Read this"},
            files={"image": ("malware.exe", b"MZ1234", "application/octet-stream")},
        )
        assert r_bad_file.status_code == 400

        # Test 14: Empty message rejected cleanly
        r_empty = client.post(
            f"/api/chat/conversations/{convo_id}/messages",
            headers=headers_a,
            data={"message": "    "},
        )
        assert r_empty.status_code == 400

        # Test 12: API failures (HTTP 500, malformed response, timeout) never fall back to fake text and redact keys
        _FakeClient.mode = "server_error"
        r_err = client.post(
            f"/api/chat/conversations/{convo_id}/messages",
            headers=headers_a,
            data={"message": "Trigger API failure"},
        )
        assert r_err.status_code == 503
        assert test_secret not in r_err.text

        _FakeClient.mode = "malformed"
        r_mal = client.post(
            f"/api/chat/conversations/{convo_id}/messages",
            headers=headers_a,
            data={"message": "Trigger malformed response"},
        )
        assert r_mal.status_code == 502

        monkeypatch.setattr(assistant_service.settings, "GEMINI_TIMEOUT_SECONDS", 0.2)
        _FakeClient.mode = "slow"
        r_timeout = client.post(
            f"/api/chat/conversations/{convo_id}/messages",
            headers=headers_a,
            data={"message": "Trigger timeout"},
        )
        assert r_timeout.status_code == 504
        monkeypatch.setattr(assistant_service.settings, "GEMINI_TIMEOUT_SECONDS", 30.0)

        # Test 13: Gemini upstream 429 rate limit + per-user sliding window limiter
        _FakeClient.mode = "rate_limit"
        r_429_api = client.post(
            f"/api/chat/conversations/{convo_id}/messages",
            headers=headers_a,
            data={"message": "Trigger upstream rate limit"},
        )
        assert r_429_api.status_code == 429

        _FakeClient.mode = "ok"
        monkeypatch.setattr(chat_router, "CHAT_RATE_LIMIT_MAX", 2)
        chat_router._USER_REQUEST_TIMESTAMPS.clear()
        assert client.post(f"/api/chat/conversations/{convo_id}/messages", headers=headers_a, data={"message": "m1"}).status_code == 200
        assert client.post(f"/api/chat/conversations/{convo_id}/messages", headers=headers_a, data={"message": "m2"}).status_code == 200
        assert client.post(f"/api/chat/conversations/{convo_id}/messages", headers=headers_a, data={"message": "m3"}).status_code == 429
        chat_router._USER_REQUEST_TIMESTAMPS.clear()

        # Test 15 & 16: Unauthorized & Cross-user isolation
        assert client.get("/api/chat/conversations").status_code == 401
        assert client.get("/api/chat/conversations", headers=headers_doc).status_code == 403
        assert client.get(f"/api/chat/conversations/{convo_id}", headers=headers_b).status_code == 404
        assert client.delete(f"/api/chat/conversations/{convo_id}", headers=headers_b).status_code == 404
        assert client.post(
            f"/api/chat/conversations/{convo_id}/messages",
            headers=headers_b,
            data={"message": "Try hijack"},
        ).status_code == 404

        # Patient B's own conversation must NEVER receive Patient A's Sulfa allergy or HbA1c
        convo_b_id = client.post("/api/chat/conversations", headers=headers_b, json={"title": "B Chat", "use_vault_context": True}).json()["id"]
        r_b = client.post(
            f"/api/chat/conversations/{convo_b_id}/messages",
            headers=headers_b,
            data={"message": "What are my allergies and HbA1c?"},
        )
        assert r_b.status_code == 200
        b_prompt = recorded_calls[-1]["contents"][-1].parts[0].text
        assert "Sulfa" not in b_prompt
        assert "6.8" not in b_prompt

        # Test 6: Conversation deletion
        del_res = client.delete(f"/api/chat/conversations/{convo_id}", headers=headers_a)
        assert del_res.status_code == 200
        assert client.get(f"/api/chat/conversations/{convo_id}", headers=headers_a).status_code == 404
