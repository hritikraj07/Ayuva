import React, { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Calendar,
  Clock,
  FolderLock,
  MapPin,
  RefreshCw,
  Share2,
  Stethoscope,
  Video,
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
  Modal,
  Textarea,
} from "@/components/ui/primitives";
import { apiFetch } from "@/lib/api";
import { CATEGORY_LABELS, formatDate } from "@/lib/utils";

const STATUS_BADGE: Record<string, "verified" | "moderate" | "critical" | "neutral" | "teal"> = {
  confirmed: "verified",
  pending: "moderate",
  rejected: "critical",
  cancelled: "neutral",
  completed: "teal",
  rescheduled: "neutral",
};

export function MyAppointmentsPage() {
  const [data, setData] = useState<{ upcoming: any[]; past: any[] }>({ upcoming: [], past: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tab, setTab] = useState<"upcoming" | "past">("upcoming");
  const [notice, setNotice] = useState<string | null>(null);

  // Cancel modal
  const [cancelTarget, setCancelTarget] = useState<any>(null);
  const [cancelReason, setCancelReason] = useState("");
  const [actionBusy, setActionBusy] = useState(false);

  // Reschedule modal
  const [reschedTarget, setReschedTarget] = useState<any>(null);
  const [reschedDate, setReschedDate] = useState("");
  const [reschedSlots, setReschedSlots] = useState<any[]>([]);
  const [reschedSlotTime, setReschedSlotTime] = useState("");
  const [reschedReason, setReschedReason] = useState("");

  // Share records modal
  const [shareTarget, setShareTarget] = useState<any>(null);
  const [vaultDocs, setVaultDocs] = useState<any[]>([]);
  const [selectedDocIds, setSelectedDocIds] = useState<number[]>([]);
  const [includeSummary, setIncludeSummary] = useState(true);
  const [sharePin, setSharePin] = useState("");
  const [shareConsent, setShareConsent] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/appointments/my");
      setData({ upcoming: res.upcoming || [], past: res.past || [] });
    } catch (err: any) {
      setError(err?.message || "Failed to load appointments.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleCancelSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!cancelTarget) return;
    setActionBusy(true);
    setError(null);
    try {
      await apiFetch(`/appointments/${cancelTarget.id}/cancel`, {
        method: "POST",
        body: JSON.stringify({ reason: cancelReason.trim() || undefined }),
      });
      setNotice("Appointment cancelled and slot released.");
      setCancelTarget(null);
      setCancelReason("");
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not cancel appointment.");
    } finally {
      setActionBusy(false);
    }
  };

  const loadSlotsForReschedule = async (doctorId: number, dateStr: string, mode: string) => {
    try {
      const res = await apiFetch(`/doctors/${doctorId}/availability?date=${dateStr}&consultation_type=${mode}`);
      setReschedSlots((res.slots || []).filter((s: any) => s.is_available));
    } catch {
      setReschedSlots([]);
    }
  };

  const openReschedule = async (appt: any) => {
    setReschedTarget(appt);
    setReschedDate(appt.appointment_date);
    setReschedSlotTime("");
    setReschedReason("");
    await loadSlotsForReschedule(appt.doctor_id, appt.appointment_date, appt.consultation_type);
  };

  const handleRescheduleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!reschedTarget || !reschedSlotTime) return;
    setActionBusy(true);
    setError(null);
    try {
      await apiFetch(`/appointments/${reschedTarget.id}/reschedule`, {
        method: "POST",
        body: JSON.stringify({
          appointment_date: reschedDate,
          start_time: reschedSlotTime,
          reason: reschedReason.trim() || undefined,
        }),
      });
      setNotice(`Appointment rescheduled to ${reschedDate} at ${reschedSlotTime} IST.`);
      setReschedTarget(null);
      await load();
    } catch (err: any) {
      setError(err?.message || "Rescheduling failed.");
    } finally {
      setActionBusy(false);
    }
  };

  const openShareModal = async (appt: any) => {
    setShareTarget(appt);
    setShareConsent(false);
    setSharePin("");
    try {
      const res = await apiFetch("/vault/documents");
      const docs = res.documents || [];
      setVaultDocs(docs);
      setSelectedDocIds(docs.slice(0, 3).map((d: any) => d.id));
    } catch (err: any) {
      setError(err?.message || "Could not load vault documents.");
    }
  };

  const handleShareSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!shareTarget || !shareConsent || selectedDocIds.length === 0) return;
    setActionBusy(true);
    try {
      await apiFetch(`/appointments/${shareTarget.id}/share-records`, {
        method: "POST",
        body: JSON.stringify({
          document_ids: selectedDocIds,
          include_summary: includeSummary,
          expiry_minutes: 180,
          pin: sharePin.trim() || undefined,
        }),
      });
      setNotice(`Shared ${selectedDocIds.length} document(s) securely with ${shareTarget.doctor_name}.`);
      setShareTarget(null);
      await load();
    } catch (err: any) {
      setError(err?.message || "Failed to share records.");
    } finally {
      setActionBusy(false);
    }
  };

  if (loading) return <LoadingState message="Loading your consultations..." />;

  const items = tab === "upcoming" ? data.upcoming : data.past;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-4 rounded-3xl border border-[#E5E9F0] bg-white p-6 shadow-[0_12px_32px_-16px_rgba(15,23,42,0.08)] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-semibold text-[#111827]">My Appointments</h1>
          <p className="text-sm text-[#64748B]">
            Track upcoming consultations, reschedule or cancel within notice rules, and share selected Medical Vault records securely.
          </p>
        </div>
        <Link
          to="/patient/doctors"
          className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[#0066FF] px-5 text-sm font-semibold text-white shadow-[0_10px_22px_-10px_rgba(0,102,255,0.6)] hover:bg-[#0052CC]"
        >
          <Stethoscope className="size-4" aria-hidden="true" />
          <span>Find a Doctor</span>
        </Link>
      </div>

      {error && <ErrorState message={error} onRetry={load} />}
      {notice && <Alert variant="success">{notice}</Alert>}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => setTab("upcoming")}
          className={`rounded-full px-5 py-2 text-xs font-semibold transition-all ${
            tab === "upcoming" ? "bg-[#0066FF] text-white shadow-xs" : "border border-[#E5E9F0] bg-white text-[#475569]"
          }`}
        >
          Upcoming ({data.upcoming.length})
        </button>
        <button
          type="button"
          onClick={() => setTab("past")}
          className={`rounded-full px-5 py-2 text-xs font-semibold transition-all ${
            tab === "past" ? "bg-[#0066FF] text-white shadow-xs" : "border border-[#E5E9F0] bg-white text-[#475569]"
          }`}
        >
          Previous &amp; Closed ({data.past.length})
        </button>
      </div>

      {items.length === 0 ? (
        <Card>
          <CardContent>
            <EmptyState
              icon={Calendar}
              title="No appointments scheduled."
              description="Explore verified clinicians in Find a Doctor to schedule a consultation."
            />
          </CardContent>
        </Card>
      ) : (
        <div className="grid gap-4">
          {items.map((appt) => (
            <Card key={appt.id}>
              <CardContent className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                <div className="flex flex-col gap-1.5">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-display text-base font-semibold text-[#111827]">{appt.doctor_name}</span>
                    <Badge variant={STATUS_BADGE[appt.appointment_status] || "neutral"}>
                      {appt.appointment_status}
                    </Badge>
                    {appt.share_session_id && <Badge variant="teal">Records Shared</Badge>}
                  </div>
                  <div className="text-xs font-medium text-[#0066FF]">
                    {appt.doctor_speciality} · {appt.doctor_qualifications}
                  </div>
                  <div className="flex flex-wrap items-center gap-4 text-xs text-[#475569]">
                    <span className="flex items-center gap-1 font-mono font-semibold text-[#111827]">
                      <Calendar className="size-3.5 text-[#0066FF]" />
                      {appt.appointment_date}
                    </span>
                    <span className="flex items-center gap-1 font-mono font-semibold text-[#111827]">
                      <Clock className="size-3.5 text-[#0066FF]" />
                      {appt.start_time} – {appt.end_time} IST
                    </span>
                    <span className="flex items-center gap-1">
                      {appt.consultation_type === "online" ? <Video className="size-3.5 text-[#0066FF]" /> : <MapPin className="size-3.5 text-[#0066FF]" />}
                      {appt.consultation_type === "online" ? "Online Video" : appt.clinic?.name || "Clinic Visit"}
                    </span>
                    <span className="font-semibold text-[#111827]">₹{appt.consultation_fee}</span>
                  </div>
                  {appt.cancellation_reason && (
                    <div className="text-xs text-[#64748B]">Note: {appt.cancellation_reason}</div>
                  )}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  {["pending", "confirmed"].includes(appt.appointment_status) && (
                    <>
                      <Button size="sm" variant="outline" onClick={() => openShareModal(appt)}>
                        <Share2 className="size-3.5 text-[#0066FF]" />
                        <span>Share Medical Summary with Doctor</span>
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => openReschedule(appt)}>
                        <RefreshCw className="size-3.5" />
                        <span>Reschedule</span>
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => setCancelTarget(appt)}>
                        <XCircle className="size-3.5" />
                        <span>Cancel</span>
                      </Button>
                    </>
                  )}
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Cancel Modal */}
      <Modal
        open={Boolean(cancelTarget)}
        onClose={() => setCancelTarget(null)}
        title="Cancel Appointment"
        description={cancelTarget ? `${cancelTarget.doctor_name} on ${cancelTarget.appointment_date} at ${cancelTarget.start_time} IST` : undefined}
      >
        <form onSubmit={handleCancelSubmit} className="flex flex-col gap-4">
          <p className="text-xs text-[#64748B]">Cancellation requires at least 60 minutes notice before the scheduled slot.</p>
          <div>
            <FieldLabel htmlFor="cancel-reason">Cancellation Reason (Optional)</FieldLabel>
            <Textarea
              id="cancel-reason"
              rows={2}
              value={cancelReason}
              onChange={(e) => setCancelReason(e.target.value)}
              placeholder="Schedule conflict..."
              className="mt-1 bg-[#F8FAFC]"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setCancelTarget(null)}>
              Keep Appointment
            </Button>
            <Button type="submit" variant="destructive" disabled={actionBusy}>
              Confirm Cancel
            </Button>
          </div>
        </form>
      </Modal>

      {/* Reschedule Modal */}
      <Modal
        open={Boolean(reschedTarget)}
        onClose={() => setReschedTarget(null)}
        title="Reschedule Appointment"
        description={reschedTarget ? `Moving booking with ${reschedTarget.doctor_name}` : undefined}
      >
        <form onSubmit={handleRescheduleSubmit} className="flex flex-col gap-4">
          <div>
            <FieldLabel htmlFor="resched-date">New Date (Asia/Kolkata)</FieldLabel>
            <Input
              id="resched-date"
              type="date"
              value={reschedDate}
              onChange={(e) => {
                setReschedDate(e.target.value);
                if (reschedTarget) loadSlotsForReschedule(reschedTarget.doctor_id, e.target.value, reschedTarget.consultation_type);
              }}
              className="mt-1 bg-[#F8FAFC]"
            />
          </div>
          <div>
            <FieldLabel>Available Free Slots</FieldLabel>
            {reschedSlots.length === 0 ? (
              <p className="mt-1 text-xs text-[#64748B]">No available slots on this date.</p>
            ) : (
              <div className="mt-1.5 grid grid-cols-3 gap-2 sm:grid-cols-4">
                {reschedSlots.map((s) => (
                  <button
                    key={s.start_time}
                    type="button"
                    onClick={() => setReschedSlotTime(s.start_time)}
                    className={`rounded-2xl border py-2 font-mono text-xs font-semibold ${
                      reschedSlotTime === s.start_time
                        ? "border-[#0066FF] bg-[#0066FF] text-white"
                        : "border-[#E5E9F0] bg-[#F8FAFC] text-[#111827]"
                    }`}
                  >
                    {s.start_time}
                  </button>
                ))}
              </div>
            )}
          </div>
          <div>
            <FieldLabel htmlFor="resched-reason">Reason (Optional)</FieldLabel>
            <Input
              id="resched-reason"
              value={reschedReason}
              onChange={(e) => setReschedReason(e.target.value)}
              className="mt-1 bg-[#F8FAFC]"
            />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => setReschedTarget(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={actionBusy || !reschedSlotTime}>
              Confirm Reschedule
            </Button>
          </div>
        </form>
      </Modal>

      {/* Share Records Modal */}
      <Modal
        open={Boolean(shareTarget)}
        onClose={() => setShareTarget(null)}
        title="Share Medical Summary with Doctor"
        description={shareTarget ? `Explicit consent to share selected vault records with ${shareTarget.doctor_name}` : undefined}
      >
        <form onSubmit={handleShareSubmit} className="flex flex-col gap-4">
          {vaultDocs.length === 0 ? (
            <EmptyState
              icon={FolderLock}
              title="No documents in your Medical Vault"
              description="Upload and verify records in My Medical Vault first."
            />
          ) : (
            <>
              <div className="flex max-h-48 flex-col gap-2 overflow-y-auto rounded-2xl border border-[#E5E9F0] bg-[#F8FAFC] p-3">
                {vaultDocs.map((doc) => {
                  const checked = selectedDocIds.includes(doc.id);
                  return (
                    <label key={doc.id} className="flex items-center justify-between gap-2 rounded-xl border border-[#E5E9F0] bg-white px-3 py-2 text-xs">
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
                <span>Include latest One-Minute Doctor Summary</span>
              </label>

              <div>
                <FieldLabel htmlFor="my-share-pin">Optional Security PIN (4–8 digits)</FieldLabel>
                <Input id="my-share-pin" value={sharePin} onChange={(e) => setSharePin(e.target.value)} className="mt-1 bg-[#F8FAFC]" />
              </div>

              <label className="flex items-start gap-2 rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] p-3 text-xs text-[#111827]">
                <input
                  type="checkbox"
                  checked={shareConsent}
                  onChange={(e) => setShareConsent(e.target.checked)}
                  className="mt-0.5 accent-[#0066FF]"
                />
                <span>I grant explicit consent for this clinician to inspect only the selected records above during this consultation window.</span>
              </label>

              <div className="flex justify-end gap-2">
                <Button variant="outline" onClick={() => setShareTarget(null)}>
                  Cancel
                </Button>
                <Button type="submit" disabled={actionBusy || !shareConsent || selectedDocIds.length === 0}>
                  Share Selected Records
                </Button>
              </div>
            </>
          )}
        </form>
      </Modal>
    </div>
  );
}
