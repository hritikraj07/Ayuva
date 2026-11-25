import React, { useCallback, useEffect, useMemo, useState } from "react";
import { CalendarClock, Eye, Pill, Plus, Search } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
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
  Select,
} from "@/components/ui/primitives";
import { apiFetch, fetchAuthenticatedObjectUrl } from "@/lib/api";
import { CATEGORY_LABELS, formatDate } from "@/lib/utils";

export function MedicalTimelinePage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState("all");
  const [doctor, setDoctor] = useState("");
  const [condition, setCondition] = useState("");
  const [search, setSearch] = useState("");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  const [selectedLabTest, setSelectedLabTest] = useState("");

  // Event detail / linked document preview
  const [detailEvent, setDetailEvent] = useState<any>(null);
  const [docPreviewUrl, setDocPreviewUrl] = useState<string | null>(null);
  const [docPreviewType, setDocPreviewType] = useState<string>("");

  // Quick manual entry modals
  const [addKind, setAddKind] = useState<"condition" | "medication" | "allergy" | null>(null);
  const [formState, setFormState] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);

  const loadTimeline = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (category !== "all") params.set("category", category);
      if (doctor.trim()) params.set("doctor", doctor.trim());
      if (condition.trim()) params.set("condition", condition.trim());
      if (search.trim()) params.set("search", search.trim());
      if (dateFrom) params.set("date_from", dateFrom);
      if (dateTo) params.set("date_to", dateTo);
      const res = await apiFetch(`/vault/timeline?${params.toString()}`);
      setData(res);
      const uniqueTests = Array.from(new Set((res.lab_results || []).map((l: any) => l.test_name))) as string[];
      if (uniqueTests.length && !selectedLabTest) {
        setSelectedLabTest(uniqueTests.includes("HbA1c") ? "HbA1c" : uniqueTests[0]);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load medical timeline.");
    } finally {
      setLoading(false);
    }
  }, [category, doctor, condition, search, dateFrom, dateTo, selectedLabTest]);

  const handleToggleMedication = async (medId: number) => {
    await apiFetch(`/vault/medications/${medId}/toggle`, { method: "PATCH" });
    await loadTimeline();
  };

  const openEventDetails = async (ev: any) => {
    setDetailEvent(ev);
    if (docPreviewUrl) URL.revokeObjectURL(docPreviewUrl);
    setDocPreviewUrl(null);
    setDocPreviewType("");
    if (ev.document_id) {
      try {
        const docsRes = await apiFetch("/vault/documents");
        const matched = (docsRes.documents || []).find((d: any) => d.id === ev.document_id);
        if (matched) {
          setDocPreviewType(matched.mime_type);
          const url = await fetchAuthenticatedObjectUrl(`/vault/documents/${ev.document_id}/file`);
          setDocPreviewUrl(url);
        }
      } catch {
        setDocPreviewUrl(null);
      }
    }
  };

  useEffect(() => {
    loadTimeline();
  }, [loadTimeline]);

  const labTestNames = useMemo(() => {
    if (!data?.lab_results) return [] as string[];
    return Array.from(new Set(data.lab_results.map((l: any) => l.test_name))) as string[];
  }, [data]);

  const selectedLabSeries = useMemo(() => {
    if (!data?.lab_results || !selectedLabTest) return [];
    return data.lab_results
      .filter((l: any) => l.test_name === selectedLabTest && l.value_numeric !== null)
      .map((l: any) => ({
        date: l.test_date || "Undated",
        value: l.value_numeric,
        unit: l.unit || "",
        ref: l.reference_range || "",
      }));
  }, [data, selectedLabTest]);

  const handleManualAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!addKind) return;
    setSaving(true);
    try {
      if (addKind === "condition") {
        await apiFetch("/vault/conditions", {
          method: "POST",
          body: JSON.stringify({
            condition_name: formState.name,
            status: formState.status || "active",
            diagnosed_date: formState.date || null,
            notes: formState.notes || null,
          }),
        });
      } else if (addKind === "medication") {
        await apiFetch("/vault/medications", {
          method: "POST",
          body: JSON.stringify({
            medicine_name: formState.name,
            dosage: formState.dosage || null,
            frequency: formState.frequency || null,
            instructions: formState.notes || null,
            is_current: true,
          }),
        });
      } else if (addKind === "allergy") {
        await apiFetch("/vault/allergies", {
          method: "POST",
          body: JSON.stringify({
            allergen: formState.name,
            severity: formState.severity || "moderate",
            reaction: formState.notes || null,
          }),
        });
      }
      setAddKind(null);
      setFormState({});
      await loadTimeline();
    } catch (err: any) {
      setError(err?.message || "Failed to save entry.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-primary">Intelligent Medical Timeline</h1>
          <p className="text-sm text-muted-foreground">
            Chronological history of consultations, prescriptions, hospitalizations, and historical lab trends.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" size="sm" onClick={() => { setFormState({ status: "active" }); setAddKind("condition"); }}>
            <Plus className="size-4" aria-hidden="true" />
            <span>Add Condition</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setFormState({}); setAddKind("medication"); }}>
            <Plus className="size-4" aria-hidden="true" />
            <span>Add Medication</span>
          </Button>
          <Button variant="outline" size="sm" onClick={() => { setFormState({ severity: "moderate" }); setAddKind("allergy"); }}>
            <Plus className="size-4" aria-hidden="true" />
            <span>Add Allergy</span>
          </Button>
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-6">
          <div className="flex flex-col gap-1 lg:col-span-2">
            <FieldLabel htmlFor="tl-search">Search Events</FieldLabel>
            <div className="relative flex items-center">
              <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" aria-hidden="true" />
              <Input
                id="tl-search"
                className="pl-9"
                placeholder="Search title, diagnosis, notes..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="tl-cat">Event Type</FieldLabel>
            <Select id="tl-cat" value={category} onChange={(e) => setCategory(e.target.value)}>
              <option value="all">All events</option>
              <option value="lab_test">Laboratory / Diagnostic Tests</option>
              <option value="prescription">Prescriptions</option>
              <option value="consultation">Consultations</option>
              <option value="surgery">Surgeries</option>
              <option value="hospitalization">Hospitalizations</option>
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="tl-doc">Doctor</FieldLabel>
            <Input id="tl-doc" placeholder="Clinician..." value={doctor} onChange={(e) => setDoctor(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="tl-from">From Date</FieldLabel>
            <Input id="tl-from" type="date" value={dateFrom} onChange={(e) => setDateFrom(e.target.value)} />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="tl-to">To Date</FieldLabel>
            <Input id="tl-to" type="date" value={dateTo} onChange={(e) => setDateTo(e.target.value)} />
          </div>
        </CardContent>
      </Card>

      {loading ? (
        <LoadingState message="Building chronological timeline..." />
      ) : error ? (
        <ErrorState message={error} onRetry={loadTimeline} />
      ) : (
        <div className="grid gap-6 lg:grid-cols-12">
          {/* Chronological Timeline */}
          <Card className="lg:col-span-7">
            <CardHeader>
              <CardTitle>Chronological Health Events ({data.events.length})</CardTitle>
            </CardHeader>
            <CardContent>
              {data.events.length === 0 ? (
                <EmptyState
                  icon={CalendarClock}
                  title="No medical history has been added yet."
                  description="Upload and verify documents in My Medical Vault or record conditions, medications, or allergies above."
                />
              ) : (
                <ol className="relative flex flex-col gap-5 border-l-2 border-border pl-5 ml-2">
                  {data.events.map((ev: any) => (
                    <li key={ev.id} className="relative">
                      <span
                        className={`absolute -left-[27px] top-1.5 size-3 rounded-full border-2 border-card ${
                          ev.is_major_procedure ? "bg-[#B91C1C]" : "bg-accent"
                        }`}
                        aria-hidden="true"
                      />
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-mono text-xs font-semibold text-secondary">{formatDate(ev.event_date)}</span>
                        <div className="flex gap-1.5">
                          <Badge variant="neutral">{CATEGORY_LABELS[ev.event_type] || ev.event_type.replace(/_/g, " ")}</Badge>
                          {ev.is_major_procedure && <Badge variant="high">Major Procedure</Badge>}
                        </div>
                      </div>
                      <h3 className="mt-1 font-display text-sm font-semibold text-foreground">{ev.title}</h3>
                      {ev.description && <p className="mt-0.5 text-xs text-muted-foreground leading-relaxed">{ev.description}</p>}
                      <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2 text-[11px] text-muted-foreground">
                        <span>{[ev.doctor_name, ev.hospital_name, ev.condition_tag].filter(Boolean).join(" · ")}</span>
                        <Button size="sm" variant="outline" onClick={() => openEventDetails(ev)}>
                          <Eye className="size-3.5" aria-hidden="true" />
                          <span>{ev.document_id ? "Preview Document" : "Event Details"}</span>
                        </Button>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>

          {/* Right Column: Lab Trend Chart + Structured Summaries */}
          <div className="flex flex-col gap-6 lg:col-span-5">
            <Card>
              <CardHeader>
                <CardTitle>Historical Lab Marker Trend</CardTitle>
                <CardDescription>Select a lab test to compare recorded readings chronologically.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {labTestNames.length === 0 ? (
                  <p className="text-xs text-muted-foreground">No structured lab values saved yet.</p>
                ) : (
                  <>
                    <Select
                      aria-label="Select lab test for trend chart"
                      value={selectedLabTest}
                      onChange={(e) => setSelectedLabTest(e.target.value)}
                    >
                      {labTestNames.map((t) => (
                        <option key={t} value={t}>
                          {t}
                        </option>
                      ))}
                    </Select>
                    {selectedLabSeries.length > 0 ? (
                      <div className="h-52 w-full">
                        <ResponsiveContainer width="100%" height="100%">
                          <LineChart data={selectedLabSeries} margin={{ top: 10, right: 12, left: -12, bottom: 0 }}>
                            <CartesianGrid strokeDasharray="3 3" stroke="#CBD5E1" />
                            <XAxis dataKey="date" tick={{ fontSize: 11, fill: "#323A4D" }} />
                            <YAxis tick={{ fontSize: 11, fill: "#323A4D" }} />
                            <Tooltip
                              contentStyle={{
                                backgroundColor: "#F9FAFB",
                                borderColor: "#0284C7",
                                borderRadius: "8px",
                                fontSize: "12px",
                              }}
                            />
                            <Line type="monotone" dataKey="value" stroke="#0284C7" strokeWidth={2.5} dot={{ r: 4, fill: "#A78BFA" }} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    ) : (
                      <p className="text-xs text-muted-foreground">No numeric readings for this marker.</p>
                    )}
                  </>
                )}
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle>Conditions &amp; Allergies</CardTitle>
              </CardHeader>
              <CardContent className="flex flex-col gap-4 text-xs">
                <div>
                  <div className="mb-1.5 font-semibold text-primary">Allergies ({data.allergies.length})</div>
                  {data.allergies.length === 0 ? (
                    <span className="text-muted-foreground">None documented</span>
                  ) : (
                    <div className="flex flex-wrap gap-1.5">
                      {data.allergies.map((a: any) => (
                        <Badge key={a.id} variant="critical">
                          {a.allergen} ({a.severity})
                        </Badge>
                      ))}
                    </div>
                  )}
                </div>
                <div>
                  <div className="mb-1.5 font-semibold text-primary">Conditions ({data.conditions.length})</div>
                  <ul className="flex flex-col gap-1.5">
                    {data.conditions.map((c: any) => (
                      <li key={c.id} className="flex items-center justify-between rounded border border-border px-2.5 py-1.5">
                        <span className="font-medium text-foreground">{c.condition_name}</span>
                        <Badge variant={c.status === "resolved" ? "low" : "moderate"}>{c.status}</Badge>
                      </li>
                    ))}
                  </ul>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Pill className="size-4 text-secondary" aria-hidden="true" />
                  Medications Regimen Status ({data.medications.length})
                </CardTitle>
                <CardDescription>Mark completed prescriptions as Past so they do not appear as active drugs in Doctor Summary.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-2 text-xs">
                {data.medications.length === 0 ? (
                  <span className="text-muted-foreground">No medication records saved.</span>
                ) : (
                  data.medications.map((m: any) => (
                    <div key={m.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-border px-3 py-2">
                      <div>
                        <div className="font-semibold text-foreground">
                          {m.medicine_name} {m.dosage || ""}
                        </div>
                        <div className="text-muted-foreground">
                          {m.frequency || "See prescription"} · Prescribed {formatDate(m.prescribed_date)}
                        </div>
                      </div>
                      <Button size="sm" variant={m.is_current ? "accent" : "outline"} onClick={() => handleToggleMedication(m.id)}>
                        {m.is_current ? "Active (Mark Past)" : "Past (Set Active)"}
                      </Button>
                    </div>
                  ))
                )}
              </CardContent>
            </Card>
          </div>
        </div>
      )}

      <Modal
        open={Boolean(detailEvent)}
        onClose={() => {
          setDetailEvent(null);
          if (docPreviewUrl) URL.revokeObjectURL(docPreviewUrl);
          setDocPreviewUrl(null);
        }}
        title={detailEvent?.title || "Timeline Event Details"}
        description={detailEvent ? `${formatDate(detailEvent.event_date)} · ${detailEvent.hospital_name || "Clinical Event"}` : ""}
        maxWidthClass="max-w-3xl"
      >
        {detailEvent && (
          <div className="flex flex-col gap-3 text-xs">
            <div className="rounded border border-border bg-background p-3">
              <div><span className="font-semibold">Doctor:</span> {detailEvent.doctor_name || "Not specified"}</div>
              <div><span className="font-semibold">Condition Tag:</span> {detailEvent.condition_tag || "Unspecified"}</div>
              <div className="mt-1"><span className="font-semibold">Notes:</span> {detailEvent.description || "None"}</div>
            </div>
            {docPreviewUrl && (
              docPreviewType === "application/pdf" ? (
                <iframe src={docPreviewUrl} title={detailEvent.title} className="h-[400px] w-full rounded border border-border" />
              ) : (
                <img src={docPreviewUrl} alt={detailEvent.title} className="max-h-[400px] w-full rounded border border-border object-contain" />
              )
            )}
          </div>
        )}
      </Modal>

      <Modal
        open={Boolean(addKind)}
        onClose={() => setAddKind(null)}
        title={addKind === "condition" ? "Add Medical Condition" : addKind === "medication" ? "Add Medication" : "Add Allergy"}
        maxWidthClass="max-w-md"
      >
        <form onSubmit={handleManualAdd} className="flex flex-col gap-3">
          {error && <Alert variant="danger">{error}</Alert>}
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="man-name">
              {addKind === "condition" ? "Condition Name" : addKind === "medication" ? "Medicine Name" : "Allergen"}
            </FieldLabel>
            <Input
              id="man-name"
              required
              value={formState.name || ""}
              onChange={(e) => setFormState({ ...formState, name: e.target.value })}
            />
          </div>
          {addKind === "condition" && (
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="man-status">Status</FieldLabel>
              <Select id="man-status" value={formState.status || "active"} onChange={(e) => setFormState({ ...formState, status: e.target.value })}>
                <option value="active">Active</option>
                <option value="monitoring">Monitoring</option>
                <option value="chronic">Chronic</option>
                <option value="resolved">Resolved</option>
              </Select>
            </div>
          )}
          {addKind === "medication" && (
            <div className="grid grid-cols-2 gap-2">
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="man-dosage">Dosage</FieldLabel>
                <Input id="man-dosage" placeholder="500 mg" value={formState.dosage || ""} onChange={(e) => setFormState({ ...formState, dosage: e.target.value })} />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="man-freq">Frequency</FieldLabel>
                <Input id="man-freq" placeholder="Once daily" value={formState.frequency || ""} onChange={(e) => setFormState({ ...formState, frequency: e.target.value })} />
              </div>
            </div>
          )}
          {addKind === "allergy" && (
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="man-sev">Severity</FieldLabel>
              <Select id="man-sev" value={formState.severity || "moderate"} onChange={(e) => setFormState({ ...formState, severity: e.target.value })}>
                <option value="mild">Mild</option>
                <option value="moderate">Moderate</option>
                <option value="severe">Severe</option>
              </Select>
            </div>
          )}
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="man-notes">Notes / Reaction</FieldLabel>
            <Input id="man-notes" value={formState.notes || ""} onChange={(e) => setFormState({ ...formState, notes: e.target.value })} />
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button variant="outline" onClick={() => setAddKind(null)}>
              Cancel
            </Button>
            <Button type="submit" disabled={saving}>
              {saving ? "Saving..." : "Save Record"}
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
