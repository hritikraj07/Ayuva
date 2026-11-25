import React, { Suspense, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  AlertTriangle,
  ClipboardList,
  FileCheck2,
  FolderLock,
  MessageSquareHeart,
  Pill,
  Share2,
  Upload,
} from "lucide-react";

const PatientBioCore3D = React.lazy(() =>
  import("@/components/three/MiniBioWidgets").then((m) => ({ default: m.PatientBioCore3D }))
);
import {
  Alert,
  Badge,
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
  EmptyState,
  ErrorState,
  LoadingState,
} from "@/components/ui/primitives";
import { apiFetch } from "@/lib/api";
import { CATEGORY_LABELS, formatDate, formatDateTime } from "@/lib/utils";

export function PatientOverviewPage() {
  const [data, setData] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/vault/overview");
      setData(res);
    } catch (err: any) {
      setError(err?.message || "Failed to load patient overview.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) return <LoadingState message="Loading your personal health overview..." />;
  if (error) return <ErrorState message={error} onRetry={load} />;

  const counts = data.counts;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="neo-glass flex flex-col gap-5 rounded-2xl p-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <Suspense fallback={<div className="h-24 w-24 shrink-0 rounded-full border border-cyan-400/30 bg-cyan-950/30" />}>
            <PatientBioCore3D className="h-24 w-24 shrink-0" />
          </Suspense>
          <div>
            <div className="font-mono text-[11px] uppercase tracking-wider text-primary">
              Neo-Biomedical Health Core
            </div>
            <h1 className="font-display text-2xl font-bold text-foreground">Personal Health Overview</h1>
            <p className="text-sm text-muted-foreground">
              Verified records, active medication regimen, and consultation preparation tools.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            to="/patient/vault"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg bg-primary px-4 text-sm font-semibold text-primary-foreground shadow-[0_0_20px_-6px_rgba(34,211,238,0.6)] hover:bg-primary/90"
          >
            <Upload className="size-4" aria-hidden="true" />
            <span>Upload Document</span>
          </Link>
          <Link
            to="/patient/assistant"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-violet-400/35 bg-violet-500/15 px-4 text-sm font-medium text-violet-100 hover:bg-violet-500/25"
          >
            <MessageSquareHeart className="size-4 text-primary" aria-hidden="true" />
            <span>Ask Gemini AI</span>
          </Link>
          <Link
            to="/patient/summary"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-lg border border-border bg-card px-4 text-sm font-medium text-foreground hover:bg-muted"
          >
            <ClipboardList className="size-4 text-secondary" aria-hidden="true" />
            <span>One-Minute Summary</span>
          </Link>
        </div>
      </div>

      {data.allergies?.length > 0 && (
        <Alert variant="danger" title="Documented Allergy Alert">
          {data.allergies.map((a: any) => `${a.allergen} (${a.severity}${a.reaction ? `: ${a.reaction}` : ""})`).join(" | ")}
        </Alert>
      )}

      {counts.pending_review > 0 && (
        <Alert variant="warning" title="Documents Pending Your Verification">
          You have {counts.pending_review} uploaded document(s) awaiting OCR field verification in{" "}
          <Link to="/patient/vault" className="font-semibold underline">
            My Medical Vault
          </Link>
          .
        </Alert>
      )}

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Card>
          <CardContent className="flex items-center justify-between pt-5">
            <div>
              <div className="text-xs font-medium text-muted-foreground">Stored Documents</div>
              <div className="mt-1 font-display text-2xl font-bold text-primary">{counts.documents}</div>
            </div>
            <FolderLock className="size-6 text-secondary" aria-hidden="true" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between pt-5">
            <div>
              <div className="text-xs font-medium text-muted-foreground">Active Medications</div>
              <div className="mt-1 font-display text-2xl font-bold text-primary">{counts.active_medications}</div>
            </div>
            <Pill className="size-6 text-secondary" aria-hidden="true" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between pt-5">
            <div>
              <div className="text-xs font-medium text-muted-foreground">Flagged Lab Values</div>
              <div className="mt-1 font-display text-2xl font-bold text-amber-300">{counts.flagged_labs}</div>
            </div>
            <AlertTriangle className="size-6 text-amber-400" aria-hidden="true" />
          </CardContent>
        </Card>
        <Card>
          <CardContent className="flex items-center justify-between pt-5">
            <div>
              <div className="text-xs font-medium text-muted-foreground">Recorded Conditions</div>
              <div className="mt-1 font-display text-2xl font-bold text-primary">{counts.conditions}</div>
            </div>
            <FileCheck2 className="size-6 text-secondary" aria-hidden="true" />
          </CardContent>
        </Card>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Recent Medical Documents</CardTitle>
              <CardDescription>Chronological vault records ready for timeline or consultation sharing.</CardDescription>
            </div>
            <Link to="/patient/vault" className="text-xs font-semibold text-secondary hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent>
            {data.recent_documents.length === 0 ? (
              <EmptyState
                icon={FolderLock}
                title="No medical documents yet"
                description="Upload a prescription, lab report, or discharge summary to start extracting structured medical facts."
              />
            ) : (
              <div className="flex flex-col divide-y divide-border">
                {data.recent_documents.map((doc: any) => (
                  <div key={doc.id} className="flex flex-col gap-1.5 py-3 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-foreground">{doc.title}</div>
                      <div className="text-xs text-muted-foreground">
                        {CATEGORY_LABELS[doc.category] || doc.category} · {formatDate(doc.document_date)} ·{" "}
                        {doc.doctor_name || "Doctor unspecified"}
                      </div>
                    </div>
                    <Badge variant={doc.is_verified ? "verified" : "moderate"}>
                      {doc.is_verified ? "Verified" : "Pending Review"}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <div className="flex flex-col gap-6 lg:col-span-5">
          <Card>
            <CardHeader>
              <CardTitle>Current Medications</CardTitle>
              <CardDescription>Based on verified prescriptions and manual entries.</CardDescription>
            </CardHeader>
            <CardContent>
              {data.active_medications.length === 0 ? (
                <p className="text-xs text-muted-foreground">No current medications recorded.</p>
              ) : (
                <ul className="flex flex-col gap-2.5 text-sm">
                  {data.active_medications.map((m: any) => (
                    <li key={m.id} className="flex items-center justify-between rounded-md border border-border bg-background px-3 py-2">
                      <span className="font-medium text-foreground">{m.medicine_name}</span>
                      <span className="font-mono text-xs text-muted-foreground">
                        {[m.dosage, m.frequency].filter(Boolean).join(" · ") || "See prescription"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Quick Clinical Actions</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-2.5">
              <Link
                to="/patient/assistant"
                className="flex min-h-[44px] items-center justify-between rounded-md border border-border px-3.5 py-2 text-sm font-medium hover:bg-muted"
              >
                <span className="flex items-center gap-2">
                  <MessageSquareHeart className="size-4 text-secondary" aria-hidden="true" />
                  Ask AI Health Assistant about a lab report
                </span>
              </Link>
              <Link
                to="/patient/share"
                className="flex min-h-[44px] items-center justify-between rounded-md border border-border px-3.5 py-2 text-sm font-medium hover:bg-muted"
              >
                <span className="flex items-center gap-2">
                  <Share2 className="size-4 text-secondary" aria-hidden="true" />
                  Create 30-minute QR code for doctor visit
                </span>
              </Link>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Recent Vault Audit Events</CardTitle>
            </CardHeader>
            <CardContent className="flex flex-col gap-2 text-xs">
              {data.recent_activity?.length ? (
                data.recent_activity.slice(0, 5).map((ev: any, idx: number) => (
                  <div key={idx} className="flex items-center justify-between text-muted-foreground">
                    <span className="font-medium text-foreground">{ev.action.replace(/_/g, " ")}</span>
                    <span className="font-mono">{formatDateTime(ev.created_at)}</span>
                  </div>
                ))
              ) : (
                <span className="text-muted-foreground">No recent activity logged yet.</span>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
