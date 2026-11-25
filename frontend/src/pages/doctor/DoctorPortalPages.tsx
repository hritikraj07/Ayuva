import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Building2,
  Calendar,
  Camera,
  CheckCircle2,
  Clock,
  Plus,
  ShieldAlert,
  ShieldCheck,
  Stethoscope,
  Trash2,
  UserCheck,
  XCircle,
} from "lucide-react";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  FieldLabel,
  Input,
  LoadingState,
  Select,
  Textarea,
} from "@/components/ui/primitives";
import { apiFetch } from "@/lib/api";

const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

export function DoctorPortalPages({
  section,
}: {
  section: "overview" | "profile" | "availability" | "appointments" | "clinic";
}) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const [profile, setProfile] = useState<any>(null);
  const [hasProfile, setHasProfile] = useState(false);
  const [specialities, setSpecialities] = useState<any[]>([]);
  const [windows, setWindows] = useState<any[]>([]);
  const [exceptions, setExceptions] = useState<any[]>([]);
  const [calendarData, setCalendarData] = useState<any>(null);
  const [appointments, setAppointments] = useState<any[]>([]);

  // Profile & Clinic Form state
  const [fullName, setFullName] = useState("");
  const [qualifications, setQualifications] = useState("");
  const [regNumber, setRegNumber] = useState("");
  const [primarySpecId, setPrimarySpecId] = useState<string>("");
  const [secondarySpecIds, setSecondarySpecIds] = useState<number[]>([]);
  const [experienceYears, setExperienceYears] = useState<number>(0);
  const [fee, setFee] = useState<number>(500);
  const [modes, setModes] = useState<string[]>(["in_person", "online"]);
  const [languages, setLanguages] = useState("English");
  const [biography, setBiography] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [autoConfirm, setAutoConfirm] = useState(true);

  const [clinicName, setClinicName] = useState("");
  const [clinicAddress, setClinicAddress] = useState("");
  const [clinicCity, setClinicCity] = useState("");
  const [clinicState, setClinicState] = useState("");
  const [clinicPostal, setClinicPostal] = useState("");
  const [clinicContact, setClinicContact] = useState("");
  const [clinicLat, setClinicLat] = useState("");
  const [clinicLng, setClinicLng] = useState("");
  const [saving, setSaving] = useState(false);

  // Exception form
  const [excDate, setExcDate] = useState(new Date().toISOString().slice(0, 10));
  const [excType, setExcType] = useState("blocked");
  const [excStart, setExcStart] = useState("");
  const [excEnd, setExcEnd] = useState("");
  const [excReason, setExcReason] = useState("");
  const [excSlotDur, setExcSlotDur] = useState<number>(20);

  // Appointment notes
  const [doctorNotesMap, setDoctorNotesMap] = useState<Record<number, string>>({});

  const loadAll = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [specsRes, profRes, schedRes, calRes, apptRes] = await Promise.all([
        apiFetch("/specialities"),
        apiFetch("/doctors/me/profile"),
        apiFetch("/doctors/me/schedule"),
        apiFetch("/doctors/me/calendar?days=7"),
        apiFetch("/appointments/doctor"),
      ]);
      const specs = specsRes.specialities || [];
      setSpecialities(specs);
      setHasProfile(Boolean(profRes.has_profile));
      const p = profRes.profile;
      setProfile(p);
      if (p) {
        setFullName(p.full_name || "");
        setQualifications(p.qualifications || "");
        setRegNumber(p.registration_number_masked && !p.registration_number ? "" : p.registration_number || "");
        setPrimarySpecId(String(p.primary_speciality?.id || specs[0]?.id || ""));
        setSecondarySpecIds((p.secondary_specialities || []).map((s: any) => s.id));
        setExperienceYears(p.experience_years || 0);
        setFee(p.consultation_fee || 0);
        setModes(p.consultation_modes || ["in_person"]);
        setLanguages((p.languages || ["English"]).join(", "));
        setBiography(p.biography || "");
        setContactPhone(p.contact_phone || "");
        setAutoConfirm(p.auto_confirm ?? true);
        if (p.clinic) {
          setClinicName(p.clinic.name || "");
          setClinicAddress(p.clinic.address || "");
          setClinicCity(p.clinic.city || "");
          setClinicState(p.clinic.state || "");
          setClinicPostal(p.clinic.postal_code || "");
          setClinicContact(p.clinic.contact_information || "");
          setClinicLat(p.clinic.latitude !== null && p.clinic.latitude !== undefined ? String(p.clinic.latitude) : "");
          setClinicLng(p.clinic.longitude !== null && p.clinic.longitude !== undefined ? String(p.clinic.longitude) : "");
        }
      } else if (specs.length > 0 && !primarySpecId) {
        setPrimarySpecId(String(specs[0].id));
      }
      setWindows(schedRes.windows || []);
      setExceptions(schedRes.exceptions || []);
      setCalendarData(calRes);
      setAppointments(apptRes.appointments || []);
    } catch (err: any) {
      setError(err?.message || "Failed to load doctor portal.");
    } finally {
      setLoading(false);
    }
  }, [primarySpecId]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleSaveProfileAndClinic = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      const payload: any = {
        full_name: fullName.trim(),
        qualifications: qualifications.trim(),
        registration_number: regNumber.trim(),
        primary_speciality_id: Number(primarySpecId),
        secondary_speciality_ids: secondarySpecIds,
        experience_years: Number(experienceYears),
        consultation_fee: Number(fee),
        consultation_modes: modes,
        languages: languages
          .split(",")
          .map((s) => s.trim())
          .filter(Boolean),
        biography: biography.trim(),
        contact_phone: contactPhone.trim() || null,
        auto_confirm: autoConfirm,
      };
      if (clinicName.trim() && clinicAddress.trim() && clinicCity.trim() && clinicState.trim() && clinicPostal.trim()) {
        payload.clinic = {
          name: clinicName.trim(),
          address: clinicAddress.trim(),
          city: clinicCity.trim(),
          state: clinicState.trim(),
          postal_code: clinicPostal.trim(),
          contact_information: clinicContact.trim() || null,
          latitude: clinicLat.trim() ? Number(clinicLat) : null,
          longitude: clinicLng.trim() ? Number(clinicLng) : null,
        };
      }
      const res = await apiFetch("/doctors/me/profile", {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setProfile(res.profile);
      setHasProfile(true);
      setNotice("Profile saved. Verification status: " + res.profile.verification_status.replace("_", " "));
      await loadAll();
    } catch (err: any) {
      setError(err?.message || "Failed to save profile.");
    } finally {
      setSaving(false);
    }
  };

  const handlePhotoUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const fd = new FormData();
    fd.append("photo", file);
    try {
      await apiFetch("/doctors/me/photo", { method: "POST", body: fd });
      setNotice("Profile photograph updated.");
      await loadAll();
    } catch (err: any) {
      setError(err?.message || "Photo upload failed.");
    }
  };

  const addWindowRow = () => {
    setWindows((prev) => [
      ...prev,
      {
        weekday: 0,
        start_time: "09:00",
        end_time: "13:00",
        slot_duration: 20,
        break_periods: [],
        buffer_duration: 5,
        consultation_modes: ["in_person", "online"],
        active_status: true,
      },
    ]);
  };

  const handleSaveSchedule = async () => {
    setSaving(true);
    setError(null);
    setNotice(null);
    try {
      await apiFetch("/doctors/me/schedule", {
        method: "PUT",
        body: JSON.stringify({
          windows: windows.map((w) => ({
            weekday: Number(w.weekday),
            start_time: w.start_time,
            end_time: w.end_time,
            slot_duration: Number(w.slot_duration),
            break_periods: w.break_periods || [],
            buffer_duration: Number(w.buffer_duration || 0),
            consultation_modes: w.consultation_modes || ["in_person"],
            active_status: w.active_status !== false,
          })),
        }),
      });
      setNotice("Weekly working hours saved cleanly (Asia/Kolkata).");
      await loadAll();
    } catch (err: any) {
      setError(err?.message || "Failed to update schedule.");
    } finally {
      setSaving(false);
    }
  };

  const handleAddException = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiFetch("/doctors/me/exceptions", {
        method: "POST",
        body: JSON.stringify({
          date: excDate,
          exception_type: excType,
          start_time: excStart.trim() || null,
          end_time: excEnd.trim() || null,
          slot_duration: excType === "extra_availability" ? Number(excSlotDur) : null,
          reason: excReason.trim() || null,
        }),
      });
      setNotice("Calendar exception added.");
      setExcStart("");
      setExcEnd("");
      setExcReason("");
      await loadAll();
    } catch (err: any) {
      setError(err?.message || "Could not add schedule exception.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteException = async (id: number) => {
    try {
      await apiFetch(`/doctors/me/exceptions/${id}`, { method: "DELETE" });
      await loadAll();
    } catch (err: any) {
      setError(err?.message || "Could not delete exception.");
    }
  };

  const handleApptDecision = async (apptId: number, decision: "confirm" | "reject") => {
    try {
      await apiFetch(`/appointments/${apptId}/decision`, {
        method: "POST",
        body: JSON.stringify({ decision, doctor_notes: doctorNotesMap[apptId] || undefined }),
      });
      setNotice(`Appointment ${decision === "confirm" ? "confirmed" : "rejected"}.`);
      await loadAll();
    } catch (err: any) {
      setError(err?.message || "Action failed.");
    }
  };

  const handleCompleteAppt = async (apptId: number) => {
    try {
      await apiFetch(`/appointments/${apptId}/complete`, {
        method: "POST",
        body: JSON.stringify({ doctor_notes: doctorNotesMap[apptId] || undefined }),
      });
      setNotice("Appointment marked as completed.");
      await loadAll();
    } catch (err: any) {
      setError(err?.message || "Could not mark appointment completed.");
    }
  };

  const handleCancelAppt = async (apptId: number) => {
    try {
      await apiFetch(`/appointments/${apptId}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: doctorNotesMap[apptId] || "Cancelled by doctor" }),
      });
      setNotice("Appointment cancelled.");
      await loadAll();
    } catch (err: any) {
      setError(err?.message || "Could not cancel appointment.");
    }
  };

  if (loading) return <LoadingState message="Loading Doctor Portal..." />;

  const statusBadgeVariant =
    profile?.verification_status === "verified"
      ? "verified"
      : profile?.verification_status === "pending_verification"
      ? "moderate"
      : "critical";

  const pendingCount = appointments.filter((a) => a.appointment_status === "pending").length;
  const confirmedCount = appointments.filter((a) => a.appointment_status === "confirmed").length;
  const completedCount = appointments.filter((a) => a.appointment_status === "completed").length;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-3xl border border-[#E5E9F0] bg-white p-6 shadow-[0_12px_32px_-16px_rgba(15,23,42,0.08)] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#EFF6FF] px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#0066FF]">
            <Stethoscope className="size-3.5" />
            <span>Clinician Workspace · Asia/Kolkata</span>
          </div>
          <h1 className="mt-1.5 font-display text-2xl font-semibold text-[#111827]">
            {section === "overview"
              ? "Doctor Overview"
              : section === "profile"
              ? "My Professional Profile"
              : section === "clinic"
              ? "Clinic Settings"
              : section === "availability"
              ? "Availability Calendar & Working Hours"
              : "Appointment Management"}
          </h1>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {hasProfile ? (
            <Badge variant={statusBadgeVariant}>
              {profile.verification_status === "verified" ? <ShieldCheck className="size-3.5" /> : <ShieldAlert className="size-3.5" />}
              <span>{profile.verification_status.replace("_", " ")}</span>
            </Badge>
          ) : (
            <Badge variant="moderate">Profile Not Submitted</Badge>
          )}
          <Link
            to="/doctor/records"
            className="inline-flex min-h-[40px] items-center rounded-full border border-[#E5E9F0] bg-[#F8FAFC] px-4 text-xs font-semibold text-[#111827] hover:border-[#0066FF]/40 hover:text-[#0066FF]"
          >
            Shared Records Viewer
          </Link>
        </div>
      </div>

      {error && <ErrorState message={error} onRetry={loadAll} />}
      {notice && <Alert variant="success">{notice}</Alert>}

      {!hasProfile && section !== "profile" && section !== "clinic" && (
        <Alert variant="warning" title="Complete Your Clinician Registration">
          Submit your qualifications, medical registration number, speciality, and clinic details in{" "}
          <Link to="/doctor/profile" className="font-semibold underline">
            My Profile
          </Link>{" "}
          so an administrator can verify your account before patients discover your schedule.
        </Alert>
      )}

      {hasProfile && profile?.verification_status !== "verified" && (
        <Alert variant={profile.verification_status === "pending_verification" ? "info" : "danger"} title="Directory Visibility Notice">
          Your profile status is currently <strong>{profile.verification_status.replace("_", " ")}</strong>. Only administrator-verified doctors appear in patient discovery.
          {profile.verification_notes ? ` Admin notes: ${profile.verification_notes}` : ""}
        </Alert>
      )}

      {/* SECTION: OVERVIEW */}
      {section === "overview" && (
        <div className="flex flex-col gap-6">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-5">
                <div className="text-xs text-[#64748B]">Confirmed Upcoming</div>
                <div className="mt-1 font-display text-2xl font-bold text-[#0066FF]">{confirmedCount}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="text-xs text-[#64748B]">Pending Approval</div>
                <div className="mt-1 font-display text-2xl font-bold text-amber-600">{pendingCount}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="text-xs text-[#64748B]">Completed Visits</div>
                <div className="mt-1 font-display text-2xl font-bold text-[#111827]">{completedCount}</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="text-xs text-[#64748B]">Active Weekly Windows</div>
                <div className="mt-1 font-display text-2xl font-bold text-[#111827]">{windows.length}</div>
              </CardContent>
            </Card>
          </div>

          {windows.length === 0 ? (
            <Card>
              <CardContent>
                <EmptyState
                  icon={Calendar}
                  title="Set up your availability to start accepting appointments."
                  description="Configure recurring weekly working hours, slot durations, breaks, and buffer times."
                />
                <div className="mt-4 flex justify-center">
                  <Link
                    to="/doctor/availability"
                    className="inline-flex min-h-[44px] items-center rounded-full bg-[#0066FF] px-5 text-xs font-semibold text-white"
                  >
                    Configure Weekly Schedule
                  </Link>
                </div>
              </CardContent>
            </Card>
          ) : (
            <Card>
              <CardHeader>
                <CardTitle>Recent &amp; Upcoming Appointments</CardTitle>
              </CardHeader>
              <CardContent>
                {appointments.length === 0 ? (
                  <EmptyState icon={Clock} title="No appointments scheduled." description="Confirmed and pending bookings appear here." />
                ) : (
                  <div className="flex flex-col divide-y divide-[#EEF1F5]">
                    {appointments.slice(0, 6).map((a) => (
                      <div key={a.id} className="flex items-center justify-between py-3 text-xs">
                        <div>
                          <div className="font-semibold text-[#111827]">{a.patient_name}</div>
                          <div className="font-mono text-[#64748B]">
                            {a.appointment_date} · {a.start_time} IST · {a.consultation_type}
                          </div>
                        </div>
                        <Badge variant={a.appointment_status === "confirmed" ? "verified" : "moderate"}>
                          {a.appointment_status}
                        </Badge>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {/* SECTION: PROFILE & CLINIC */}
      {(section === "profile" || section === "clinic") && (
        <form onSubmit={handleSaveProfileAndClinic} className="grid gap-6 lg:grid-cols-12">
          <Card className="lg:col-span-7">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCheck className="size-4 text-[#0066FF]" />
                <span>Professional Registration &amp; Credentials</span>
              </CardTitle>
              <CardDescription>
                Changes to registration number, qualifications, or primary speciality trigger administrator re-verification.
              </CardDescription>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <div>
                <FieldLabel htmlFor="doc-fn">Full Name</FieldLabel>
                <Input id="doc-fn" required value={fullName} onChange={(e) => setFullName(e.target.value)} className="mt-1 bg-[#F8FAFC]" />
              </div>
              <div>
                <FieldLabel htmlFor="doc-reg">Medical Registration Number</FieldLabel>
                <Input id="doc-reg" required value={regNumber} onChange={(e) => setRegNumber(e.target.value)} placeholder="e.g. NMC-MH-48291" className="mt-1 bg-[#F8FAFC]" />
              </div>
              <div className="sm:col-span-2">
                <FieldLabel htmlFor="doc-qual">Qualifications</FieldLabel>
                <Input id="doc-qual" required value={qualifications} onChange={(e) => setQualifications(e.target.value)} placeholder="e.g. MBBS, MD (Cardiology)" className="mt-1 bg-[#F8FAFC]" />
              </div>
              <div>
                <FieldLabel htmlFor="doc-spec-pri">Primary Medical Speciality</FieldLabel>
                <Select id="doc-spec-pri" value={primarySpecId} onChange={(e) => setPrimarySpecId(e.target.value)} className="mt-1 bg-[#F8FAFC]">
                  {specialities.map((sp) => (
                    <option key={sp.id} value={sp.id}>
                      {sp.name}
                    </option>
                  ))}
                </Select>
              </div>
              <div>
                <FieldLabel htmlFor="doc-exp">Years of Experience</FieldLabel>
                <Input id="doc-exp" type="number" min={0} max={70} required value={experienceYears} onChange={(e) => setExperienceYears(Number(e.target.value))} className="mt-1 bg-[#F8FAFC]" />
              </div>
              <div>
                <FieldLabel htmlFor="doc-fee">Consultation Fee (INR)</FieldLabel>
                <Input id="doc-fee" type="number" min={0} required value={fee} onChange={(e) => setFee(Number(e.target.value))} className="mt-1 bg-[#F8FAFC]" />
              </div>
              <div>
                <FieldLabel htmlFor="doc-phone">Contact Phone</FieldLabel>
                <Input id="doc-phone" value={contactPhone} onChange={(e) => setContactPhone(e.target.value)} placeholder="+91 ..." className="mt-1 bg-[#F8FAFC]" />
              </div>
              <div className="sm:col-span-2">
                <FieldLabel htmlFor="doc-langs">Languages Spoken (comma-separated)</FieldLabel>
                <Input id="doc-langs" value={languages} onChange={(e) => setLanguages(e.target.value)} placeholder="English, Hindi, Marathi" className="mt-1 bg-[#F8FAFC]" />
              </div>
              <div className="sm:col-span-2 flex flex-wrap gap-4">
                {["in_person", "online"].map((m) => (
                  <label key={m} className="flex items-center gap-2 text-xs font-medium text-[#111827]">
                    <input
                      type="checkbox"
                      checked={modes.includes(m)}
                      onChange={() => setModes((prev) => (prev.includes(m) ? prev.filter((x) => x !== m) : [...prev, m]))}
                      className="accent-[#0066FF]"
                    />
                    <span>{m === "in_person" ? "In-Person Consultations" : "Online Video Consultations"}</span>
                  </label>
                ))}
                <label className="flex items-center gap-2 text-xs font-medium text-[#111827]">
                  <input
                    type="checkbox"
                    checked={autoConfirm}
                    onChange={(e) => setAutoConfirm(e.target.checked)}
                    className="accent-[#0066FF]"
                  />
                  <span>Instant Booking Confirmation (uncheck to manually approve requests)</span>
                </label>
              </div>
              <div className="sm:col-span-2">
                <FieldLabel htmlFor="doc-bio">Professional Biography</FieldLabel>
                <Textarea id="doc-bio" rows={3} value={biography} onChange={(e) => setBiography(e.target.value)} className="mt-1 bg-[#F8FAFC]" />
              </div>
              {hasProfile && (
                <div className="sm:col-span-2">
                  <FieldLabel htmlFor="doc-photo">Profile Photograph (JPG / PNG)</FieldLabel>
                  <label className="mt-1 flex w-fit cursor-pointer items-center gap-2 rounded-full border border-[#E5E9F0] bg-[#F8FAFC] px-4 py-2 text-xs font-semibold text-[#111827] hover:border-[#0066FF]">
                    <Camera className="size-4 text-[#0066FF]" />
                    <span>Upload Photo</span>
                    <input id="doc-photo" type="file" accept="image/png,image/jpeg" onChange={handlePhotoUpload} className="hidden" />
                  </label>
                </div>
              )}
            </CardContent>
          </Card>

          <Card className="lg:col-span-5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Building2 className="size-4 text-[#0066FF]" />
                <span>Clinic / Hospital Location</span>
              </CardTitle>
              <CardDescription>Displayed on discovery cards and map direction links.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <div>
                <FieldLabel htmlFor="cl-name">Clinic / Hospital Name</FieldLabel>
                <Input id="cl-name" value={clinicName} onChange={(e) => setClinicName(e.target.value)} placeholder="City Health Center" className="mt-1 bg-[#F8FAFC]" />
              </div>
              <div>
                <FieldLabel htmlFor="cl-addr">Street Address</FieldLabel>
                <Input id="cl-addr" value={clinicAddress} onChange={(e) => setClinicAddress(e.target.value)} className="mt-1 bg-[#F8FAFC]" />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <FieldLabel htmlFor="cl-city">City</FieldLabel>
                  <Input id="cl-city" value={clinicCity} onChange={(e) => setClinicCity(e.target.value)} className="mt-1 bg-[#F8FAFC]" />
                </div>
                <div>
                  <FieldLabel htmlFor="cl-state">State</FieldLabel>
                  <Input id="cl-state" value={clinicState} onChange={(e) => setClinicState(e.target.value)} className="mt-1 bg-[#F8FAFC]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <FieldLabel htmlFor="cl-pin">PIN / Postal Code</FieldLabel>
                  <Input id="cl-pin" value={clinicPostal} onChange={(e) => setClinicPostal(e.target.value)} className="mt-1 bg-[#F8FAFC]" />
                </div>
                <div>
                  <FieldLabel htmlFor="cl-cont">Clinic Contact</FieldLabel>
                  <Input id="cl-cont" value={clinicContact} onChange={(e) => setClinicContact(e.target.value)} className="mt-1 bg-[#F8FAFC]" />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <FieldLabel htmlFor="cl-lat">Latitude (Optional)</FieldLabel>
                  <Input id="cl-lat" value={clinicLat} onChange={(e) => setClinicLat(e.target.value)} placeholder="18.5204" className="mt-1 bg-[#F8FAFC]" />
                </div>
                <div>
                  <FieldLabel htmlFor="cl-lng">Longitude (Optional)</FieldLabel>
                  <Input id="cl-lng" value={clinicLng} onChange={(e) => setClinicLng(e.target.value)} placeholder="73.8567" className="mt-1 bg-[#F8FAFC]" />
                </div>
              </div>
              <div className="pt-2">
                <Button type="submit" disabled={saving} className="w-full">
                  {saving ? "Saving..." : "Save Profile & Submit for Verification"}
                </Button>
              </div>
            </CardContent>
          </Card>
        </form>
      )}

      {/* SECTION: AVAILABILITY & CALENDAR */}
      {section === "availability" && (
        <div className="flex flex-col gap-6">
          <div className="grid gap-6 lg:grid-cols-12">
            <Card className="lg:col-span-7">
              <CardHeader className="flex-row items-center justify-between">
                <div>
                  <CardTitle>Weekly Recurring Working Hours</CardTitle>
                  <CardDescription>Add morning/evening windows per weekday, slot durations, and buffer intervals.</CardDescription>
                </div>
                <Button size="sm" variant="outline" onClick={addWindowRow}>
                  <Plus className="size-4" />
                  <span>Add Window</span>
                </Button>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {windows.length === 0 ? (
                  <EmptyState
                    icon={Clock}
                    title="Set up your availability to start accepting appointments."
                    description="Click 'Add Window' above to configure your clinic days and consultation durations."
                  />
                ) : (
                  windows.map((w, idx) => (
                    <div key={idx} className="grid items-end gap-2 rounded-2xl border border-[#E5E9F0] bg-[#F8FAFC] p-3 sm:grid-cols-6">
                      <div className="sm:col-span-2">
                        <FieldLabel>Weekday</FieldLabel>
                        <Select
                          value={w.weekday}
                          onChange={(e) => {
                            const next = [...windows];
                            next[idx] = { ...w, weekday: Number(e.target.value) };
                            setWindows(next);
                          }}
                          className="mt-1 bg-white"
                        >
                          {WEEKDAYS.map((dayName, dIdx) => (
                            <option key={dIdx} value={dIdx}>
                              {dayName}
                            </option>
                          ))}
                        </Select>
                      </div>
                      <div>
                        <FieldLabel>Start</FieldLabel>
                        <Input
                          type="time"
                          value={w.start_time}
                          onChange={(e) => {
                            const next = [...windows];
                            next[idx] = { ...w, start_time: e.target.value };
                            setWindows(next);
                          }}
                          className="mt-1 bg-white"
                        />
                      </div>
                      <div>
                        <FieldLabel>End</FieldLabel>
                        <Input
                          type="time"
                          value={w.end_time}
                          onChange={(e) => {
                            const next = [...windows];
                            next[idx] = { ...w, end_time: e.target.value };
                            setWindows(next);
                          }}
                          className="mt-1 bg-white"
                        />
                      </div>
                      <div>
                        <FieldLabel>Slot (m)</FieldLabel>
                        <Input
                          type="number"
                          min={10}
                          max={120}
                          value={w.slot_duration}
                          onChange={(e) => {
                            const next = [...windows];
                            next[idx] = { ...w, slot_duration: Number(e.target.value) };
                            setWindows(next);
                          }}
                          className="mt-1 bg-white"
                        />
                      </div>
                      <div className="flex items-center gap-1">
                        <Input
                          type="number"
                          min={0}
                          max={45}
                          title="Buffer minutes"
                          value={w.buffer_duration ?? 0}
                          onChange={(e) => {
                            const next = [...windows];
                            next[idx] = { ...w, buffer_duration: Number(e.target.value) };
                            setWindows(next);
                          }}
                          className="bg-white"
                        />
                        <button
                          type="button"
                          onClick={() => setWindows(windows.filter((_, i) => i !== idx))}
                          aria-label="Remove window"
                          className="inline-flex size-10 shrink-0 items-center justify-center rounded-xl text-[#EF233C] hover:bg-rose-50"
                        >
                          <Trash2 className="size-4" />
                        </button>
                      </div>
                    </div>
                  ))
                )}

                {windows.length > 0 && (
                  <div className="flex justify-end pt-2">
                    <Button onClick={handleSaveSchedule} disabled={saving || !hasProfile}>
                      {saving ? "Saving..." : "Save Weekly Schedule"}
                    </Button>
                  </div>
                )}
              </CardContent>
            </Card>

            <Card className="lg:col-span-5">
              <CardHeader>
                <CardTitle>Holidays, Leave &amp; Schedule Exceptions</CardTitle>
                <CardDescription>Block whole dates, partial hours, or add one-time extra availability.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-4">
                <form onSubmit={handleAddException} className="grid gap-2.5">
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <FieldLabel htmlFor="ex-date">Date</FieldLabel>
                      <Input id="ex-date" type="date" required value={excDate} onChange={(e) => setExcDate(e.target.value)} className="mt-1 bg-[#F8FAFC]" />
                    </div>
                    <div>
                      <FieldLabel htmlFor="ex-type">Type</FieldLabel>
                      <Select id="ex-type" value={excType} onChange={(e) => setExcType(e.target.value)} className="mt-1 bg-[#F8FAFC]">
                        <option value="blocked">Block Hours / Date</option>
                        <option value="holiday">Holiday</option>
                        <option value="leave">Doctor Leave</option>
                        <option value="extra_availability">Extra Availability</option>
                      </Select>
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-2">
                    <div>
                      <FieldLabel htmlFor="ex-st">Start (blank = full day)</FieldLabel>
                      <Input id="ex-st" type="time" value={excStart} onChange={(e) => setExcStart(e.target.value)} className="mt-1 bg-[#F8FAFC]" />
                    </div>
                    <div>
                      <FieldLabel htmlFor="ex-en">End</FieldLabel>
                      <Input id="ex-en" type="time" value={excEnd} onChange={(e) => setExcEnd(e.target.value)} className="mt-1 bg-[#F8FAFC]" />
                    </div>
                  </div>
                  {excType === "extra_availability" && (
                    <div>
                      <FieldLabel htmlFor="ex-dur">Slot Duration (mins)</FieldLabel>
                      <Input id="ex-dur" type="number" min={10} max={120} value={excSlotDur} onChange={(e) => setExcSlotDur(Number(e.target.value))} className="mt-1 bg-[#F8FAFC]" />
                    </div>
                  )}
                  <div>
                    <FieldLabel htmlFor="ex-rsn">Reason</FieldLabel>
                    <Input id="ex-rsn" value={excReason} onChange={(e) => setExcReason(e.target.value)} placeholder="Conference, personal leave, evening camp..." className="mt-1 bg-[#F8FAFC]" />
                  </div>
                  <Button type="submit" variant="outline" disabled={saving || !hasProfile}>
                    Add Exception
                  </Button>
                </form>

                {exceptions.length > 0 && (
                  <div className="flex flex-col gap-2 border-t border-[#EEF1F5] pt-3">
                    {exceptions.map((ex) => (
                      <div key={ex.id} className="flex items-center justify-between rounded-xl border border-[#E5E9F0] bg-[#F8FAFC] px-3 py-2 text-xs">
                        <div>
                          <span className="font-mono font-semibold text-[#111827]">{ex.date}</span>{" "}
                          <Badge variant={ex.exception_type === "extra_availability" ? "verified" : "neutral"}>
                            {ex.exception_type}
                          </Badge>
                          <div className="text-[11px] text-[#64748B]">
                            {ex.start_time && ex.end_time ? `${ex.start_time}–${ex.end_time}` : "Full day"}
                            {ex.reason ? ` · ${ex.reason}` : ""}
                          </div>
                        </div>
                        <button type="button" onClick={() => handleDeleteException(ex.id)} className="text-[#EF233C] hover:underline">
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </CardContent>
            </Card>
          </div>

          {/* 7-Day Live Interactive Calendar Grid */}
          <Card>
            <CardHeader>
              <CardTitle>Interactive 7-Day Calendar Preview (Asia/Kolkata)</CardTitle>
              <CardDescription>Live computed view of open slots, booked appointments, pending requests, and blocked intervals.</CardDescription>
            </CardHeader>
            <CardContent>
              {!calendarData?.days?.length ? (
                <EmptyState icon={Calendar} title="No calendar data yet." description="Save your weekly hours above to view your live schedule." />
              ) : (
                <div className="grid gap-3 md:grid-cols-7">
                  {calendarData.days.map((d: any) => (
                    <div key={d.date} className="flex flex-col gap-2 rounded-2xl border border-[#E5E9F0] bg-[#F8FAFC] p-3">
                      <div className="border-b border-[#E5E9F0] pb-1.5 text-center">
                        <div className="font-mono text-xs font-semibold text-[#111827]">{d.date}</div>
                        <div className="text-[10px] uppercase text-[#64748B]">{d.day_status.replace("_", " ")}</div>
                      </div>
                      {d.slots.length === 0 ? (
                        <div className="py-3 text-center text-[11px] text-[#64748B]">{d.reason || "No slots"}</div>
                      ) : (
                        <div className="flex max-h-56 flex-col gap-1 overflow-y-auto">
                          {d.slots.map((s: any) => (
                            <div
                              key={s.start_time}
                              className={`flex items-center justify-between rounded-lg px-2 py-1 font-mono text-[10px] ${
                                s.slot_status === "confirmed"
                                  ? "bg-[#0066FF] text-white"
                                  : s.slot_status === "pending"
                                  ? "bg-amber-100 text-amber-900"
                                  : s.slot_status === "blocked"
                                  ? "bg-rose-100 text-rose-800"
                                  : s.slot_status === "past"
                                  ? "bg-slate-100 text-slate-400"
                                  : "bg-white text-[#111827] border border-[#E5E9F0]"
                              }`}
                            >
                              <span>{s.start_time}</span>
                              <span>{s.slot_status}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {/* SECTION: APPOINTMENTS MANAGEMENT */}
      {section === "appointments" && (
        <Card>
          <CardHeader>
            <CardTitle>Scheduled Consultations &amp; Requests ({appointments.length})</CardTitle>
            <CardDescription>
              Approve or reject pending requests, view patient notes, mark consultations completed, or open explicitly shared patient vault records.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {appointments.length === 0 ? (
              <EmptyState icon={Calendar} title="No appointments scheduled." description="Patient bookings will appear here once your profile is verified and schedule is active." />
            ) : (
              <div className="flex flex-col gap-4">
                {appointments.map((a) => (
                  <div key={a.id} className="flex flex-col gap-3 rounded-2xl border border-[#E5E9F0] bg-[#F8FAFC] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-display text-base font-semibold text-[#111827]">{a.patient_name}</span>
                          <Badge variant={a.appointment_status === "confirmed" ? "verified" : a.appointment_status === "pending" ? "moderate" : "neutral"}>
                            {a.appointment_status}
                          </Badge>
                          {a.share_session_id && (
                            <Link to="/doctor/records" className="inline-flex items-center gap-1 rounded-full bg-[#EFF6FF] px-2.5 py-0.5 text-[11px] font-semibold text-[#0066FF] hover:underline">
                              Patient Shared Records Available
                            </Link>
                          )}
                        </div>
                        <div className="mt-0.5 font-mono text-xs text-[#475569]">
                          {a.appointment_date} · {a.start_time}–{a.end_time} IST · {a.consultation_type.replace("_", " ")} · ₹{a.consultation_fee}
                        </div>
                      </div>
                    </div>

                    {a.patient_notes && (
                      <div className="rounded-xl border border-[#E5E9F0] bg-white px-3 py-2 text-xs text-[#334155]">
                        <strong>Patient Notes:</strong> {a.patient_notes}
                      </div>
                    )}

                    {["pending", "confirmed"].includes(a.appointment_status) && (
                      <div className="flex flex-wrap items-center gap-2">
                        <Input
                          value={doctorNotesMap[a.id] ?? ""}
                          onChange={(e) => setDoctorNotesMap((prev) => ({ ...prev, [a.id]: e.target.value }))}
                          placeholder="Optional clinician note or reason..."
                          className="max-w-xs bg-white text-xs"
                        />
                        {a.appointment_status === "pending" && (
                          <>
                            <Button size="sm" onClick={() => handleApptDecision(a.id, "confirm")}>
                              <CheckCircle2 className="size-3.5" />
                              <span>Confirm</span>
                            </Button>
                            <Button size="sm" variant="destructive" onClick={() => handleApptDecision(a.id, "reject")}>
                              <XCircle className="size-3.5" />
                              <span>Reject</span>
                            </Button>
                          </>
                        )}
                        {a.appointment_status === "confirmed" && (
                          <>
                            <Button size="sm" onClick={() => handleCompleteAppt(a.id)}>
                              <CheckCircle2 className="size-3.5" />
                              <span>Mark Completed</span>
                            </Button>
                            <Button size="sm" variant="outline" onClick={() => handleCancelAppt(a.id)}>
                              Cancel Appointment
                            </Button>
                          </>
                        )}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
