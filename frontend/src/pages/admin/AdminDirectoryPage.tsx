import React, { useCallback, useEffect, useState } from "react";
import { Building2, Calendar, CheckCircle2, Flag, ShieldCheck, Stethoscope, XCircle } from "lucide-react";
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
} from "@/components/ui/primitives";
import { apiFetch } from "@/lib/api";

export function AdminDirectoryPage() {
  const [data, setData] = useState<any>(null);
  const [appts, setAppts] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tab, setTab] = useState<"doctors" | "specialities" | "clinics" | "appointments">("doctors");

  const [verifyNotes, setVerifyNotes] = useState<Record<number, string>>({});

  // Add Speciality form
  const [specName, setSpecName] = useState("");
  const [specCat, setSpecCat] = useState("Medical");
  const [specDesc, setSpecDesc] = useState("");

  // Add Clinic form
  const [cName, setCName] = useState("");
  const [cAddr, setCAddr] = useState("");
  const [cCity, setCCity] = useState("");
  const [cState, setCState] = useState("");
  const [cPin, setCPin] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dir, apptRes] = await Promise.all([
        apiFetch("/admin/directory/overview"),
        apiFetch("/admin/appointments"),
      ]);
      setData(dir);
      setAppts(apptRes.appointments || []);
    } catch (err: any) {
      setError(err?.message || "Failed to load admin directory.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleVerifyDoctor = async (docId: number, status: "verified" | "rejected" | "suspended") => {
    try {
      await apiFetch(`/admin/doctors/${docId}/verify`, {
        method: "POST",
        body: JSON.stringify({
          status,
          notes: verifyNotes[docId] || undefined,
          allow_secondary_specialities: true,
        }),
      });
      setNotice(`Doctor #${docId} updated to '${status}'.`);
      await load();
    } catch (err: any) {
      setError(err?.message || "Verification action failed.");
    }
  };

  const handleAddSpeciality = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/admin/specialities", {
        method: "POST",
        body: JSON.stringify({ name: specName, category: specCat, description: specDesc, is_active: true }),
      });
      setSpecName("");
      setSpecDesc("");
      setNotice("Speciality added.");
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not create speciality.");
    }
  };

  const handleAddClinic = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await apiFetch("/admin/clinics", {
        method: "POST",
        body: JSON.stringify({ name: cName, address: cAddr, city: cCity, state: cState, postal_code: cPin }),
      });
      setCName("");
      setCAddr("");
      setCCity("");
      setCState("");
      setCPin("");
      setNotice("Clinic record created.");
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not create clinic.");
    }
  };

  const handleResolveReport = async (repId: number) => {
    try {
      await apiFetch(`/admin/reports/${repId}/resolve`, {
        method: "POST",
        body: JSON.stringify({ status: "resolved", admin_notes: "Reviewed by administrator" }),
      });
      setNotice("Report resolved.");
      await load();
    } catch (err: any) {
      setError(err?.message || "Could not resolve report.");
    }
  };

  if (loading) return <LoadingState message="Loading Doctor Verification & Directory Console..." />;
  if (error && !data) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-col gap-3 rounded-3xl border border-[#E5E9F0] bg-white p-6 shadow-[0_12px_32px_-16px_rgba(15,23,42,0.08)] sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full bg-[#EFF6FF] px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#0066FF]">
            <ShieldCheck className="size-3.5" />
            <span>Directory Governance</span>
          </div>
          <h1 className="mt-1.5 font-display text-2xl font-semibold text-[#111827]">
            Doctor Verification &amp; Healthcare Directory
          </h1>
          <p className="text-sm text-[#64748B]">
            Verify practitioner registrations before patient discovery, manage specialities and clinics, and monitor platform booking metrics.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Badge variant="neutral">Doctors: {data?.doctors?.length || 0}</Badge>
          <Badge variant="teal">Bookings: {data?.appointment_stats?.total || 0}</Badge>
        </div>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}
      {notice && <Alert variant="success">{notice}</Alert>}

      <div className="flex flex-wrap gap-2">
        {[
          { key: "doctors", label: `Doctor Verification (${data?.doctors?.length || 0})` },
          { key: "specialities", label: `Specialities (${data?.specialities?.length || 0})` },
          { key: "clinics", label: `Clinics (${data?.clinics?.length || 0})` },
          { key: "appointments", label: `Appointment Monitoring (${appts.length})` },
        ].map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => setTab(t.key as any)}
            className={`rounded-full px-4 py-2 text-xs font-semibold transition-all ${
              tab === t.key ? "bg-[#0066FF] text-white" : "border border-[#E5E9F0] bg-white text-[#475569]"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === "doctors" && (
        <div className="flex flex-col gap-6">
          <Card>
            <CardHeader>
              <CardTitle>Doctor Applications &amp; Registered Profiles</CardTitle>
              <CardDescription>Only 'verified' profiles are visible to patients in Find a Doctor.</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {data.doctors.length === 0 ? (
                <EmptyState icon={Stethoscope} title="No doctor applications yet." description="When clinicians register and submit profiles, they appear here for verification." />
              ) : (
                data.doctors.map((d: any) => (
                  <div key={d.id} className="flex flex-col gap-3 rounded-2xl border border-[#E5E9F0] bg-[#F8FAFC] p-4">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <div className="flex items-center gap-2">
                          <span className="font-display text-base font-semibold text-[#111827]">{d.full_name}</span>
                          <Badge
                            variant={
                              d.verification_status === "verified"
                                ? "verified"
                                : d.verification_status === "pending_verification"
                                ? "moderate"
                                : "critical"
                            }
                          >
                            {d.verification_status}
                          </Badge>
                        </div>
                        <div className="text-xs text-[#475569]">
                          {d.primary_speciality?.name} · {d.qualifications} · Reg: <span className="font-mono">{d.registration_number_masked}</span> · {d.experience_years} yrs · ₹{d.consultation_fee}
                        </div>
                        {d.clinic && (
                          <div className="text-xs text-[#64748B]">
                            Clinic: {d.clinic.name}, {d.clinic.city} ({d.clinic.postal_code})
                          </div>
                        )}
                      </div>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Input
                        value={verifyNotes[d.id] ?? ""}
                        onChange={(e) => setVerifyNotes((prev) => ({ ...prev, [d.id]: e.target.value }))}
                        placeholder="Verification review note (optional)..."
                        className="max-w-xs bg-white text-xs"
                      />
                      <Button size="sm" onClick={() => handleVerifyDoctor(d.id, "verified")}>
                        <CheckCircle2 className="size-3.5" />
                        <span>Approve &amp; Verify</span>
                      </Button>
                      <Button size="sm" variant="outline" onClick={() => handleVerifyDoctor(d.id, "rejected")}>
                        <XCircle className="size-3.5" />
                        <span>Reject</span>
                      </Button>
                      <Button size="sm" variant="destructive" onClick={() => handleVerifyDoctor(d.id, "suspended")}>
                        Suspend
                      </Button>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          {data.reports?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2">
                  <Flag className="size-4 text-[#EF233C]" />
                  <span>Reported Profiles ({data.reports.length})</span>
                </CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-2">
                {data.reports.map((r: any) => (
                  <div key={r.id} className="flex items-center justify-between rounded-2xl border border-[#E5E9F0] bg-[#F8FAFC] p-3 text-xs">
                    <div>
                      <strong>Doctor #{r.doctor_id}</strong> — {r.reason}{" "}
                      <Badge variant={r.status === "open" ? "critical" : "verified"}>{r.status}</Badge>
                    </div>
                    {r.status === "open" && (
                      <Button size="sm" variant="outline" onClick={() => handleResolveReport(r.id)}>
                        Mark Resolved
                      </Button>
                    )}
                  </div>
                ))}
              </CardContent>
            </Card>
          )}
        </div>
      )}

      {tab === "specialities" && (
        <div className="grid gap-6 lg:grid-cols-12">
          <Card className="lg:col-span-5">
            <CardHeader>
              <CardTitle>Add Controlled Speciality</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddSpeciality} className="flex flex-col gap-3">
                <div>
                  <FieldLabel htmlFor="sp-n">Name</FieldLabel>
                  <Input id="sp-n" required value={specName} onChange={(e) => setSpecName(e.target.value)} className="mt-1 bg-[#F8FAFC]" />
                </div>
                <div>
                  <FieldLabel htmlFor="sp-c">Category</FieldLabel>
                  <Input id="sp-c" required value={specCat} onChange={(e) => setSpecCat(e.target.value)} className="mt-1 bg-[#F8FAFC]" />
                </div>
                <div>
                  <FieldLabel htmlFor="sp-d">Description</FieldLabel>
                  <Input id="sp-d" required value={specDesc} onChange={(e) => setSpecDesc(e.target.value)} className="mt-1 bg-[#F8FAFC]" />
                </div>
                <Button type="submit">Add Speciality</Button>
              </form>
            </CardContent>
          </Card>
          <Card className="lg:col-span-7">
            <CardHeader>
              <CardTitle>Speciality Catalogue</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2 sm:grid-cols-2">
              {data.specialities.map((s: any) => (
                <div key={s.id} className="rounded-2xl border border-[#E5E9F0] bg-[#F8FAFC] p-3 text-xs">
                  <div className="font-semibold text-[#111827]">{s.name}</div>
                  <div className="text-[11px] text-[#0066FF]">{s.category}</div>
                  <div className="mt-1 text-[#64748B]">{s.description}</div>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "clinics" && (
        <div className="grid gap-6 lg:grid-cols-12">
          <Card className="lg:col-span-5">
            <CardHeader>
              <CardTitle>Add Clinic Record</CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleAddClinic} className="flex flex-col gap-3">
                <Input required placeholder="Clinic name" value={cName} onChange={(e) => setCName(e.target.value)} className="bg-[#F8FAFC]" />
                <Input required placeholder="Address" value={cAddr} onChange={(e) => setCAddr(e.target.value)} className="bg-[#F8FAFC]" />
                <div className="grid grid-cols-2 gap-2">
                  <Input required placeholder="City" value={cCity} onChange={(e) => setCCity(e.target.value)} className="bg-[#F8FAFC]" />
                  <Input required placeholder="State" value={cState} onChange={(e) => setCState(e.target.value)} className="bg-[#F8FAFC]" />
                </div>
                <Input required placeholder="Postal code" value={cPin} onChange={(e) => setCPin(e.target.value)} className="bg-[#F8FAFC]" />
                <Button type="submit">Create Clinic</Button>
              </form>
            </CardContent>
          </Card>
          <Card className="lg:col-span-7">
            <CardHeader>
              <CardTitle>Registered Clinics</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2">
              {data.clinics.length === 0 ? (
                <EmptyState icon={Building2} title="No clinics registered yet." description="Clinics added by admins or verified doctors appear here." />
              ) : (
                data.clinics.map((c: any) => (
                  <div key={c.id} className="rounded-2xl border border-[#E5E9F0] bg-[#F8FAFC] p-3 text-xs">
                    <div className="font-semibold text-[#111827]">{c.name}</div>
                    <div className="text-[#475569]">{c.address}, {c.city}, {c.state} — {c.postal_code}</div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>
        </div>
      )}

      {tab === "appointments" && (
        <Card>
          <CardHeader>
            <CardTitle>Platform Appointment Monitoring (De-identified Vault Scope)</CardTitle>
          </CardHeader>
          <CardContent>
            {appts.length === 0 ? (
              <EmptyState icon={Calendar} title="No appointments booked yet." description="Real patient appointments will populate here as bookings occur." />
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead className="border-b border-[#E5E9F0] text-[#64748B]">
                    <tr>
                      <th className="py-2">ID</th>
                      <th className="py-2">Doctor ID</th>
                      <th className="py-2">Date</th>
                      <th className="py-2">Time (IST)</th>
                      <th className="py-2">Mode</th>
                      <th className="py-2">Status</th>
                      <th className="py-2">Fee</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-[#EEF1F5]">
                    {appts.map((a) => (
                      <tr key={a.id}>
                        <td className="py-2 font-mono">#{a.id}</td>
                        <td className="py-2 font-mono">Dr #{a.doctor_id}</td>
                        <td className="py-2 font-mono">{a.appointment_date}</td>
                        <td className="py-2 font-mono">{a.start_time}–{a.end_time}</td>
                        <td className="py-2">{a.consultation_type}</td>
                        <td className="py-2"><Badge variant="teal">{a.appointment_status}</Badge></td>
                        <td className="py-2">₹{a.consultation_fee}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
