import React, { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { Clock, Eye, FileText, Lock, ShieldCheck } from "lucide-react";
import { BrandMark } from "@/components/BrandMark";
import {
  Alert,
  Badge,
  Button,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  ErrorState,
  FieldLabel,
  Input,
  LoadingState,
} from "@/components/ui/primitives";
import { apiFetch } from "@/lib/api";
import { CATEGORY_LABELS, formatCountdown, formatDate } from "@/lib/utils";

export function PublicShareViewerPage() {
  const { token } = useParams<{ token: string }>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [pinRequired, setPinRequired] = useState(false);
  const [pinInput, setPinInput] = useState("");
  const [activePin, setActivePin] = useState<string | null>(null);
  const [pinError, setPinError] = useState<string | null>(null);
  const [shareData, setShareData] = useState<any>(null);
  const [selectedDocId, setSelectedDocId] = useState<number | null>(null);
  const [remainingSec, setRemainingSec] = useState<number>(0);

  const loadShare = useCallback(
    async (pinValue?: string) => {
      if (!token) return;
      setLoading(true);
      setError(null);
      setPinError(null);
      try {
        const res = pinValue
          ? await apiFetch(`/shares/public/${token}/verify`, {
              method: "POST",
              body: JSON.stringify({ pin: pinValue }),
            })
          : await apiFetch(`/shares/public/${token}`);

        if (res.pin_required) {
          setPinRequired(true);
          setShareData(res);
        } else {
          setPinRequired(false);
          setShareData(res);
          setActivePin(pinValue || null);
          setRemainingSec(res.status?.remaining_seconds || 0);
          if (res.documents?.length) {
            setSelectedDocId(res.documents[0].id);
          }
        }
      } catch (err: any) {
        if (pinValue) {
          setPinError(err?.message || "Invalid PIN.");
        } else {
          setError(err?.message || "This medical sharing link is unavailable or expired.");
        }
      } finally {
        setLoading(false);
      }
    },
    [token]
  );

  useEffect(() => {
    loadShare();
  }, [loadShare]);

  useEffect(() => {
    if (!remainingSec) return;
    const timer = window.setInterval(() => {
      setRemainingSec((s) => Math.max(0, s - 1));
    }, 1000);
    return () => window.clearInterval(timer);
  }, [remainingSec]);

  const handlePinSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (pinInput.trim().length < 4) {
      setPinError("Enter the 4 to 8 digit access PIN.");
      return;
    }
    loadShare(pinInput.trim());
  };

  const selectedDoc = shareData?.documents?.find((d: any) => d.id === selectedDocId) || null;
  const fileSrc =
    selectedDoc && token
      ? `/api/shares/public/${token}/documents/${selectedDoc.id}/file${activePin ? `?pin=${encodeURIComponent(activePin)}` : ""}`
      : null;

  return (
    <div className="min-h-dvh bg-background text-foreground">
      <header className="border-b border-border bg-card">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link to="/">
            <BrandMark />
          </Link>
          <Badge variant="teal">Read-Only Clinician Share Viewer</Badge>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-4 py-8">
        {loading && !pinRequired ? (
          <LoadingState message="Verifying temporary sharing link..." />
        ) : error ? (
          <ErrorState message={error} onRetry={() => loadShare()} />
        ) : pinRequired ? (
          <Card className="mx-auto max-w-md">
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <Lock className="size-4 text-secondary" aria-hidden="true" />
                PIN Protected Medical Share
              </CardTitle>
              <CardDescription>{shareData?.title || "Enter the patient's temporary PIN to open shared records."}</CardDescription>
            </CardHeader>
            <CardContent>
              <form onSubmit={handlePinSubmit} className="flex flex-col gap-4">
                {pinError && <Alert variant="danger">{pinError}</Alert>}
                <div className="flex flex-col gap-1.5">
                  <FieldLabel htmlFor="share-pin">Access PIN</FieldLabel>
                  <Input
                    id="share-pin"
                    type="password"
                    inputMode="numeric"
                    placeholder="Enter 4-8 digit PIN"
                    value={pinInput}
                    onChange={(e) => setPinInput(e.target.value)}
                  />
                </div>
                <Button type="submit" disabled={loading}>
                  Unlock Shared Records
                </Button>
              </form>
            </CardContent>
          </Card>
        ) : shareData ? (
          <div className="flex flex-col gap-6">
            <div className="flex flex-col gap-3 rounded-lg border border-border bg-card p-5 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="font-display text-xl font-bold text-primary">{shareData.title}</h1>
                  <Badge variant="verified">Active Scoped Access</Badge>
                </div>
                <p className="mt-1 text-xs text-muted-foreground">
                  Patient: <span className="font-semibold text-foreground">{shareData.patient_name}</span> | Showing{" "}
                  <span className="font-semibold text-foreground">{shareData.shared_document_count}</span> explicitly
                  shared document(s) only.
                </p>
              </div>
              <div className="flex items-center gap-2 rounded-md border border-border bg-background px-3 py-2 font-mono text-xs text-primary">
                <Clock className="size-4 text-secondary" aria-hidden="true" />
                <span>{formatCountdown(remainingSec)}</span>
              </div>
            </div>

            {shareData.summary && (
              <Card>
                <CardHeader>
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ShieldCheck className="size-4 text-secondary" aria-hidden="true" />
                    Scoped Patient Consultation Summary
                  </CardTitle>
                  <CardDescription>{shareData.summary.scope_note}</CardDescription>
                </CardHeader>
                <CardContent className="grid gap-4 md:grid-cols-3 text-sm">
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase">Known Allergies</div>
                    <div className="mt-1.5 flex flex-wrap gap-1.5">
                      {shareData.summary.known_allergies?.length ? (
                        shareData.summary.known_allergies.map((a: any, i: number) => (
                          <Badge key={i} variant="critical">
                            {a.allergen} ({a.severity})
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">None documented</span>
                      )}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase">Shared Medications</div>
                    <ul className="mt-1.5 flex flex-col gap-1 text-xs">
                      {shareData.summary.shared_medications?.length ? (
                        shareData.summary.shared_medications.map((m: any, i: number) => (
                          <li key={i}>
                            <span className="font-medium">{m.medicine_name}</span> {m.dosage} {m.frequency}
                          </li>
                        ))
                      ) : (
                        <li className="text-muted-foreground">None listed in shared documents</li>
                      )}
                    </ul>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-muted-foreground uppercase">Shared Lab Results</div>
                    <ul className="mt-1.5 flex flex-col gap-1 text-xs">
                      {shareData.summary.shared_lab_results?.length ? (
                        shareData.summary.shared_lab_results.map((l: any, i: number) => (
                          <li key={i}>
                            {l.test_name}: <span className="font-mono font-semibold">{l.value_text} {l.unit}</span>{" "}
                            {l.is_abnormal && <Badge variant="high">{l.flag}</Badge>}
                          </li>
                        ))
                      ) : (
                        <li className="text-muted-foreground">No lab values in shared documents</li>
                      )}
                    </ul>
                  </div>
                </CardContent>
              </Card>
            )}

            <div className="grid gap-6 lg:grid-cols-12">
              <div className="flex flex-col gap-3 lg:col-span-4">
                <h2 className="font-display text-sm font-semibold uppercase tracking-wide text-muted-foreground">
                  Shared Documents ({shareData.documents.length})
                </h2>
                {shareData.documents.map((doc: any) => (
                  <button
                    key={doc.id}
                    type="button"
                    onClick={() => setSelectedDocId(doc.id)}
                    className={`flex flex-col gap-1.5 rounded-lg border p-3.5 text-left transition-colors ${
                      selectedDocId === doc.id ? "border-secondary/60 bg-secondary/20" : "border-border bg-card hover:bg-muted/60"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-sm text-foreground">{doc.title}</span>
                      <FileText className="size-4 shrink-0 text-secondary" aria-hidden="true" />
                    </div>
                    <div className="text-xs text-muted-foreground">
                      {CATEGORY_LABELS[doc.category] || doc.category} · {formatDate(doc.document_date)}
                    </div>
                  </button>
                ))}
              </div>

              <div className="lg:col-span-8">
                {selectedDoc ? (
                  <Card>
                    <CardHeader>
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <div>
                          <CardTitle>{selectedDoc.title}</CardTitle>
                          <CardDescription>
                            {selectedDoc.doctor_name || "Doctor unspecified"} · {selectedDoc.hospital_name || "Facility unspecified"}
                          </CardDescription>
                        </div>
                        {fileSrc && (
                          <a
                            href={fileSrc}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
                          >
                            <Eye className="size-4" aria-hidden="true" />
                            <span>Open Full File</span>
                          </a>
                        )}
                      </div>
                    </CardHeader>
                    <CardContent className="flex flex-col gap-4">
                      {fileSrc && selectedDoc.mime_type === "application/pdf" ? (
                        <iframe
                          src={fileSrc}
                          title={selectedDoc.title}
                          className="h-[460px] w-full rounded border border-border"
                        />
                      ) : fileSrc ? (
                        <img
                          src={fileSrc}
                          alt={selectedDoc.title}
                          className="max-h-[460px] w-full rounded border border-border object-contain bg-muted/30"
                        />
                      ) : null}

                      <div className="rounded-md border border-border bg-background p-3.5 text-xs">
                        <div className="font-semibold text-primary">Extracted OCR Text</div>
                        <pre className="mt-2 whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-foreground">
                          {selectedDoc.ocr_text || "No OCR text recorded."}
                        </pre>
                      </div>
                    </CardContent>
                  </Card>
                ) : null}
              </div>
            </div>
          </div>
        ) : null}
      </main>
    </div>
  );
}
