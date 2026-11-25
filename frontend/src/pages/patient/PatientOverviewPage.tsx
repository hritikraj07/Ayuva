import React, { Suspense, useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import {
  Activity,
  AlertTriangle,
  ArrowUpRight,
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

function SparklineTrace({ accent = false }: { accent?: boolean }) {
  return (
    <svg viewBox="0 0 120 34" fill="none" className="h-8 w-full">
      <path
        d="M2 20 H22 L30 13 L38 20 H50 L58 27 L66 5 L74 30 L82 20 H98 L106 14 L118 20"
        stroke={accent ? "#FFFFFF" : "#0066FF"}
        strokeOpacity={accent ? "0.9" : "0.7"}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

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
      {/* Studio Porcelain Hero Header matching reference layout */}
      <div className="flex flex-col gap-5 rounded-3xl border border-[#E5E9F0] bg-white p-6 shadow-[0_14px_36px_-18px_rgba(15,23,42,0.09)] sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-5">
          <div className="flex size-24 shrink-0 items-center justify-center rounded-full border border-[#E5E9F0] bg-[#F8FAFC] p-1">
            <Suspense fallback={<div className="h-20 w-20 rounded-full bg-[#EFF6FF]" />}>
              <PatientBioCore3D className="h-22 w-22 shrink-0" />
            </Suspense>
          </div>
          <div>
            <div className="inline-flex items-center gap-2 rounded-full bg-[#EFF6FF] px-3 py-1 font-mono text-[11px] font-semibold uppercase tracking-wider text-[#0066FF]">
              <span className="size-1.5 rounded-full bg-[#0066FF]" aria-hidden="true" />
              <span>Personal Health Overview</span>
            </div>
            <h1 className="mt-1.5 font-display text-3xl font-semibold tracking-tight text-[#111827]">
              Overview Conditions
            </h1>
            <p className="text-sm text-[#64748B]">
              Verified vault records, active medication regimen, and Gemini clinical preparation.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2.5">
          <Link
            to="/patient/vault"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full bg-[#0066FF] px-5 text-sm font-semibold text-white shadow-[0_10px_24px_-10px_rgba(0,102,255,0.65)] hover:bg-[#0052CC]"
          >
            <Upload className="size-4" aria-hidden="true" />
            <span>Upload Document</span>
          </Link>
          <Link
            to="/patient/assistant"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[#E5E9F0] bg-[#F8FAFC] px-4 text-sm font-medium text-[#111827] hover:border-[#0066FF]/40 hover:bg-[#EFF6FF] hover:text-[#0066FF]"
          >
            <MessageSquareHeart className="size-4 text-[#0066FF]" aria-hidden="true" />
            <span>Ask Gemini AI</span>
          </Link>
          <Link
            to="/patient/summary"
            className="inline-flex min-h-[44px] items-center gap-2 rounded-full border border-[#E5E9F0] bg-white px-4 text-sm font-medium text-[#111827] hover:bg-[#F8FAFC]"
          >
            <ClipboardList className="size-4 text-[#0066FF]" aria-hidden="true" />
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

      {/* Bento KPI Grid matching reference 2x2 / 4-up clinical tiles */}
      <div className="flex items-center gap-2 px-1">
        <span className="size-2 rounded-full bg-[#0066FF]" aria-hidden="true" />
        <h2 className="font-display text-sm font-semibold text-[#111827]">My Vault Condition</h2>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <div className="flex flex-col justify-between rounded-3xl border border-[#E5E9F0] bg-white p-5 shadow-[0_10px_28px_-16px_rgba(15,23,42,0.08)]">
          <div className="flex items-center justify-between">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-[#F3F5F8] text-[#64748B]">
              <FolderLock className="size-5" aria-hidden="true" />
            </span>
            <span className="font-display text-2xl font-bold text-[#111827]">{counts.documents}</span>
          </div>
          <div className="mt-4">
            <div className="text-xs font-medium text-[#64748B]">Stored Documents</div>
            <div className="mt-2 rounded-2xl bg-[#F8FAFC] p-2.5">
              <SparklineTrace />
            </div>
          </div>
        </div>

        {/* Highlighted Electric Cobalt Card matching reference active metric card */}
        <div className="flex flex-col justify-between rounded-3xl bg-[#0066FF] p-5 text-white shadow-[0_18px_36px_-14px_rgba(0,102,255,0.55)]">
          <div className="flex items-center justify-between">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-white/18 text-white">
              <Pill className="size-5" aria-hidden="true" />
            </span>
            <span className="font-display text-2xl font-bold">{counts.active_medications}</span>
          </div>
          <div className="mt-4">
            <div className="text-xs font-medium text-white/85">Active Medications</div>
            <div className="mt-2 rounded-2xl bg-white/14 p-2.5">
              <SparklineTrace accent />
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-3xl border border-[#E5E9F0] bg-white p-5 shadow-[0_10px_28px_-16px_rgba(15,23,42,0.08)]">
          <div className="flex items-center justify-between">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-rose-50 text-[#EF233C]">
              <AlertTriangle className="size-5" aria-hidden="true" />
            </span>
            <span className="font-display text-2xl font-bold text-[#111827]">{counts.flagged_labs}</span>
          </div>
          <div className="mt-4">
            <div className="text-xs font-medium text-[#64748B]">Flagged Lab Values</div>
            <div className="mt-2 rounded-2xl bg-[#F8FAFC] p-2.5">
              <SparklineTrace />
            </div>
          </div>
        </div>

        <div className="flex flex-col justify-between rounded-3xl border border-[#E5E9F0] bg-white p-5 shadow-[0_10px_28px_-16px_rgba(15,23,42,0.08)]">
          <div className="flex items-center justify-between">
            <span className="flex size-10 items-center justify-center rounded-2xl bg-[#EFF6FF] text-[#0066FF]">
              <FileCheck2 className="size-5" aria-hidden="true" />
            </span>
            <span className="font-display text-2xl font-bold text-[#111827]">{counts.conditions}</span>
          </div>
          <div className="mt-4">
            <div className="text-xs font-medium text-[#64748B]">Recorded Conditions</div>
            <div className="mt-2 rounded-2xl bg-[#F8FAFC] p-2.5">
              <SparklineTrace />
            </div>
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-12">
        <Card className="lg:col-span-7">
          <CardHeader className="flex-row items-center justify-between">
            <div>
              <CardTitle>Recent Medical Documents</CardTitle>
              <CardDescription>Chronological vault records ready for timeline or consultation sharing.</CardDescription>
            </div>
            <Link
              to="/patient/vault"
              className="inline-flex items-center gap-1 rounded-full bg-[#EFF6FF] px-3 py-1 text-xs font-semibold text-[#0066FF] hover:bg-[#DBEAFE]"
            >
              <span>View all</span>
              <ArrowUpRight className="size-3.5" aria-hidden="true" />
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
              <div className="flex flex-col divide-y divide-[#EEF1F5]">
                {data.recent_documents.map((doc: any) => (
                  <div key={doc.id} className="flex flex-col gap-1.5 py-3.5 first:pt-0 last:pb-0 sm:flex-row sm:items-center sm:justify-between">
                    <div>
                      <div className="text-sm font-semibold text-[#111827]">{doc.title}</div>
                      <div className="text-xs text-[#64748B]">
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
                <p className="text-xs text-[#64748B]">No current medications recorded.</p>
              ) : (
                <ul className="flex flex-col gap-2.5 text-sm">
                  {data.active_medications.map((m: any) => (
                    <li key={m.id} className="flex items-center justify-between rounded-2xl border border-[#E5E9F0] bg-[#F8FAFC] px-3.5 py-2.5">
                      <span className="font-medium text-[#111827]">{m.medicine_name}</span>
                      <span className="font-mono text-xs text-[#64748B]">
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
                className="flex min-h-[44px] items-center justify-between rounded-2xl border border-[#E5E9F0] bg-[#F8FAFC] px-4 py-2.5 text-sm font-medium text-[#111827] hover:border-[#0066FF]/40 hover:bg-[#EFF6FF]"
              >
                <span className="flex items-center gap-2.5">
                  <Activity className="size-4 text-[#0066FF]" aria-hidden="true" />
                  Ask AI Health Assistant about a lab report
                </span>
                <ArrowUpRight className="size-4 text-[#64748B]" aria-hidden="true" />
              </Link>
              <Link
                to="/patient/share"
                className="flex min-h-[44px] items-center justify-between rounded-2xl border border-[#E5E9F0] bg-[#F8FAFC] px-4 py-2.5 text-sm font-medium text-[#111827] hover:border-[#0066FF]/40 hover:bg-[#EFF6FF]"
              >
                <span className="flex items-center gap-2.5">
                  <Share2 className="size-4 text-[#0066FF]" aria-hidden="true" />
                  Create 30-minute QR code for doctor visit
                </span>
                <ArrowUpRight className="size-4 text-[#64748B]" aria-hidden="true" />
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
                  <div key={idx} className="flex items-center justify-between text-[#64748B]">
                    <span className="font-medium text-[#111827]">{ev.action.replace(/_/g, " ")}</span>
                    <span className="font-mono">{formatDateTime(ev.created_at)}</span>
                  </div>
                ))
              ) : (
                <span className="text-[#64748B]">No recent activity logged yet.</span>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
