import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AlertTriangle, ClipboardList, Download, FileCheck2, Printer, RefreshCw } from "lucide-react";
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
  LoadingState,
} from "@/components/ui/primitives";
import { apiFetch, downloadAuthenticatedBlob } from "@/lib/api";
import { formatDate, formatDateTime } from "@/lib/utils";

export function DoctorSummaryPage() {
  const [summary, setSummary] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [regenerating, setRegenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadLatest = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/vault/summary/latest");
      setSummary(res);
    } catch (err: any) {
      setError(err?.message || "Could not load One-Minute Doctor Summary.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadLatest();
  }, [loadLatest]);

  const handleRegenerate = async () => {
    setRegenerating(true);
    setError(null);
    try {
      const res = await apiFetch("/vault/summary/generate", { method: "POST" });
      setSummary(res);
    } catch (err: any) {
      setError(err?.message || "Failed to regenerate consultation summary.");
    } finally {
      setRegenerating(false);
    }
  };

  if (loading) return <LoadingState message="Compiling your One-Minute Doctor Summary..." />;
  if (error) return <ErrorState message={error} onRetry={loadLatest} />;

  const facts = summary.extracted_facts;
  const ai = summary.ai_generated_summary;

  const hasAnyVerifiedFacts =
    (facts.known_allergies?.length || 0) > 0 ||
    (facts.current_medications?.length || 0) > 0 ||
    (facts.medical_conditions?.length || 0) > 0 ||
    (facts.surgeries_and_hospitalizations?.length || 0) > 0 ||
    (facts.recent_lab_trends?.length || 0) > 0;

  if (!hasAnyVerifiedFacts) {
    return (
      <div className="mx-auto flex max-w-4xl flex-col gap-5">
        <div>
          <h1 className="font-display text-2xl font-bold text-primary">One-Minute Doctor Summary</h1>
          <p className="text-sm text-muted-foreground">
            Automatically compiles allergies, active prescriptions, conditions, and lab trends once vault documents are verified.
          </p>
        </div>
        <Card>
          <CardContent className="py-10">
            <EmptyState
              icon={ClipboardList}
              title="Your doctor summary will appear here once medical records are uploaded and verified."
              description="Upload a prescription, lab report, or discharge summary in My Medical Vault and confirm the extracted fields to generate your consultation summary."
            />
            <div className="mt-4 flex justify-center">
              <Link
                to="/patient/vault"
                className="inline-flex min-h-[44px] items-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                Go to Medical Vault
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-primary">One-Minute Doctor Summary</h1>
          <p className="text-sm text-muted-foreground">
            Generated {formatDateTime(summary.generated_at)} · Explicitly separates verified vault facts from automated
            synthesis.
          </p>
        </div>
        <div className="no-print flex flex-wrap gap-2">
          <Button variant="outline" onClick={handleRegenerate} disabled={regenerating}>
            <RefreshCw className={`size-4 ${regenerating ? "animate-spin" : ""}`} aria-hidden="true" />
            <span>{regenerating ? "Refreshing..." : "Refresh Summary"}</span>
          </Button>
          <Button variant="outline" onClick={() => window.print()}>
            <Printer className="size-4" aria-hidden="true" />
            <span>Print Summary</span>
          </Button>
          <Button
            variant="accent"
            onClick={() =>
              downloadAuthenticatedBlob(
                `/vault/summary/${summary.summary_id}/pdf`,
                `Ayuva_Doctor_Summary_${summary.summary_id}.pdf`
              )
            }
          >
            <Download className="size-4" aria-hidden="true" />
            <span>Download Consultation PDF</span>
          </Button>
        </div>
      </div>

      {/* Section B: Automated Consultation Brief clearly demarcated */}
      <Card className="border-[#66A9EC]">
        <CardHeader className="bg-card">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <CardTitle className="text-base text-[#0369A1]">Automated Consultation Brief (AI Synthesis)</CardTitle>
              <CardDescription>{ai.provenance_label}</CardDescription>
            </div>
            <Badge variant="teal">Engine: {ai.model_mode}</Badge>
          </div>
        </CardHeader>
        <CardContent className="flex flex-col gap-4 pt-4 text-sm">
          <p className="leading-relaxed text-foreground">{ai.one_minute_brief}</p>
          <div className="grid gap-4 md:grid-cols-2">
            <div className="rounded-md border border-border bg-background p-3.5">
              <div className="text-xs font-semibold uppercase tracking-wide text-primary">
                Suggested Discussion Topics for Doctor
              </div>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-xs text-foreground">
                {ai.suggested_clinician_review_topics.map((t: string, i: number) => (
                  <li key={i}>{t}</li>
                ))}
              </ul>
            </div>
            <div className="rounded-md border border-amber-300 bg-amber-50 p-3.5">
              <div className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-amber-900">
                <AlertTriangle className="size-3.5 text-amber-400" aria-hidden="true" />
                Missing or Uncertain Information
              </div>
              <ul className="mt-2 flex list-disc flex-col gap-1 pl-4 text-xs text-amber-900">
                {ai.missing_or_uncertain_information.length ? (
                  ai.missing_or_uncertain_information.map((m: string, i: number) => <li key={i}>{m}</li>)
                ) : (
                  <li>All primary patient demographics and verified records are present.</li>
                )}
              </ul>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* Section A: Verified Extracted Facts */}
      <div className="flex items-center justify-between">
        <h2 className="font-display text-lg font-bold text-primary">
          Verified Extracted Facts (From {facts.verified_documents_count} of {facts.total_documents_in_vault} Vault Documents)
        </h2>
        <Badge variant="verified">
          <FileCheck2 className="size-3.5" aria-hidden="true" />
          Source-Backed Facts
        </Badge>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Patient Identity &amp; Known Allergies</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-xs">
            <div className="grid grid-cols-2 gap-2 rounded-md border border-border bg-background p-3">
              <div>
                <span className="text-muted-foreground">Name:</span>{" "}
                <span className="font-semibold">{facts.patient.full_name}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Blood Group:</span>{" "}
                <span className="font-semibold">{facts.patient.blood_group || "Not recorded"}</span>
              </div>
              <div>
                <span className="text-muted-foreground">Date of Birth:</span>{" "}
                <span className="font-semibold">
                  {formatDate(facts.patient.date_of_birth)}
                  {facts.patient.age_years ? ` (${facts.patient.age_years} yrs)` : ""}
                </span>
              </div>
              <div>
                <span className="text-muted-foreground">Gender:</span>{" "}
                <span className="font-semibold">{facts.patient.gender || "Not recorded"}</span>
              </div>
            </div>
            <div>
              <div className="mb-1.5 font-semibold text-primary">Known Allergies</div>
              {facts.known_allergies.length === 0 ? (
                <Alert variant="info">No allergies documented in vault records.</Alert>
              ) : (
                <div className="flex flex-wrap gap-2">
                  {facts.known_allergies.map((a: any, i: number) => (
                    <Badge key={i} variant="critical">
                      {a.allergen} ({a.severity}) {a.reaction ? `- ${a.reaction}` : ""}
                    </Badge>
                  ))}
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Current Medications &amp; Documented Conditions</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-xs">
            <div>
              <div className="mb-1.5 font-semibold text-primary">
                Current Medications ({facts.current_medications.length})
              </div>
              {facts.current_medications.length === 0 ? (
                <span className="text-muted-foreground">None documented as active</span>
              ) : (
                <ul className="flex flex-col gap-1.5">
                  {facts.current_medications.map((m: any, i: number) => (
                    <li key={i} className="flex items-center justify-between rounded border border-border px-2.5 py-1.5">
                      <span className="font-semibold">{m.medicine_name}</span>
                      <span className="font-mono text-muted-foreground">
                        {[m.dosage, m.frequency].filter(Boolean).join(" · ") || "See Rx"}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
            {facts.past_or_older_medications?.length > 0 && (
              <div>
                <div className="mb-1.5 font-semibold text-amber-900">
                  Past / Older Prescriptions Requiring Confirmation ({facts.past_or_older_medications.length})
                </div>
                <ul className="flex flex-col gap-1">
                  {facts.past_or_older_medications.map((m: any, i: number) => (
                    <li key={i} className="flex items-center justify-between rounded border border-amber-300 bg-amber-50 px-2.5 py-1.5 text-amber-950">
                      <span className="font-medium">{m.medicine_name} {m.dosage || ""}</span>
                      <span>{m.status_note}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}
            <div>
              <div className="mb-1.5 font-semibold text-primary">Conditions ({facts.documented_conditions.length})</div>
              <div className="flex flex-wrap gap-1.5">
                {facts.documented_conditions.map((c: any, i: number) => (
                  <Badge key={i} variant={c.status === "resolved" ? "low" : "moderate"}>
                    {c.condition_name} ({c.status})
                  </Badge>
                ))}
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Lab Trends Table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-sm">Laboratory Results &amp; Historical Trends</CardTitle>
          <CardDescription>Compares earliest vs. latest numeric test values with matching units.</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {facts.lab_trends.length === 0 ? (
            <p className="text-xs text-muted-foreground">No structured lab trends available yet.</p>
          ) : (
            <table className="w-full min-w-[640px] text-left text-xs">
              <thead>
                <tr className="border-b border-border text-muted-foreground">
                  <th className="py-2 pr-3 font-semibold">Test Name</th>
                  <th className="py-2 pr-3 font-semibold">Latest Value</th>
                  <th className="py-2 pr-3 font-semibold">Reference Range</th>
                  <th className="py-2 pr-3 font-semibold">Historical Comparison</th>
                  <th className="py-2 font-semibold">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {facts.lab_trends.map((t: any, idx: number) => (
                  <tr key={idx}>
                    <td className="py-2.5 pr-3 font-medium text-foreground">{t.test_name}</td>
                    <td className="py-2.5 pr-3 font-mono font-semibold">
                      {t.latest_value} {t.unit}
                    </td>
                    <td className="py-2.5 pr-3 font-mono text-muted-foreground">{t.reference_range || "-"}</td>
                    <td className="py-2.5 pr-3 text-muted-foreground">
                      {t.trend === "single_reading"
                        ? `Single reading (${t.latest_date})`
                        : `${t.earliest_value} (${t.earliest_date}) -> ${t.latest_value} (${t.latest_date}) [${t.delta > 0 ? "+" : ""}${t.delta}]`}
                    </td>
                    <td className="py-2.5">
                      <Badge variant={t.latest_flag === "normal" ? "low" : t.latest_flag === "critical" ? "critical" : "high"}>
                        {t.latest_flag.toUpperCase()}
                      </Badge>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </CardContent>
      </Card>

      {/* Surgeries, Hospitalizations, Consultations & Source Records */}
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Previous Surgeries &amp; Hospitalizations</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-xs">
            <div>
              <div className="mb-1 font-semibold text-primary">Previous Surgeries</div>
              {facts.previous_surgeries?.length ? (
                facts.previous_surgeries.map((s: any, i: number) => (
                  <div key={i} className="mb-1.5 rounded border border-border bg-background p-2.5">
                    <div className="font-semibold text-foreground">
                      {s.title} ({formatDate(s.date)})
                    </div>
                    <div className="text-muted-foreground">{s.hospital_name || "Hospital not recorded"}</div>
                    {s.description && <div className="mt-0.5">{s.description}</div>}
                  </div>
                ))
              ) : (
                <span className="text-muted-foreground">None recorded in vault.</span>
              )}
            </div>
            <div>
              <div className="mb-1 font-semibold text-primary">Important Hospitalizations</div>
              {facts.important_hospitalizations?.length ? (
                facts.important_hospitalizations.map((s: any, i: number) => (
                  <div key={i} className="mb-1.5 rounded border border-border bg-background p-2.5">
                    <div className="font-semibold text-foreground">
                      {s.title} ({formatDate(s.date)})
                    </div>
                    <div className="text-muted-foreground">{s.hospital_name || "Hospital not recorded"}</div>
                  </div>
                ))
              ) : (
                <span className="text-muted-foreground">No inpatient hospitalizations recorded.</span>
              )}
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-sm">Recent Visits &amp; Source Vault Records ({facts.source_records?.length || 0})</CardTitle>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-xs">
            <div className="flex flex-col gap-1.5">
              {facts.recent_consultations.map((c: any, i: number) => (
                <div key={i} className="flex items-start justify-between gap-2 rounded border border-border bg-background p-2.5">
                  <div>
                    <div className="font-semibold text-foreground">{c.title}</div>
                    <div className="text-muted-foreground">
                      {[c.doctor_name, c.hospital_name].filter(Boolean).join(" · ") || "Facility unspecified"}
                    </div>
                  </div>
                  <span className="font-mono text-muted-foreground shrink-0">{formatDate(c.date)}</span>
                </div>
              ))}
            </div>
            {facts.source_records?.length > 0 && (
              <div className="border-t border-border pt-2.5">
                <div className="mb-1 font-semibold text-primary">Source Documents Referenced</div>
                <div className="flex flex-wrap gap-1.5">
                  {facts.source_records.map((sr: any) => (
                    <Badge key={sr.id} variant={sr.is_verified ? "verified" : "neutral"}>
                      #{sr.id} {sr.title} ({sr.document_date || "undated"})
                    </Badge>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
