import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  Award,
  Bot,
  Calendar,
  CheckCircle2,
  Clock,
  ExternalLink,
  Filter,
  Flag,
  FolderLock,
  Languages,
  MapPin,
  Navigation,
  Search,
  Share2,
  ShieldCheck,
  Sparkles,
  Stethoscope,
  Video,
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
  FieldLabel,
  Input,
  LoadingState,
  Modal,
  Select,
  Textarea,
} from "@/components/ui/primitives";
import { apiFetch } from "@/lib/api";
import { CATEGORY_LABELS, formatDate } from "@/lib/utils";

const WEEKDAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function getNextDays(count = 14): string[] {
  const list: string[] = [];
  const now = new Date();
  for (let i = 0; i < count; i++) {
    const d = new Date(now);
    d.setDate(now.getDate() + i);
    list.push(d.toISOString().slice(0, 10));
  }
  return list;
}

export function FindDoctorPage() {
  const [specialities, setSpecialities] = useState<any[]>([]);
  const [doctors, setDoctors] = useState<any[]>([]);
  const [loadingDocs, setLoadingDocs] = useState(true);
  const [searchError, setSearchError] = useState<string | null>(null);

  // Filters
  const [q, setQ] = useState("");
  const [specialityId, setSpecialityId] = useState<string>("");
  const [city, setCity] = useState("");
  const [pinCode, setPinCode] = useState("");
  const [coords, setCoords] = useState<{ lat: number; lng: number } | null>(null);
  const [maxDistanceKm, setMaxDistanceKm] = useState<string>("");
  const [maxFee, setMaxFee] = useState<string>("");
  const [minExp, setMinExp] = useState<string>("");
  const [availDate, setAvailDate] = useState<string>("");
  const [timeOfDay, setTimeOfDay] = useState<string>("");
  const [mode, setMode] = useState<string>("");
  const [language, setLanguage] = useState<string>("");
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [geoStatus, setGeoStatus] = useState<string | null>(null);

  // AI Speciality Matching ("Not sure which doctor to visit?")
  const [concern, setConcern] = useState("");
  const [followUp, setFollowUp] = useState("");
  const [useVaultContext, setUseVaultContext] = useState(false);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiResult, setAiResult] = useState<any>(null);
  const [aiError, setAiError] = useState<string | null>(null);

  // Doctor Profile Modal + Availability + Booking Flow
  const [selectedDoctor, setSelectedDoctor] = useState<any>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [bookingStep, setBookingStep] = useState<"profile" | "slots" | "confirm" | "done">("profile");
  const [bookingMode, setBookingMode] = useState<"in_person" | "online">("in_person");
  const [bookingDate, setBookingDate] = useState<string>(getNextDays(1)[0]);
  const [daySlots, setDaySlots] = useState<any[]>([]);
  const [dayStatus, setDayStatus] = useState<string>("working");
  const [slotsLoading, setSlotsLoading] = useState(false);
  const [selectedSlot, setSelectedSlot] = useState<any>(null);
  const [patientNotes, setPatientNotes] = useState("");
  const [bookingBusy, setBookingBusy] = useState(false);
  const [bookingError, setBookingError] = useState<string | null>(null);
  const [bookedAppt, setBookedAppt] = useState<any>(null);

  // Optional Vault Sharing Modal after Booking
  const [shareModalOpen, setShareModalOpen] = useState(false);
  const [vaultDocs, setVaultDocs] = useState<any[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<number[]>([]);
  const [includeSummary, setIncludeSummary] = useState(true);
  const [sharePin, setSharePin] = useState("");
  const [shareConsent, setShareConsent] = useState(false);
  const [shareBusy, setShareBusy] = useState(false);
  const [shareResult, setShareResult] = useState<any>(null);
  const [shareError, setShareError] = useState<string | null>(null);

  // Report Profile Modal
  const [reportDoctorId, setReportDoctorId] = useState<number | null>(null);
  const [reportReason, setReportReason] = useState("");
  const [reportNotice, setReportNotice] = useState<string | null>(null);

  const loadSpecialities = useCallback(async () => {
    try {
      const res = await apiFetch("/specialities");
      setSpecialities(res.specialities || []);
    } catch {
      setSpecialities([]);
    }
  }, []);

  const fetchDoctors = useCallback(async (overrideSpecId?: string) => {
    setLoadingDocs(true);
    setSearchError(null);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      const activeSpec = overrideSpecId !== undefined ? overrideSpecId : specialityId;
      if (activeSpec) params.set("speciality_id", activeSpec);
      if (city.trim()) params.set("city", city.trim());
      if (pinCode.trim()) params.set("pin_code", pinCode.trim());
      if (coords) {
        params.set("lat", String(coords.lat));
        params.set("lng", String(coords.lng));
        if (maxDistanceKm) params.set("max_distance_km", maxDistanceKm);
      }
      if (maxFee) params.set("max_fee", maxFee);
      if (minExp) params.set("min_experience", minExp);
      if (availDate) params.set("available_date", availDate);
      if (timeOfDay) params.set("time_of_day", timeOfDay);
      if (mode) params.set("consultation_mode", mode);
      if (language.trim()) params.set("language", language.trim());
      params.set("verified_only", "true");

      const res = await apiFetch(`/doctors?${params.toString()}`);
      setDoctors(res.doctors || []);
    } catch (err: any) {
      setSearchError(err?.message || "Failed to load verified doctors.");
    } finally {
      setLoadingDocs(false);
    }
  }, [availDate, city, coords, language, maxDistanceKm, maxFee, minExp, mode, pinCode, q, specialityId, timeOfDay]);

  useEffect(() => {
    loadSpecialities();
  }, [loadSpecialities]);

  useEffect(() => {
    fetchDoctors();
  }, [fetchDoctors]);

  const handleRequestLocation = () => {
    if (!navigator.geolocation) {
      setGeoStatus("Browser geolocation is unavailable on this device.");
      return;
    }
    setGeoStatus("Requesting your location permission...");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setCoords({ lat: pos.coords.latitude, lng: pos.coords.longitude });
        setGeoStatus(`Using your shared coordinates (${pos.coords.latitude.toFixed(3)}, ${pos.coords.longitude.toFixed(3)}).`);
      },
      () => {
        setGeoStatus("Location permission was denied. You can still search by city or PIN code.");
      }
    );
  };

  const handleAiMatch = async (e: React.FormEvent) => {
    e.preventDefault();
    if (concern.trim().length < 3) return;
    setAiLoading(true);
    setAiError(null);
    try {
      const res = await apiFetch("/doctors/speciality-match", {
        method: "POST",
        body: JSON.stringify({
          concern: concern.trim(),
          use_vault_context: useVaultContext,
          follow_up_answers: followUp.trim() || undefined,
        }),
      });
      setAiResult(res);
    } catch (err: any) {
      setAiError(err?.message || "Unable to complete speciality matching right now.");
    } finally {
      setAiLoading(false);
    }
  };

  const fetchSlotsForDoctor = useCallback(async (docId: number, dateStr: string, cType: string) => {
    setSlotsLoading(true);
    setSelectedSlot(null);
    setBookingError(null);
    try {
      const res = await apiFetch(`/doctors/${docId}/availability?date=${dateStr}&consultation_type=${cType}`);
      setDaySlots(res.slots || []);
      setDayStatus(res.day_status || "working");
    } catch (err: any) {
      setBookingError(err?.message || "Could not load availability.");
      setDaySlots([]);
    } finally {
      setSlotsLoading(false);
    }
  }, []);

  const openDoctorProfile = async (docId: number, startAtBooking = false) => {
    setProfileLoading(true);
    setBookingError(null);
    setBookedAppt(null);
    setSelectedSlot(null);
    setPatientNotes("");
    try {
      const full = await apiFetch(`/doctors/${docId}`);
      setSelectedDoctor(full);
      const defaultMode = full.consultation_modes?.includes("in_person") ? "in_person" : "online";
      setBookingMode(defaultMode);
      const defaultDate = full.next_available_slot?.date || getNextDays(1)[0];
      setBookingDate(defaultDate);
      setBookingStep(startAtBooking ? "slots" : "profile");
      await fetchSlotsForDoctor(docId, defaultDate, defaultMode);
    } catch (err: any) {
      setSearchError(err?.message || "Unable to load doctor profile.");
    } finally {
      setProfileLoading(false);
    }
  };

  const handleConfirmBooking = async () => {
    if (!selectedDoctor || !selectedSlot) return;
    setBookingBusy(true);
    setBookingError(null);
    try {
      const res = await apiFetch("/appointments", {
        method: "POST",
        body: JSON.stringify({
          doctor_id: selectedDoctor.id,
          appointment_date: bookingDate,
          start_time: selectedSlot.start_time,
          consultation_type: bookingMode,
          patient_notes: patientNotes.trim() || undefined,
        }),
      });
      setBookedAppt(res.appointment);
      setBookingStep("done");
      fetchDoctors();
    } catch (err: any) {
      setBookingError(err?.message || "Slot could not be confirmed.");
      // Immediately refresh slots in case another patient booked concurrently
      await fetchSlotsForDoctor(selectedDoctor.id, bookingDate, bookingMode);
      setBookingStep("slots");
    } finally {
      setBookingBusy(false);
    }
  };

  const openShareModal = async () => {
    setShareModalOpen(true);
    setShareError(null);
    setShareResult(null);
    setShareConsent(false);
    try {
      const res = await apiFetch("/vault/documents");
      const docs = res.documents || [];
      setVaultDocs(docs);
      setSelectedDocIds(docs.slice(0, 3).map((d: any) => d.id));
    } catch (err: any) {
      setShareError(err?.message || "Could not load your vault documents.");
    }
  };

  const handleShareRecordsSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!bookedAppt || selectedDocIds.length === 0 || !shareConsent) return;
    setShareBusy(true);
    setShareError(null);
    try {
      const res = await apiFetch(`/appointments/${bookedAppt.id}/share-records`, {
        method: "POST",
        body: JSON.stringify({
          document_ids: selectedDocIds,
          include_summary: includeSummary,
          expiry_minutes: 180,
          pin: sharePin.trim() || undefined,
        }),
      });
      setShareResult(res.share_session);
    } catch (err: any) {
      setShareError(err?.message || "Failed to share selected records.");
    } finally {
      setShareBusy(false);
    }
  };

  const handleReportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reportDoctorId || reportReason.trim().length < 5) return;
    try {
      await apiFetch(`/doctors/${reportDoctorId}/report`, {
        method: "POST",
        body: JSON.stringify({ reason: reportReason.trim() }),
      });
      setReportNotice("Thank you. This profile report has been logged for administrator review.");
      setReportDoctorId(null);
      setReportReason("");
    } catch (err: any) {
      setSearchError(err?.message || "Could not submit report.");
    }
  };

  const upcomingDays = getNextDays(14);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      {/* Header */}
      <div className="flex flex-col gap-4 rounded-3xl border border-[#E5E9F0] bg-white p-6 shadow-[0_12px_32px_-16px_rgba(15,23,42,0.08)] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#EFF6FF] px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#0066FF]">
            <Stethoscope className="size-3.5" aria-hidden="true" />
            <span>Verified Clinician Directory</span>
          </div>
          <h1 className="mt-1.5 font-display text-3xl font-semibold tracking-tight text-[#111827]">Find a Doctor</h1>
          <p className="text-sm text-[#64748B]">
            Describe your health concern for AI speciality guidance, search verified doctors, check live slots in IST, and book directly.
          </p>
        </div>
        <Link
          to="/patient/appointments"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[#E5E9F0] bg-[#F8FAFC] px-5 text-xs font-semibold text-[#111827] hover:border-[#0066FF]/40 hover:bg-[#EFF6FF] hover:text-[#0066FF]"
        >
          <Calendar className="size-4 text-[#0066FF]" aria-hidden="true" />
          <span>My Appointments</span>
        </Link>
      </div>

      {reportNotice && (
        <Alert variant="success" title="Report Logged">
          {reportNotice}
        </Alert>
      )}

      {/* AI Speciality Matching Panel */}
      <Card className="border-[#BFDBFE]/80">
        <CardHeader className="bg-gradient-to-r from-[#FAFBFC] to-[#EFF6FF]/60">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="flex items-center gap-2 text-lg">
                <Sparkles className="size-5 text-[#0066FF]" aria-hidden="true" />
                <span>Not sure which doctor to visit?</span>
              </CardTitle>
              <CardDescription>
                Describe your symptoms or concern in plain language. Powered by Ayuva&apos;s live Gemini AI assistant with clinical safety checks.
              </CardDescription>
            </div>
            <Badge variant="teal">AI Speciality Guidance</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <form onSubmit={handleAiMatch} className="flex flex-col gap-3">
            <div className="grid gap-3 md:grid-cols-12">
              <div className="md:col-span-8">
                <FieldLabel htmlFor="ai-concern">Describe your health concern</FieldLabel>
                <Input
                  id="ai-concern"
                  value={concern}
                  onChange={(e) => setConcern(e.target.value)}
                  placeholder="e.g., I have been experiencing frequent headaches and dizziness for two weeks."
                  className="mt-1 rounded-2xl bg-[#F8FAFC]"
                />
              </div>
              <div className="md:col-span-4 flex flex-col justify-end gap-2">
                <label className="flex items-center gap-2 rounded-2xl border border-[#E5E9F0] bg-[#F8FAFC] px-3 py-2 text-xs text-[#334155]">
                  <input
                    type="checkbox"
                    checked={useVaultContext}
                    onChange={(e) => setUseVaultContext(e.target.checked)}
                    className="accent-[#0066FF]"
                  />
                  <span>Include consented Medical Vault context</span>
                </label>
              </div>
            </div>

            {aiResult && !aiResult.is_emergency && aiResult.clarifying_questions?.length > 0 && (
              <div>
                <FieldLabel htmlFor="ai-followup">Optional details to refine suggestion</FieldLabel>
                <Input
                  id="ai-followup"
                  value={followUp}
                  onChange={(e) => setFollowUp(e.target.value)}
                  placeholder="Answer clarifying questions above to narrow down speciality..."
                  className="mt-1 rounded-2xl bg-[#F8FAFC]"
                />
              </div>
            )}

            <div className="flex flex-wrap items-center justify-between gap-3">
              <p className="text-[11px] text-[#64748B]">
                These suggestions help you identify a relevant medical speciality. They are not a medical diagnosis or a replacement for professional evaluation.
              </p>
              <Button type="submit" disabled={aiLoading || concern.trim().length < 3}>
                <Bot className="size-4" aria-hidden="true" />
                <span>{aiLoading ? "Analyzing..." : "Suggest Speciality"}</span>
              </Button>
            </div>
          </form>

          {aiError && <Alert variant="warning">{aiError}</Alert>}

          {aiResult && (
            <div className="rounded-2xl border border-[#E5E9F0] bg-[#F8FAFC] p-4">
              {aiResult.is_emergency ? (
                <Alert variant="danger" title="Seek Immediate Emergency Medical Care">
                  <p className="font-medium">{aiResult.reasoning}</p>
                  <p className="mt-1 text-xs">Please contact emergency medical services or visit the nearest hospital ER right away rather than booking a routine appointment.</p>
                </Alert>
              ) : (
                <div className="flex flex-col gap-3">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <div className="flex flex-wrap items-center gap-2">
                      {aiResult.recommended_speciality ? (
                        <Badge variant="teal" className="text-xs font-semibold">
                          Suggested: {aiResult.recommended_speciality.name}
                        </Badge>
                      ) : (
                        <Badge variant="neutral">Speciality Directory Fallback</Badge>
                      )}
                      {(aiResult.alternative_specialities || []).map((alt: any) => (
                        <Badge key={alt.id} variant="neutral">
                          Alternative: {alt.name}
                        </Badge>
                      ))}
                      {aiResult.context_used && <Badge variant="verified">Used Consented Vault Context</Badge>}
                    </div>

                    {aiResult.recommended_speciality && (
                      <Button
                        size="sm"
                        onClick={() => {
                          const sid = String(aiResult.recommended_speciality.id);
                          setSpecialityId(sid);
                          fetchDoctors(sid);
                        }}
                      >
                        Explore {aiResult.recommended_speciality.name} Doctors
                      </Button>
                    )}
                  </div>

                  <p className="text-sm leading-relaxed text-[#111827]">{aiResult.reasoning}</p>

                  {aiResult.clarifying_questions?.length > 0 && (
                    <div className="rounded-xl border border-[#E5E9F0] bg-white p-3">
                      <div className="text-xs font-semibold text-[#111827]">Clarifying questions to consider:</div>
                      <ul className="mt-1 list-disc pl-5 text-xs text-[#475569]">
                        {aiResult.clarifying_questions.map((cq: string, i: number) => (
                          <li key={i}>{cq}</li>
                        ))}
                      </ul>
                    </div>
                  )}

                  {!aiResult.ai_available && aiResult.available_specialities && (
                    <div className="flex flex-wrap gap-2 pt-1">
                      {aiResult.available_specialities.map((sp: any) => (
                        <button
                          key={sp.id}
                          type="button"
                          onClick={() => {
                            setSpecialityId(String(sp.id));
                            fetchDoctors(String(sp.id));
                          }}
                          className="rounded-full border border-[#E5E9F0] bg-white px-3 py-1 text-xs font-medium text-[#111827] hover:border-[#0066FF] hover:text-[#0066FF]"
                        >
                          {sp.name}
                        </button>
                      ))}
                    </div>
                  )}

                  <div className="text-[11px] text-[#64748B]">
                    {aiResult.uncertainty_note} · <span className="font-semibold">{aiResult.disclaimer}</span>
                  </div>
                </div>
              )}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Search & Filter Controls */}
      <Card>
        <CardContent className="flex flex-col gap-4">
          <div className="grid gap-3 md:grid-cols-12">
            <div className="md:col-span-4">
              <FieldLabel htmlFor="doc-q">Doctor, Speciality, or Clinic</FieldLabel>
              <div className="relative mt-1">
                <Search className="pointer-events-none absolute top-3.5 left-3.5 size-4 text-[#64748B]" />
                <Input
                  id="doc-q"
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Search name, clinic, speciality..."
                  className="pl-10 rounded-2xl bg-[#F8FAFC]"
                />
              </div>
            </div>
            <div className="md:col-span-3">
              <FieldLabel htmlFor="doc-spec">Speciality</FieldLabel>
              <Select
                id="doc-spec"
                value={specialityId}
                onChange={(e) => setSpecialityId(e.target.value)}
                className="mt-1 rounded-2xl bg-[#F8FAFC]"
              >
                <option value="">All Specialities</option>
                {specialities.map((sp) => (
                  <option key={sp.id} value={sp.id}>
                    {sp.name}
                  </option>
                ))}
              </Select>
            </div>
            <div className="md:col-span-2">
              <FieldLabel htmlFor="doc-city">City / Area</FieldLabel>
              <Input
                id="doc-city"
                value={city}
                onChange={(e) => setCity(e.target.value)}
                placeholder="e.g. Pune, Delhi"
                className="mt-1 rounded-2xl bg-[#F8FAFC]"
              />
            </div>
            <div className="md:col-span-3 flex items-end gap-2">
              <Button type="button" variant="outline" onClick={handleRequestLocation} className="flex-1 rounded-2xl">
                <Navigation className="size-3.5 text-[#0066FF]" aria-hidden="true" />
                <span>Near Me</span>
              </Button>
              <Button type="button" variant="outline" onClick={() => setShowAdvanced((v) => !v)} className="rounded-2xl">
                <Filter className="size-3.5" aria-hidden="true" />
                <span>Filters</span>
              </Button>
            </div>
          </div>

          {geoStatus && <div className="text-xs text-[#0066FF]">{geoStatus}</div>}

          {showAdvanced && (
            <div className="grid gap-3 border-t border-[#EEF1F5] pt-4 sm:grid-cols-2 lg:grid-cols-6">
              <div>
                <FieldLabel htmlFor="f-pin">PIN Code</FieldLabel>
                <Input id="f-pin" value={pinCode} onChange={(e) => setPinCode(e.target.value)} placeholder="411001" className="mt-1 bg-[#F8FAFC]" />
              </div>
              <div>
                <FieldLabel htmlFor="f-fee">Max Fee (INR)</FieldLabel>
                <Input id="f-fee" type="number" min={0} value={maxFee} onChange={(e) => setMaxFee(e.target.value)} placeholder="1500" className="mt-1 bg-[#F8FAFC]" />
              </div>
              <div>
                <FieldLabel htmlFor="f-exp">Min Experience (yrs)</FieldLabel>
                <Input id="f-exp" type="number" min={0} value={minExp} onChange={(e) => setMinExp(e.target.value)} placeholder="5" className="mt-1 bg-[#F8FAFC]" />
              </div>
              <div>
                <FieldLabel htmlFor="f-date">Available Date</FieldLabel>
                <Input id="f-date" type="date" value={availDate} onChange={(e) => setAvailDate(e.target.value)} className="mt-1 bg-[#F8FAFC]" />
              </div>
              <div>
                <FieldLabel htmlFor="f-tod">Time of Day</FieldLabel>
                <Select id="f-tod" value={timeOfDay} onChange={(e) => setTimeOfDay(e.target.value)} className="mt-1 bg-[#F8FAFC]">
                  <option value="">Any Time</option>
                  <option value="morning">Morning (before 12 PM)</option>
                  <option value="afternoon">Afternoon (12–5 PM)</option>
                  <option value="evening">Evening (after 5 PM)</option>
                </Select>
              </div>
              <div>
                <FieldLabel htmlFor="f-mode">Consultation Mode</FieldLabel>
                <Select id="f-mode" value={mode} onChange={(e) => setMode(e.target.value)} className="mt-1 bg-[#F8FAFC]">
                  <option value="">In-Person or Online</option>
                  <option value="in_person">In-Person Only</option>
                  <option value="online">Online Only</option>
                </Select>
              </div>
              <div>
                <FieldLabel htmlFor="f-lang">Language</FieldLabel>
                <Input id="f-lang" value={language} onChange={(e) => setLanguage(e.target.value)} placeholder="English, Hindi" className="mt-1 bg-[#F8FAFC]" />
              </div>
              {coords && (
                <div>
                  <FieldLabel htmlFor="f-dist">Max Distance (km)</FieldLabel>
                  <Select id="f-dist" value={maxDistanceKm} onChange={(e) => setMaxDistanceKm(e.target.value)} className="mt-1 bg-[#F8FAFC]">
                    <option value="">Any Distance</option>
                    <option value="5">Within 5 km</option>
                    <option value="15">Within 15 km</option>
                    <option value="50">Within 50 km</option>
                  </Select>
                </div>
              )}
              <div className="flex items-end">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => {
                    setQ("");
                    setSpecialityId("");
                    setCity("");
                    setPinCode("");
                    setMaxFee("");
                    setMinExp("");
                    setAvailDate("");
                    setTimeOfDay("");
                    setMode("");
                    setLanguage("");
                    setMaxDistanceKm("");
                    setCoords(null);
                    setGeoStatus(null);
                  }}
                >
                  Clear Filters
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Search Results */}
      {searchError && <Alert variant="danger">{searchError}</Alert>}

      {loadingDocs ? (
        <LoadingState message="Searching verified clinicians and live schedules..." />
      ) : doctors.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Stethoscope}
              title="No doctors available for this search yet."
              description="Only administrator-verified clinicians appear here. Try clearing filters or ask a registered doctor profile to complete verification."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-5 md:grid-cols-2 lg:grid-cols-3">
          {doctors.map((doc) => {
            const clinic = doc.clinic;
            const mapsUrl = clinic
              ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${clinic.name} ${clinic.address} ${clinic.city} ${clinic.postal_code}`)}`
              : null;

            return (
              <Card key={doc.id} className="flex flex-col justify-between transition-all hover:border-[#0066FF]/40">
                <CardContent className="flex flex-col gap-4">
                  <div className="flex items-start gap-3.5">
                    {doc.photo_url ? (
                      <img
                        src={`/api${doc.photo_url.replace(/^\/api/, "")}`}
                        alt={doc.full_name}
                        className="size-16 rounded-2xl border border-[#E5E9F0] object-cover"
                      />
                    ) : (
                      <div className="flex size-16 shrink-0 items-center justify-center rounded-2xl bg-[#EFF6FF] font-display text-lg font-bold text-[#0066FF]">
                        {doc.full_name
                          .split(" ")
                          .map((n: string) => n[0])
                          .join("")
                          .slice(0, 2)
                          .toUpperCase()}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <h3 className="truncate font-display text-base font-semibold text-[#111827]">
                          {doc.full_name}
                        </h3>
                        <Badge variant="verified" className="shrink-0">
                          <ShieldCheck className="size-3" />
                          Verified
                        </Badge>
                      </div>
                      <div className="mt-0.5 text-xs font-semibold text-[#0066FF]">
                        {doc.primary_speciality?.name}
                      </div>
                      <div className="truncate text-[11px] text-[#64748B]">{doc.qualifications}</div>
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-2 rounded-2xl bg-[#F8FAFC] p-3 text-xs">
                    <div className="flex items-center gap-1.5 text-[#334155]">
                      <Award className="size-3.5 text-[#0066FF]" />
                      <span>{doc.experience_years} yrs exp.</span>
                    </div>
                    <div className="text-right font-semibold text-[#111827]">
                      ₹{doc.consultation_fee} fee
                    </div>
                    <div className="col-span-2 flex items-center gap-1.5 text-[#64748B]">
                      <Languages className="size-3.5 shrink-0 text-[#0066FF]" />
                      <span className="truncate">{(doc.languages || []).join(", ")}</span>
                    </div>
                    {clinic && (
                      <div className="col-span-2 flex items-start gap-1.5 text-[#475569]">
                        <MapPin className="mt-0.5 size-3.5 shrink-0 text-[#0066FF]" />
                        <span className="line-clamp-2">
                          {clinic.name} · {clinic.city} {doc.distance_km !== null ? `(${doc.distance_km} km)` : ""}
                        </span>
                      </div>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-1.5">
                      {doc.consultation_modes?.includes("in_person") && <Badge variant="neutral">In-Person</Badge>}
                      {doc.consultation_modes?.includes("online") && (
                        <Badge variant="teal">
                          <Video className="size-3" />
                          Online
                        </Badge>
                      )}
                    </div>
                    {doc.next_available_slot ? (
                      <span className="font-mono text-[11px] font-medium text-emerald-700">
                        Next: {doc.next_available_slot.date} {doc.next_available_slot.start_time}
                      </span>
                    ) : (
                      <span className="text-[11px] text-[#64748B]">No upcoming slots published</span>
                    )}
                  </div>
                </CardContent>

                <div className="flex flex-wrap items-center gap-2 border-t border-[#EEF1F5] px-6 py-3.5">
                  <Button size="sm" variant="outline" onClick={() => openDoctorProfile(doc.id, false)}>
                    View Profile
                  </Button>
                  <Button size="sm" onClick={() => openDoctorProfile(doc.id, true)}>
                    Book Appointment
                  </Button>
                  {mapsUrl && (
                    <a
                      href={mapsUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="ml-auto inline-flex items-center gap-1 text-[11px] font-medium text-[#0066FF] hover:underline"
                    >
                      <span>Directions</span>
                      <ExternalLink className="size-3" />
                    </a>
                  )}
                </div>
              </Card>
            );
          })}
        </div>
      )}

      {/* Detailed Doctor Profile & Appointment Booking Modal */}
      <Modal
        open={Boolean(selectedDoctor) || profileLoading}
        onClose={() => {
          setSelectedDoctor(null);
          setBookingStep("profile");
        }}
        title={selectedDoctor ? selectedDoctor.full_name : "Loading clinician profile..."}
        description={
          selectedDoctor
            ? `${selectedDoctor.primary_speciality?.name || ""} · ${selectedDoctor.qualifications} · Asia/Kolkata (IST)`
            : undefined
        }
        maxWidthClass="max-w-3xl"
      >
        {profileLoading || !selectedDoctor ? (
          <LoadingState message="Fetching live clinician details and availability..." />
        ) : (
          <div className="flex flex-col gap-5">
            {/* Step Nav */}
            <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[#EEF1F5] pb-3">
              <div className="flex flex-wrap gap-1.5">
                <button
                  type="button"
                  onClick={() => setBookingStep("profile")}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                    bookingStep === "profile" ? "bg-[#0066FF] text-white" : "bg-[#F3F5F8] text-[#475569]"
                  }`}
                >
                  1. Profile &amp; Working Hours
                </button>
                <button
                  type="button"
                  onClick={() => setBookingStep("slots")}
                  className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                    bookingStep === "slots" ? "bg-[#0066FF] text-white" : "bg-[#F3F5F8] text-[#475569]"
                  }`}
                >
                  2. Live Slots &amp; Mode
                </button>
                {selectedSlot && (
                  <button
                    type="button"
                    onClick={() => setBookingStep("confirm")}
                    className={`rounded-full px-3.5 py-1.5 text-xs font-semibold ${
                      bookingStep === "confirm" ? "bg-[#0066FF] text-white" : "bg-[#F3F5F8] text-[#475569]"
                    }`}
                  >
                    3. Review Summary
                  </button>
                )}
              </div>
              <button
                type="button"
                onClick={() => setReportDoctorId(selectedDoctor.id)}
                className="inline-flex items-center gap-1 text-xs text-[#64748B] hover:text-[#EF233C]"
              >
                <Flag className="size-3.5" />
                <span>Report Profile</span>
              </button>
            </div>

            {bookingError && <Alert variant="danger">{bookingError}</Alert>}

            {bookingStep === "profile" && (
              <div className="flex flex-col gap-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="rounded-2xl border border-[#E5E9F0] bg-[#F8FAFC] p-4 text-xs">
                    <div className="font-semibold text-[#111827]">Professional Credentials</div>
                    <div className="mt-2 flex flex-col gap-1 text-[#475569]">
                      <div>Speciality: <strong className="text-[#111827]">{selectedDoctor.primary_speciality?.name}</strong></div>
                      {selectedDoctor.secondary_specialities?.length > 0 && (
                        <div>Secondary: {selectedDoctor.secondary_specialities.map((s: any) => s.name).join(", ")}</div>
                      )}
                      <div>Experience: {selectedDoctor.experience_years} years</div>
                      <div>Registration: <span className="font-mono">{selectedDoctor.registration_number}</span> (Verified)</div>
                      <div>Languages: {(selectedDoctor.languages || []).join(", ")}</div>
                      <div>Consultation Fee: <strong>₹{selectedDoctor.consultation_fee}</strong></div>
                    </div>
                  </div>
                  <div className="rounded-2xl border border-[#E5E9F0] bg-[#F8FAFC] p-4 text-xs">
                    <div className="font-semibold text-[#111827]">Clinic &amp; Practice Location</div>
                    {selectedDoctor.clinic ? (
                      <div className="mt-2 flex flex-col gap-1 text-[#475569]">
                        <div className="font-semibold text-[#111827]">{selectedDoctor.clinic.name}</div>
                        <div>{selectedDoctor.clinic.address}</div>
                        <div>{selectedDoctor.clinic.city}, {selectedDoctor.clinic.state} — {selectedDoctor.clinic.postal_code}</div>
                        {selectedDoctor.clinic.contact_information && <div>Contact: {selectedDoctor.clinic.contact_information}</div>}
                        <a
                          href={`https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(
                            `${selectedDoctor.clinic.name} ${selectedDoctor.clinic.address} ${selectedDoctor.clinic.city}`
                          )}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="mt-1 inline-flex items-center gap-1 font-semibold text-[#0066FF] hover:underline"
                        >
                          <span>Open Clinic Directions</span>
                          <ExternalLink className="size-3" />
                        </a>
                      </div>
                    ) : (
                      <div className="mt-2 text-[#64748B]">Online / telehealth practice.</div>
                    )}
                  </div>
                </div>

                {selectedDoctor.biography && (
                  <div className="rounded-2xl border border-[#E5E9F0] bg-white p-4 text-xs leading-relaxed text-[#334155]">
                    <div className="mb-1 font-semibold text-[#111827]">Biography</div>
                    {selectedDoctor.biography}
                  </div>
                )}

                <div className="rounded-2xl border border-[#E5E9F0] bg-white p-4 text-xs">
                  <div className="mb-2 font-semibold text-[#111827]">Weekly Working Hours</div>
                  {selectedDoctor.working_hours?.length ? (
                    <div className="grid gap-1.5 sm:grid-cols-2">
                      {selectedDoctor.working_hours.map((wh: any, idx: number) => (
                        <div key={idx} className="flex items-center justify-between rounded-xl bg-[#F8FAFC] px-3 py-1.5">
                          <span className="font-semibold text-[#111827]">{WEEKDAY_NAMES[wh.weekday]}</span>
                          <span className="font-mono text-[#475569]">
                            {wh.start_time} – {wh.end_time} ({wh.slot_duration}m)
                          </span>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <div className="text-[#64748B]">No recurring weekly hours configured yet.</div>
                  )}
                </div>

                <div className="flex justify-end">
                  <Button onClick={() => setBookingStep("slots")}>
                    <Calendar className="size-4" />
                    <span>Book Appointment</span>
                  </Button>
                </div>
              </div>
            )}

            {bookingStep === "slots" && (
              <div className="flex flex-col gap-4">
                <div className="grid gap-3 sm:grid-cols-2">
                  <div>
                    <FieldLabel>Consultation Type</FieldLabel>
                    <div className="mt-1 flex gap-2">
                      {(selectedDoctor.consultation_modes || ["in_person"]).map((cm: "in_person" | "online") => (
                        <button
                          key={cm}
                          type="button"
                          onClick={() => {
                            setBookingMode(cm);
                            fetchSlotsForDoctor(selectedDoctor.id, bookingDate, cm);
                          }}
                          className={`flex-1 rounded-full border py-2 text-xs font-semibold transition-colors ${
                            bookingMode === cm
                              ? "border-[#0066FF] bg-[#0066FF] text-white"
                              : "border-[#E5E9F0] bg-[#F8FAFC] text-[#111827]"
                          }`}
                        >
                          {cm === "in_person" ? "In-Person Clinic Visit" : "Online Video Consultation"}
                        </button>
                      ))}
                    </div>
                  </div>
                  <div>
                    <FieldLabel htmlFor="book-date">Select Date (Asia/Kolkata)</FieldLabel>
                    <Input
                      id="book-date"
                      type="date"
                      min={upcomingDays[0]}
                      value={bookingDate}
                      onChange={(e) => {
                        setBookingDate(e.target.value);
                        fetchSlotsForDoctor(selectedDoctor.id, e.target.value, bookingMode);
                      }}
                      className="mt-1 bg-[#F8FAFC]"
                    />
                  </div>
                </div>

                <div className="flex gap-1.5 overflow-x-auto pb-1">
                  {upcomingDays.slice(0, 7).map((d) => (
                    <button
                      key={d}
                      type="button"
                      onClick={() => {
                        setBookingDate(d);
                        fetchSlotsForDoctor(selectedDoctor.id, d, bookingMode);
                      }}
                      className={`shrink-0 rounded-2xl border px-3 py-1.5 font-mono text-xs ${
                        bookingDate === d
                          ? "border-[#0066FF] bg-[#EFF6FF] font-semibold text-[#0066FF]"
                          : "border-[#E5E9F0] bg-white text-[#475569]"
                      }`}
                    >
                      {d}
                    </button>
                  ))}
                </div>

                {slotsLoading ? (
                  <LoadingState message="Checking live slot availability..." />
                ) : daySlots.length === 0 ? (
                  <Alert variant="info">
                    No free appointment slots on {bookingDate} ({dayStatus.replace("_", " ")}). Please try another date.
                  </Alert>
                ) : (
                  <div className="grid grid-cols-3 gap-2 sm:grid-cols-4 md:grid-cols-5">
                    {daySlots.map((sl) => (
                      <button
                        key={sl.start_time}
                        type="button"
                        disabled={!sl.is_available}
                        onClick={() => {
                          setSelectedSlot(sl);
                          setBookingStep("confirm");
                        }}
                        className={`flex flex-col items-center rounded-2xl border px-2 py-2.5 text-xs transition-all ${
                          !sl.is_available
                            ? "cursor-not-allowed border-[#E5E9F0] bg-slate-100 text-slate-400 line-through"
                            : selectedSlot?.start_time === sl.start_time
                            ? "border-[#0066FF] bg-[#0066FF] font-semibold text-white"
                            : "border-[#E5E9F0] bg-white font-semibold text-[#111827] hover:border-[#0066FF] hover:bg-[#EFF6FF]"
                        }`}
                      >
                        <span className="font-mono">{sl.start_time}</span>
                        <span className="text-[10px] opacity-75">{sl.is_available ? "Available" : sl.slot_status}</span>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {bookingStep === "confirm" && selectedSlot && (
              <div className="flex flex-col gap-4">
                <div className="rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF]/60 p-4 text-xs">
                  <div className="mb-2 font-display text-sm font-semibold text-[#111827]">Appointment Booking Summary</div>
                  <div className="grid gap-2 sm:grid-cols-2">
                    <div>Doctor: <strong>{selectedDoctor.full_name}</strong></div>
                    <div>Speciality: <strong>{selectedDoctor.primary_speciality?.name}</strong></div>
                    <div>Clinic: <strong>{selectedDoctor.clinic?.name || "Online Telehealth"}</strong></div>
                    <div>Consultation Mode: <strong>{bookingMode === "in_person" ? "In-Person" : "Online"}</strong></div>
                    <div>Date: <strong className="font-mono">{bookingDate}</strong></div>
                    <div>Time: <strong className="font-mono">{selectedSlot.start_time} – {selectedSlot.end_time} IST</strong></div>
                    <div>Fee: <strong>₹{selectedDoctor.consultation_fee}</strong></div>
                    <div>Confirmation Mode: <strong>{selectedDoctor.auto_confirm ? "Instant Confirmation" : "Pending Doctor Approval"}</strong></div>
                  </div>
                </div>

                <div>
                  <FieldLabel htmlFor="patient-notes">Optional Reason / Symptoms Note for Doctor</FieldLabel>
                  <Textarea
                    id="patient-notes"
                    rows={3}
                    value={patientNotes}
                    onChange={(e) => setPatientNotes(e.target.value)}
                    placeholder="Briefly note your reason for visit (separate from your Medical Vault unless you explicitly share records)..."
                    className="mt-1 bg-[#F8FAFC]"
                  />
                </div>

                <div className="flex justify-between gap-2">
                  <Button variant="outline" onClick={() => setBookingStep("slots")}>
                    Change Slot
                  </Button>
                  <Button onClick={handleConfirmBooking} disabled={bookingBusy}>
                    <CheckCircle2 className="size-4" />
                    <span>{bookingBusy ? "Confirming Slot..." : "Confirm Appointment"}</span>
                  </Button>
                </div>
              </div>
            )}

            {bookingStep === "done" && bookedAppt && (
              <div className="flex flex-col gap-4">
                <Alert variant="success" title={`Appointment ${bookedAppt.appointment_status === "confirmed" ? "Confirmed" : "Submitted (Pending Approval)"}`}>
                  Booked with <strong>{bookedAppt.doctor_name}</strong> on{" "}
                  <span className="font-mono">{bookedAppt.appointment_date}</span> at{" "}
                  <span className="font-mono">{bookedAppt.start_time} IST</span>.
                </Alert>

                <div className="rounded-2xl border border-[#E5E9F0] bg-[#F8FAFC] p-4 text-xs">
                  <div className="font-semibold text-[#111827]">Optional: Medical History Sharing</div>
                  <p className="mt-1 text-[#475569]">
                    Booking an appointment does NOT expose your private Medical Vault to the clinician. You may optionally select specific documents or your One-Minute Doctor Summary to share securely.
                  </p>
                  <div className="mt-3 flex flex-wrap gap-2">
                    <Button size="sm" onClick={openShareModal}>
                      <Share2 className="size-4" />
                      <span>Share Medical Summary with Doctor</span>
                    </Button>
                    <Link
                      to="/patient/appointments"
                      className="inline-flex min-h-[40px] items-center rounded-full border border-[#E5E9F0] bg-white px-4 text-xs font-semibold text-[#111827] hover:bg-[#EFF6FF]"
                    >
                      Go to My Appointments
                    </Link>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </Modal>

      {/* Optional Medical Summary Sharing Modal */}
      <Modal
        open={shareModalOpen}
        onClose={() => setShareModalOpen(false)}
        title="Share Medical Summary with Doctor"
        description="Explicit patient consent control — select exact vault files and review before sharing."
      >
        <form onSubmit={handleShareRecordsSubmit} className="flex flex-col gap-4">
          {shareError && <Alert variant="danger">{shareError}</Alert>}
          {shareResult ? (
            <Alert variant="success" title="Selected Records Shared">
              Created scoped share session ({shareResult.document_count} document(s), expires{" "}
              {formatDate(shareResult.expires_at)}). Manage or revoke anytime in{" "}
              <Link to="/patient/share" className="font-semibold underline">
                Share Medical Records
              </Link>
              .
            </Alert>
          ) : vaultDocs.length === 0 ? (
            <EmptyState
              icon={FolderLock}
              title="Your Medical Vault is empty"
              description="Upload and verify lab reports or prescriptions in My Medical Vault first, or proceed without sharing."
            />
          ) : (
            <>
              <div className="flex max-h-52 flex-col gap-2 overflow-y-auto rounded-2xl border border-[#E5E9F0] bg-[#F8FAFC] p-3">
                {vaultDocs.map((doc) => {
                  const checked = selectedDocIds.includes(doc.id);
                  return (
                    <label
                      key={doc.id}
                      className="flex items-center justify-between gap-2 rounded-xl border border-[#E5E9F0] bg-white px-3 py-2 text-xs"
                    >
                      <span className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() =>
                            setSelectedDocIds((prev) =>
                              checked ? prev.filter((id) => id !== doc.id) : [...prev, doc.id]
                            )
                          }
                          className="accent-[#0066FF]"
                        />
                        <span className="font-semibold text-[#111827]">{doc.title}</span>
                      </span>
                      <span className="text-[#64748B]">{CATEGORY_LABELS[doc.category] || doc.category}</span>
                    </label>
                  );
                })}
              </div>

              <label className="flex items-center gap-2 text-xs text-[#111827]">
                <input
                  type="checkbox"
                  checked={includeSummary}
                  onChange={(e) => setIncludeSummary(e.target.checked)}
                  className="accent-[#0066FF]"
                />
                <span>Generate &amp; attach latest One-Minute Doctor Summary</span>
              </label>

              <div>
                <FieldLabel htmlFor="share-pin">Optional 4–8 Digit Security PIN</FieldLabel>
                <Input
                  id="share-pin"
                  value={sharePin}
                  onChange={(e) => setSharePin(e.target.value)}
                  placeholder="Optional PIN (e.g. 4321)"
                  className="mt-1 bg-[#F8FAFC]"
                />
              </div>

              <label className="flex items-start gap-2 rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] p-3 text-xs text-[#111827]">
                <input
                  type="checkbox"
                  checked={shareConsent}
                  onChange={(e) => setShareConsent(e.target.checked)}
                  className="mt-0.5 accent-[#0066FF]"
                />
                <span>
                  I explicitly consent to share only the selected medical documents above with this booked clinician for consultation review. I understand I can revoke access anytime.
                </span>
              </label>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShareModalOpen(false)}>
                  Skip
                </Button>
                <Button type="submit" disabled={shareBusy || !shareConsent || selectedDocIds.length === 0}>
                  <Share2 className="size-4" />
                  <span>{shareBusy ? "Sharing..." : "Confirm & Share Records"}</span>
                </Button>
              </div>
            </>
          )}
        </form>
      </Modal>

      {/* Report Doctor Modal */}
      <Modal
        open={reportDoctorId !== null}
        onClose={() => setReportDoctorId(null)}
        title="Report Clinician Profile"
        description="Flag inaccurate credentials or suspicious practice details for administrator audit."
      >
        <form onSubmit={handleReportSubmit} className="flex flex-col gap-4">
          <div>
            <FieldLabel htmlFor="rep-reason">Reason for Report</FieldLabel>
            <Textarea
              id="rep-reason"
              rows={3}
              required
              value={reportReason}
              onChange={(e) => setReportReason(e.target.value)}
              placeholder="Describe the concern..."
              className="mt-1 bg-[#F8FAFC]"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setReportDoctorId(null)}>
              Cancel
            </Button>
            <Button type="submit" variant="destructive">
              Submit Report
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
