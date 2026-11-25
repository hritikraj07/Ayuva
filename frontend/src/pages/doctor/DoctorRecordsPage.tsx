import React, { useCallback, useEffect, useState } from "react";
import { Clock, Eye, FileText, KeyRound, Lock, ShieldCheck, Stethoscope } from "lucide-react";
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
import { CATEGORY_LABELS, formatCountdown, formatDate } from "@/lib/utils";

export function DoctorRecordsPage() {
  const [assigned, setAssigned] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [manualToken, setManualToken] = useState("");
  const [pinInput, setPinInput] = useState("");
  const [activeToken, setActiveToken] = useState<string | null>(null);
  const [activePin, setActivePin] = useState<string | null>(null);
  const [pinRequired, setPinRequired] = useState(false);
  const [viewerData, setViewerData] = useState<any>(null);
  const [viewerLoading, setViewerLoading] = useState(false);
  const [viewerError, setViewerError] = useState<string | null>(null);
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);

  const openShareToken = useCallback(async (token: string, pin?: string) => {
    setViewerLoading(true);
    setViewerError(null);
    setActiveToken(token);
    try {
      const res = pin
        ? await apiFetch(`/shares/public/${token}/verify`, {
            method: "POST",
            body: JSON.stringify({ pin }),
          })
        : await apiFetch(`/shares/public/${token}`);

      if (res.pin_required) {
        setPinRequired(true);
        setViewerData(res);
      } else {
        setPinRequired(false);
        setActivePin(pin || null);
        setViewerData(res);
        if (res.documents?.length) setSelectedDocId(res.documents[0].id);
      }
    } catch (err: any) {
      setViewerError(err?.message || "Could not open shared patient record.");
    } finally {
      setViewerLoading(false);
    }
  }, []);

  const loadAssigned = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/shares/doctor/assigned");
      const list = res.assigned_shares || [];
      setAssigned(list);
      const firstActive = list.find((s: any) => s.is_active);
      if (firstActive && !activeToken) {
        openShareToken(firstActive.token);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load shared patient records.");
    } finally {
      setLoading(false);
    }
  }, [activeToken, openShareToken]);

  useEffect(() => {
    loadAssigned();
  }, [loadAssigned]);

  const handleManualLookup = (e: React.FormEvent) => {
    e.preventDefault();
    const cleaned = manualToken.trim().split("/share/").pop() || "";
    if (!cleaned) return;
    setPinInput("");
    openShareToken(cleaned);
  };

  const selectedDoc = viewerData?.documents?.find((d: any) => d.id === selectedDocId) || null;
  const docFileUrl =
    selectedDoc && activeToken
      ? `/api/shares/public/${activeToken}/documents/${selectedDoc.id}/file${activePin ? `?pin=${encodeURIComponent(activePin)}` : ""}`
      : null;

  if (loading) return <LoadingState message="Loading explicitly shared patient records..." />;
  if (error) return <ErrorState message={error} onRetry={loadAssigned} />;

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-primary">Doctor Consultation &amp; Shared Record Viewer</h1>
          <p className="text-sm text-muted-foreground">
            Authorized clinicians see only records explicitly shared by patients via temporary QR links or direct share
            assignments.
          </p>
        </div>
        <form onSubmit={handleManualLookup} className="flex gap-2">
          <Input
            aria-label="Open shared token or URL"
            placeholder="Paste share link or token..."
            className="w-60"
            value={manualToken}
            onChange={(e) => setManualToken(e.target.value)}
          />
          <Button type="submit" variant="outline">
            Open Link
          </Button>
        </form>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Shared Sessions List */}
        <Card className="lg:col-span-4">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <Stethoscope className="size-4 text-[#0066FF]" aria-hidden="true" />
              Assigned Patient Shares ({assigned.length})
            </CardTitle>
            <CardDescription>Expired or revoked sessions cannot be opened.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-2.5">
            {assigned.length === 0 ? (
              <EmptyState
                icon={Lock}
                title="No assigned patient shares"
                description="Ask a patient to share selected records with your email or paste their temporary share token above."
              />
            ) : (
              assigned.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  disabled={!s.is_active}
                  onClick={() => openShareToken(s.token)}
                  className={`flex flex-col gap-1.5 rounded-lg border p-3.5 text-left transition-colors ${
                    activeToken === s.token ? "border-secondary/60 bg-secondary/20" : "border-border bg-card hover:bg-muted/60"
                  } disabled:opacity-60`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-sm text-foreground">{s.patient_name}</span>
                    <Badge variant={s.is_active ? "verified" : "neutral"}>{s.status}</Badge>
                  </div>
                  <div className="text-xs font-medium text-primary">{s.title}</div>
                  <div className="flex flex-wrap gap-2 text-[11px] text-muted-foreground">
                    <span>{s.document_count} doc(s)</span>
                    <span>· {s.is_active ? formatCountdown(s.remaining_seconds) : s.status}</span>
                    {s.requires_pin && <span>· PIN required</span>}
                  </div>
                </button>
              ))
            )}
          </CardContent>
        </Card>

        {/* Consultation Viewer */}
        <div className="lg:col-span-8 flex flex-col gap-5">
          {viewerLoading ? (
            <LoadingState message="Decrypting and auditing shared consultation records..." />
          ) : viewerError ? (
            <Alert variant="danger" title="Access Denied or Expired">
              {viewerError}
            </Alert>
          ) : pinRequired && activeToken ? (
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <KeyRound className="size-4 text-[#0066FF]" aria-hidden="true" />
                  PIN Required for "{viewerData?.title}"
                </CardTitle>
              </CardHeader>
              <CardContent>
                <form
                  onSubmit={(e) => {
                    e.preventDefault();
                    openShareToken(activeToken, pinInput);
                  }}
                  className="flex max-w-sm flex-col gap-3"
                >
                  <FieldLabel htmlFor="doc-pin">Patient Share PIN</FieldLabel>
                  <Input
                    id="doc-pin"
                    type="password"
                    placeholder="Enter 4-8 digit PIN"
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value)}
                    required
                  />
                  <Button type="submit" variant="accent">
                    Unlock Consultation View
                  </Button>
                </form>
              </CardContent>
            </Card>
          ) : viewerData ? (
            <>
              {viewerData.summary && (
                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div>
                        <CardTitle className="flex items-center gap-2 text-base">
                          <ShieldCheck className="size-4 text-[#0066FF]" aria-hidden="true" />
                          Consultation Summary: {viewerData.patient_name}
                        </CardTitle>
                        <CardDescription>{viewerData.summary.scope_note}</CardDescription>
                      </div>
                      <div className="flex items-center gap-1.5 font-mono text-xs text-primary">
                        <Clock className="size-3.5 text-[#0066FF]" aria-hidden="true" />
                        <span>{formatCountdown(viewerData.status.remaining_seconds)}</span>
                      </div>
                    </div>
                  </CardHeader>
                  <CardContent className="grid gap-4 sm:grid-cols-3 text-xs">
                    <div>
                      <div className="font-semibold text-muted-foreground uppercase">Allergies</div>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {viewerData.summary.known_allergies?.length ? (
                          viewerData.summary.known_allergies.map((a: any, i: number) => (
                            <Badge key={i} variant="critical">
                              {a.allergen} ({a.severity})
                            </Badge>
                          ))
                        ) : (
                          <span>None documented</span>
                        )}
                      </div>
                    </div>
                    <div>
                      <div className="font-semibold text-muted-foreground uppercase">Shared Meds</div>
                      <ul className="mt-1 flex flex-col gap-1">
                        {viewerData.summary.shared_medications?.length ? (
                          viewerData.summary.shared_medications.map((m: any, i: number) => (
                            <li key={i}>
                              {m.medicine_name} {m.dosage} {m.frequency}
                            </li>
                          ))
                        ) : (
                          <li className="text-muted-foreground">None in shared docs</li>
                        )}
                      </ul>
                    </div>
                    <div>
                      <div className="font-semibold text-muted-foreground uppercase">Shared Lab Markers</div>
                      <ul className="mt-1 flex flex-col gap-1">
                        {viewerData.summary.shared_lab_results?.length ? (
                          viewerData.summary.shared_lab_results.map((l: any, i: number) => (
                            <li key={i}>
                              {l.test_name}: <span className="font-mono font-semibold">{l.value_text} {l.unit}</span>{" "}
                              {l.is_abnormal && <Badge variant="high">{l.flag}</Badge>}
                            </li>
                          ))
                        ) : (
                          <li className="text-muted-foreground">None in shared docs</li>
                        )}
                      </ul>
                    </div>
                  </CardContent>
                </Card>
              )}

              <Card>
                <CardHeader>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <CardTitle className="text-base">Shared Documents ({viewerData.documents.length})</CardTitle>
                    <div className="flex flex-wrap gap-1.5">
                      {viewerData.documents.map((d: any) => (
                        <Button
                          key={d.id}
                          size="sm"
                          variant={selectedDocId === d.id ? "primary" : "outline"}
                          onClick={() => setSelectedDocId(d.id)}
                        >
                          <FileText className="size-3.5" aria-hidden="true" />
                          <span>{d.title}</span>
                        </Button>
                      ))}
                    </div>
                  </div>
                </CardHeader>
                {selectedDoc && (
                  <CardContent className="flex flex-col gap-4">
                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground">
                      <span>
                        {CATEGORY_LABELS[selectedDoc.category] || selectedDoc.category} · {formatDate(selectedDoc.document_date)} ·{" "}
                        {selectedDoc.hospital_name || "Facility unspecified"}
                      </span>
                      {docFileUrl && (
                        <a
                          href={docFileUrl}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex items-center gap-1 font-medium text-[#0066FF] hover:underline"
                        >
                          <Eye className="size-3.5" aria-hidden="true" />
                          <span>Open original file</span>
                        </a>
                      )}
                    </div>
                    {docFileUrl && selectedDoc.mime_type === "application/pdf" ? (
                      <iframe src={docFileUrl} title={selectedDoc.title} className="h-[420px] w-full rounded border border-border" />
                    ) : docFileUrl ? (
                      <img src={docFileUrl} alt={selectedDoc.title} className="max-h-[420px] w-full rounded border border-border object-contain" />
                    ) : null}
                    <div className="rounded-md border border-border bg-background p-3">
                      <div className="text-xs font-semibold text-primary">Extracted OCR Text</div>
                      <pre className="mt-1.5 whitespace-pre-wrap font-mono text-xs leading-relaxed">
                        {selectedDoc.ocr_text}
                      </pre>
                    </div>
                  </CardContent>
                )}
              </Card>
            </>
          ) : (
            <EmptyState
              icon={Stethoscope}
              title="Select a shared session to inspect"
              description="Choose an active share session from the left panel to review authorized patient records."
            />
          )}
        </div>
      </div>
    </div>
  );
}
