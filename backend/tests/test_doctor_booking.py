from concurrent.futures import ThreadPoolExecutor
import io
from datetime import timedelta
from types import SimpleNamespace
from uuid import uuid4

import pytest
from fastapi.testclient import TestClient
from reportlab.pdfgen import canvas

from backend.database import Base, engine
from backend.main import app
from backend.services import assistant_service
from backend.services.doctor_booking_service import today_ist


def _make_pdf_bytes() -> bytes:
    buf = io.BytesIO()
    c = canvas.Canvas(buf)
    c.drawString(60, 750, "City Lab - Lipid & Neurology Workup")
    c.drawString(60, 730, "Allergies: Sulfa drugs (hives)")
    c.drawString(60, 710, "Medications: Sumatriptan 50 mg as needed")
    c.showPage()
    c.save()
    return buf.getvalue()


@pytest.fixture(scope="module")
def booking_client():
    Base.metadata.create_all(bind=engine)
    with TestClient(app) as client:
        yield client


def _register_and_login(client: TestClient, *, role: str) -> tuple[str, str, int]:
    suffix = uuid4().hex[:8]
    email = f"{role}_{suffix}@example.org"
    r = client.post(
        "/api/auth/register",
        json={
            "email": email,
            "password": "StrongPass!2026",
            "full_name": f"Test {role.title()} {suffix}",
            "role": role,
        },
    )
    assert r.status_code == 201, r.text
    body = r.json()
    return body["access_token"], email, body["user"]["id"]


def test_doctor_discovery_verification_scheduling_concurrency_and_vault_isolation(
    booking_client: TestClient, monkeypatch
):
    # Ensure controlled specialities exist cleanly
    specs_resp = booking_client.get("/api/specialities")
    assert specs_resp.status_code == 200
    specs = specs_resp.json()["specialities"]
    assert len(specs) >= 14
    neuro_spec = next(s for s in specs if "neurolog" in s["name"].lower())
    cardio_spec = next(s for s in specs if "cardiolog" in s["name"].lower())

    # Register isolated test accounts
    tok_p1, _, _ = _register_and_login(booking_client, role="patient")
    tok_p2, _, _ = _register_and_login(booking_client, role="patient")
    tok_doc1, doc1_email, _ = _register_and_login(booking_client, role="doctor")
    tok_doc2, _, _ = _register_and_login(booking_client, role="doctor")
    tok_admin, _, _ = _register_and_login(booking_client, role="admin")

    h_p1 = {"Authorization": f"Bearer {tok_p1}"}
    h_p2 = {"Authorization": f"Bearer {tok_p2}"}
    h_d1 = {"Authorization": f"Bearer {tok_doc1}"}
    h_d2 = {"Authorization": f"Bearer {tok_doc2}"}
    h_adm = {"Authorization": f"Bearer {tok_admin}"}

    # 1. Patient starts with zero appointments and sees unverified doctors excluded
    my_appts_init = booking_client.get("/api/appointments/my", headers=h_p1)
    assert my_appts_init.status_code == 200
    assert my_appts_init.json()["upcoming"] == []

    # Doctor 1 completes profile + clinic -> defaults to pending_verification
    reg_no = f"NMC-{uuid4().hex[:6].upper()}"
    prof_up = booking_client.put(
        "/api/doctors/me/profile",
        headers=h_d1,
        json={
            "full_name": "Dr. Kavita Iyer",
            "qualifications": "MBBS, DM (Neurology)",
            "registration_number": reg_no,
            "primary_speciality_id": neuro_spec["id"],
            "secondary_speciality_ids": [cardio_spec["id"]],
            "experience_years": 11,
            "consultation_fee": 900,
            "consultation_modes": ["in_person", "online"],
            "languages": ["English", "Hindi", "Marathi"],
            "biography": "Neurology & migraine specialist.",
            "contact_phone": "+91-9800011223",
            "auto_confirm": True,
            "clinic": {
                "name": "Sahyadri Neuro Care",
                "address": "14 FC Road",
                "city": "Pune",
                "state": "Maharashtra",
                "postal_code": "411004",
                "contact_information": "020-2550011",
                "latitude": 18.5204,
                "longitude": 73.8567,
            },
        },
    )
    assert prof_up.status_code == 200, prof_up.text
    doc1 = prof_up.json()["profile"]
    doc1_id = doc1["id"]
    assert doc1["verification_status"] == "pending_verification"

    # Non-admin cannot verify doctors (RBAC)
    assert (
        booking_client.post(
            f"/api/admin/doctors/{doc1_id}/verify",
            headers=h_p1,
            json={"status": "verified"},
        ).status_code
        == 403
    )

    # Pending doctor does NOT appear in patient discovery
    disc_before = booking_client.get(f"/api/doctors?speciality_id={neuro_spec['id']}")
    assert disc_before.status_code == 200
    assert all(d["id"] != doc1_id for d in disc_before.json()["doctors"])

    # Admin verifies Doctor 1
    ver_resp = booking_client.post(
        f"/api/admin/doctors/{doc1_id}/verify",
        headers=h_adm,
        json={"status": "verified", "notes": "NMC registration verified", "allow_secondary_specialities": True},
    )
    assert ver_resp.status_code == 200
    assert ver_resp.json()["doctor"]["verification_status"] == "verified"

    # Admin notifications check on Doctor 1 account
    doc_notifs = booking_client.get("/api/notifications", headers=h_d1)
    assert doc_notifs.status_code == 200
    assert doc_notifs.json()["unread_count"] >= 1

    # 2. Doctor 1 configures weekly availability in Asia/Kolkata + breaks + blocked exception + holiday
    target_date = today_ist() + timedelta(days=3)
    holiday_date = today_ist() + timedelta(days=10)
    target_weekday = target_date.weekday()

    sched_put = booking_client.put(
        "/api/doctors/me/schedule",
        headers=h_d1,
        json={
            "windows": [
                {
                    "weekday": target_weekday,
                    "start_time": "09:00",
                    "end_time": "12:00",
                    "slot_duration": 30,
                    "break_periods": [{"start": "10:30", "end": "11:00"}],
                    "buffer_duration": 0,
                    "consultation_modes": ["in_person", "online"],
                    "active_status": True,
                }
            ]
        },
    )
    assert sched_put.status_code == 200, sched_put.text

    # Block 10:00-10:30 on target_date and mark holiday_date as holiday
    exc_block = booking_client.post(
        "/api/doctors/me/exceptions",
        headers=h_d1,
        json={
            "date": target_date.isoformat(),
            "start_time": "10:00",
            "end_time": "10:30",
            "exception_type": "blocked",
            "reason": "Hospital rounds",
        },
    )
    assert exc_block.status_code == 201

    exc_holiday = booking_client.post(
        "/api/doctors/me/exceptions",
        headers=h_d1,
        json={
            "date": holiday_date.isoformat(),
            "exception_type": "holiday",
            "reason": "Annual conference",
        },
    )
    assert exc_holiday.status_code == 201

    # Check live slots on target_date & holiday_date
    avail_target = booking_client.get(f"/api/doctors/{doc1_id}/availability?date={target_date.isoformat()}")
    assert avail_target.status_code == 200
    slots_map = {s["start_time"]: s for s in avail_target.json()["slots"]}
    assert slots_map["09:00"]["is_available"] is True
    assert slots_map["09:30"]["is_available"] is True
    assert slots_map["10:00"]["is_available"] is False  # blocked
    assert "10:30" not in slots_map  # break skipped
    assert slots_map["11:00"]["is_available"] is True
    assert slots_map["11:30"]["is_available"] is True

    avail_holiday = booking_client.get(f"/api/doctors/{doc1_id}/availability?date={holiday_date.isoformat()}")
    assert avail_holiday.status_code == 200
    assert avail_holiday.json()["day_status"] == "holiday"
    assert avail_holiday.json()["slots"] == []

    # 3. Search filters & voluntary geolocation distance discovery
    search_match = booking_client.get(
        f"/api/doctors?speciality_id={neuro_spec['id']}&city=Pune&pin_code=411004&max_fee=1000&min_experience=10"
        f"&consultation_mode=online&language=Marathi&available_date={target_date.isoformat()}&time_of_day=morning"
        f"&lat=18.525&lng=73.860&max_distance_km=10"
    )
    assert search_match.status_code == 200
    found_docs = search_match.json()["doctors"]
    assert any(d["id"] == doc1_id for d in found_docs)
    matched_doc = next(d for d in found_docs if d["id"] == doc1_id)
    assert matched_doc["distance_km"] is not None and matched_doc["distance_km"] < 10

    # Non-matching fee filter excludes doctor cleanly
    search_miss = booking_client.get(f"/api/doctors?speciality_id={neuro_spec['id']}&max_fee=200")
    assert all(d["id"] != doc1_id for d in search_miss.json()["doctors"])

    # 4. AI Speciality Matching + Emergency Red-Flag Enforcement
    emerg_resp = booking_client.post(
        "/api/doctors/speciality-match",
        headers=h_p1,
        json={"concern": "I have crushing chest pain and shortness of breath", "use_vault_context": False},
    )
    assert emerg_resp.status_code == 200
    assert emerg_resp.json()["is_emergency"] is True
    assert emerg_resp.json()["recommended_speciality"] is None

    # Mock Gemini SDK response deterministically for AI speciality matching
    class _FakeSpecialityModels:
        def generate_content(self, *, model, contents, config):
            return SimpleNamespace(
                text='{"is_urgent_warning": false, "recommended_speciality": "Neurologist", "alternative_specialities": ["ENT Specialist"], "reasoning": "Recurring headaches and dizziness are commonly evaluated by a Neurologist or ENT clinician.", "clarifying_questions": ["How long do the dizzy spells last?"], "uncertainty_note": "Multiple systems can cause dizziness; clinical examination is needed."}'
            )

    class _FakeClient:
        def __init__(self, **_kwargs):
            self.models = _FakeSpecialityModels()

    monkeypatch.setattr(assistant_service, "get_active_gemini_key", lambda: "test-fake-key-123")
    monkeypatch.setattr(assistant_service.genai, "Client", _FakeClient)
    assistant_service._GEMINI_CLIENT_CACHE.clear()

    ai_match = booking_client.post(
        "/api/doctors/speciality-match",
        headers=h_p1,
        json={"concern": "Frequent headaches and mild dizziness for two weeks", "use_vault_context": False},
    )
    assert ai_match.status_code == 200, ai_match.text
    assert ai_match.json()["is_emergency"] is False
    assert ai_match.json()["recommended_speciality"]["name"] == "Neurologist"
    assert "not a medical diagnosis" in ai_match.json()["disclaimer"].lower()

    # 5. CONCURRENT DOUBLE-BOOKING TEST (Two simultaneous requests for the EXACT same slot)
    payload_slot = {
        "doctor_id": doc1_id,
        "appointment_date": target_date.isoformat(),
        "start_time": "09:00",
        "consultation_type": "online",
        "patient_notes": "Concurrent booking test",
    }

    def _attempt_book(headers: dict) -> int:
        r = booking_client.post("/api/appointments", headers=headers, json=payload_slot)
        return r.status_code

    with ThreadPoolExecutor(max_workers=2) as pool:
        f1 = pool.submit(_attempt_book, h_p1)
        f2 = pool.submit(_attempt_book, h_p2)
        statuses = sorted([f1.result(), f2.result()])

    # STRICT ASSERTION: Exactly ONE succeeds (201) and ONE is rejected (409 Conflict)
    assert statuses == [201, 409], f"Expected [201, 409], got {statuses}"

    # Determine which patient won the 09:00 booking
    p1_appts = booking_client.get("/api/appointments/my", headers=h_p1).json()["upcoming"]
    p2_appts = booking_client.get("/api/appointments/my", headers=h_p2).json()["upcoming"]
    winner_headers = h_p1 if len(p1_appts) == 1 else h_p2
    winner_appt = p1_appts[0] if len(p1_appts) == 1 else p2_appts[0]
    loser_headers = h_p2 if winner_headers is h_p1 else h_p1

    # Booking unavailable blocked slot 10:00 must fail (409)
    blocked_book = booking_client.post(
        "/api/appointments",
        headers=loser_headers,
        json={
            "doctor_id": doc1_id,
            "appointment_date": target_date.isoformat(),
            "start_time": "10:00",
            "consultation_type": "in_person",
        },
    )
    assert blocked_book.status_code == 409

    # 6. Medical Vault Isolation + Explicit Optional Record Sharing after Booking
    # Upload a PDF into winner patient's vault
    up_doc = booking_client.post(
        "/api/vault/documents/upload",
        headers=winner_headers,
        files={"file": ("neuro_workup.pdf", _make_pdf_bytes(), "application/pdf")},
        data={"title": "Headache Workup", "category": "lab_report"},
    )
    assert up_doc.status_code == 201
    vault_doc_id = up_doc.json()["id"]

    # Booking alone MUST NOT expose vault documents to Doctor 1
    doc_shares_before = booking_client.get("/api/shares/doctor/assigned", headers=h_d1).json()["assigned_shares"]
    assert len(doc_shares_before) == 0

    # Patient explicitly opts to share selected record with Doctor 1 for this appointment
    share_resp = booking_client.post(
        f"/api/appointments/{winner_appt['id']}/share-records",
        headers=winner_headers,
        json={"document_ids": [vault_doc_id], "include_summary": False, "expiry_minutes": 120},
    )
    assert share_resp.status_code == 201, share_resp.text
    doc_shares_after = booking_client.get("/api/shares/doctor/assigned", headers=h_d1).json()["assigned_shares"]
    assert len(doc_shares_after) == 1
    assert doc1_email  # confirms recipient match

    # Patient B cannot cancel/reschedule Patient A's booking (403)
    assert (
        booking_client.post(
            f"/api/appointments/{winner_appt['id']}/cancel",
            headers=loser_headers,
            json={"reason": "Unauthorized"},
        ).status_code
        == 403
    )

    # 7. Reschedule from 09:00 -> 09:30 frees 09:00 cleanly so Patient B can book 09:00
    resched = booking_client.post(
        f"/api/appointments/{winner_appt['id']}/reschedule",
        headers=winner_headers,
        json={"appointment_date": target_date.isoformat(), "start_time": "09:30", "reason": "Prefer 9:30"},
    )
    assert resched.status_code == 200, resched.text
    new_appt_id = resched.json()["appointment"]["id"]

    rebook_freed = booking_client.post("/api/appointments", headers=loser_headers, json=payload_slot)
    assert rebook_freed.status_code == 201, rebook_freed.text

    # Complete & Cancel checks
    comp = booking_client.post(
        f"/api/appointments/{new_appt_id}/complete",
        headers=h_d1,
        json={"doctor_notes": "Follow-up in 4 weeks"},
    )
    assert comp.status_code == 200
    assert comp.json()["appointment"]["appointment_status"] == "completed"

    canc = booking_client.post(
        f"/api/appointments/{rebook_freed.json()['appointment']['id']}/cancel",
        headers=loser_headers,
        json={"reason": "Plan changed"},
    )
    assert canc.status_code == 200
    assert canc.json()["appointment"]["appointment_status"] == "cancelled"

    # 8. Pending manual-approval Doctor 2 flow (confirm/reject)
    prof2 = booking_client.put(
        "/api/doctors/me/profile",
        headers=h_d2,
        json={
            "full_name": "Dr. Rohan Kulkarni",
            "qualifications": "MBBS, MD (Cardiology)",
            "registration_number": f"NMC-{uuid4().hex[:6].upper()}",
            "primary_speciality_id": cardio_spec["id"],
            "experience_years": 6,
            "consultation_fee": 700,
            "consultation_modes": ["online"],
            "languages": ["English"],
            "auto_confirm": False,
        },
    )
    assert prof2.status_code == 200
    doc2_id = prof2.json()["profile"]["id"]
    assert booking_client.post(f"/api/admin/doctors/{doc2_id}/verify", headers=h_adm, json={"status": "verified"}).status_code == 200
    assert (
        booking_client.put(
            "/api/doctors/me/schedule",
            headers=h_d2,
            json={
                "windows": [
                    {
                        "weekday": target_date.weekday(),
                        "start_time": "14:00",
                        "end_time": "15:00",
                        "slot_duration": 30,
                        "consultation_modes": ["online"],
                    }
                ]
            },
        ).status_code
        == 200
    )

    pend_book = booking_client.post(
        "/api/appointments",
        headers=h_p1,
        json={
            "doctor_id": doc2_id,
            "appointment_date": target_date.isoformat(),
            "start_time": "14:00",
            "consultation_type": "online",
        },
    )
    assert pend_book.status_code == 201
    assert pend_book.json()["appointment"]["appointment_status"] == "pending"

    dec = booking_client.post(
        f"/api/appointments/{pend_book.json()['appointment']['id']}/decision",
        headers=h_d2,
        json={"decision": "confirm", "doctor_notes": "Link ready"},
    )
    assert dec.status_code == 200
    assert dec.json()["appointment"]["appointment_status"] == "confirmed"

    # Admin platform appointment monitoring + notifications mark-all-read
    adm_appts = booking_client.get("/api/admin/appointments", headers=h_adm)
    assert adm_appts.status_code == 200
    assert len(adm_appts.json()["appointments"]) >= 3

    read_all = booking_client.post("/api/notifications/read-all", headers=h_p1)
    assert read_all.status_code == 200
