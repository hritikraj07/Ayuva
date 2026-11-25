import React, { Suspense, useCallback, useEffect, useState } from "react";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Bell,
  CheckCircle2,
  CloudRain,
  Database,
  Globe2,
  Info,
  MapPin,
  RefreshCw,
  Sliders,
} from "lucide-react";

const OutbreakGlobe3D = React.lazy(() =>
  import("@/components/three/OutbreakGlobe3D").then((m) => ({ default: m.OutbreakGlobe3D }))
);
import {
  Bar,
  BarChart,
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { OutbreakRiskMap } from "@/components/OutbreakRiskMap";
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
import { formatDate, formatDateTime } from "@/lib/utils";

type AdminSection = "overview" | "prediction" | "map" | "analytics" | "simulator" | "alerts";

const STANDARD_SEIR_DISEASES = [
  "Acute Diarrhoeal Disease",
  "Cholera",
  "Dengue",
  "Malaria",
  "Food Poisoning",
  "Chikungunya",
  "Hepatitis A",
  "Measles",
  "Influenza",
];

function RiskBadge({ level }: { level: string }) {
  const variant = (
    ["low", "moderate", "high", "critical", "insufficient_data"].includes(level)
      ? level
      : "insufficient_data"
  ) as "low" | "moderate" | "high" | "critical" | "insufficient_data";
  return (
    <Badge variant={variant}>
      {level === "insufficient_data" ? "INSUFFICIENT DATA" : level.toUpperCase()}
    </Badge>
  );
}

export function AdminOutbreakView({ section }: { section: AdminSection }) {
  const [selectedDisease, setSelectedDisease] = useState<string>("");
  const [overview, setOverview] = useState<any>(null);
  const [syncRuns, setSyncRuns] = useState<any[]>([]);
  const [selectedRegionId, setSelectedRegionId] = useState<number | null>(null);
  const [regionHistory, setRegionHistory] = useState<any>(null);

  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [training, setTraining] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState<string | null>(null);

  // Input-driven SEIR Simulator state
  const [simName, setSimName] = useState("District Surge Response Plan");
  const [simRegionId, setSimRegionId] = useState<number | "">("");
  const [simDisease, setSimDisease] = useState("Acute Diarrhoeal Disease");
  const [initialActiveCases, setInitialActiveCases] = useState<number>(35);
  const [availableBeds, setAvailableBeds] = useState<number>(50);
  const [medicalStaff, setMedicalStaff] = useState<number>(20);
  const [populationOverride, setPopulationOverride] = useState<string>("");
  const [preventionPct, setPreventionPct] = useState<number>(35);
  const [vaccinationPct, setVaccinationPct] = useState<number>(20);
  const [budgetUsd, setBudgetUsd] = useState<number>(100000);
  const [startDay, setStartDay] = useState<number>(4);
  const [simLoading, setSimLoading] = useState(false);
  const [simError, setSimError] = useState<string | null>(null);
  const [simResults, setSimResults] = useState<any>(null);
  const [scenarios, setScenarios] = useState<any[]>([]);

  const loadData = useCallback(async (diseaseOverride?: string) => {
    setLoading(true);
    setError(null);
    try {
      const targetDisease = diseaseOverride !== undefined ? diseaseOverride : selectedDisease;
      const query = targetDisease ? `?disease=${encodeURIComponent(targetDisease)}` : "";
      const [ovRes, runsRes, scenRes] = await Promise.all([
        apiFetch(`/outbreak/overview${query}`),
        apiFetch("/outbreak/sync/runs"),
        apiFetch("/outbreak/simulator/scenarios"),
      ]);
      setOverview(ovRes);
      setSyncRuns(runsRes.runs || []);
      setScenarios(scenRes.scenarios || []);

      const activeDisease = ovRes.summary?.selected_disease || "";
      if (activeDisease && activeDisease !== selectedDisease) {
        setSelectedDisease(activeDisease);
      }

      const regions = ovRes.regions || [];
      if (regions.length > 0) {
        setSimRegionId((prev) => (prev === "" ? regions[0].id : prev));
        setSelectedRegionId((prev) => (prev === null ? regions[0].id : prev));
      }
      if (ovRes.available_diseases?.length > 0 && !ovRes.available_diseases.includes(simDisease)) {
        setSimDisease(ovRes.available_diseases[0]);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load outbreak surveillance data.");
    } finally {
      setLoading(false);
    }
  }, [selectedDisease, simDisease]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  useEffect(() => {
    if (!selectedRegionId) return;
    let cancelled = false;
    const q = selectedDisease ? `?disease=${encodeURIComponent(selectedDisease)}` : "";
    apiFetch(`/outbreak/regions/${selectedRegionId}/history${q}`)
      .then((res) => {
        if (!cancelled) setRegionHistory(res);
      })
      .catch(() => {
        if (!cancelled) setRegionHistory(null);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedRegionId, selectedDisease]);

  const handleSyncPublicData = async () => {
    setSyncing(true);
    setError(null);
    setStatusMessage(null);
    try {
      const res = await apiFetch("/outbreak/sync?weeks_to_fetch=8", { method: "POST" });
      setStatusMessage(
        `Sync complete: fetched ${res.documents_fetched || 0} IDSP PDFs, imported ${res.records_imported || 0} new reports, skipped ${res.duplicates_skipped || 0} duplicates, geocoded ${res.regions_geocoded || 0} districts.`
      );
      await loadData("");
    } catch (err: any) {
      setError(err?.message || "Public health sync failed.");
    } finally {
      setSyncing(false);
    }
  };

  const handleRetrain = async () => {
    if (!selectedDisease) return;
    setTraining(true);
    setError(null);
    setStatusMessage(null);
    try {
      const res = await apiFetch(`/outbreak/train?disease=${encodeURIComponent(selectedDisease)}`, {
        method: "POST",
      });
      setStatusMessage(
        res.status === "trained"
          ? `Model trained for ${res.disease}: accuracy=${res.metrics?.accuracy ?? "N/A"}, ROC-AUC=${res.metrics?.roc_auc ?? "N/A"}.`
          : `Model reported insufficient data for ${res.disease}: ${res.reason}`
      );
      await loadData(selectedDisease);
    } catch (err: any) {
      setError(err?.message || "ML training run failed.");
    } finally {
      setTraining(false);
    }
  };

  const handleAcknowledgeAlert = async (alertId: number) => {
    await apiFetch(`/outbreak/alerts/${alertId}/acknowledge`, { method: "POST" });
    await loadData(selectedDisease);
  };

  const handleRunSimulator = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!simRegionId) return;
    setSimLoading(true);
    setSimError(null);
    try {
      const popNum = populationOverride.trim() ? Number(populationOverride) : null;
      const res = await apiFetch("/outbreak/simulator/run", {
        method: "POST",
        body: JSON.stringify({
          name: simName,
          region_id: Number(simRegionId),
          disease: simDisease,
          initial_active_cases: Number(initialActiveCases),
          population_override: popNum,
          available_beds: Number(availableBeds),
          medical_staff: Number(medicalStaff),
          prevention_coverage_pct: Number(preventionPct),
          vaccination_coverage_pct: Number(vaccinationPct),
          budget_usd: Number(budgetUsd),
          intervention_start_day: Number(startDay),
        }),
      });
      setSimResults(res);
      const scenRes = await apiFetch("/outbreak/simulator/scenarios");
      setScenarios(scenRes.scenarios || []);
    } catch (err: any) {
      setSimError(err?.message || "Failed to execute simulation.");
    } finally {
      setSimLoading(false);
    }
  };

  if (loading) return <LoadingState message="Loading official disease surveillance workspace..." />;
  if (error && !overview) return <ErrorState message={error} onRetry={() => loadData()} />;

  const summary = overview?.summary || {};
  const availableDiseases: string[] = overview?.available_diseases || [];
  const regions: any[] = overview?.regions || [];
  const predictions: any[] = overview?.predictions || [];
  const modelMetrics = overview?.model_metrics || {};
  const recentReports: any[] = overview?.recent_reports || [];
  const weatherObs: any[] = overview?.weather_observations || [];
  const alerts: any[] = overview?.alerts || [];
  const hasAnySyncedData = summary.total_reports > 0 || regions.length > 0;
  const selectedSimRegion = regions.find((r) => r.id === Number(simRegionId));

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-6">
      {/* Global Admin Surveillance Header */}
      <div className="flex flex-col gap-4 border-b border-border pb-4 lg:flex-row lg:items-center lg:justify-between">
        <div>
          <h1 className="font-display text-2xl font-bold text-primary">
            Public Health &amp; Outbreak Intelligence
          </h1>
          <p className="text-sm text-muted-foreground">
            Live ingestion from NCDC/IDSP weekly outbreak bulletins and Open-Meteo environmental APIs. Zero seeded data.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          {availableDiseases.length > 0 && (
            <select
              aria-label="Select monitored disease"
              value={selectedDisease}
              onChange={(e) => {
                setSelectedDisease(e.target.value);
                loadData(e.target.value);
              }}
              className="min-h-[44px] rounded-md border border-input bg-card px-3 text-sm font-medium"
            >
              {availableDiseases.map((d) => (
                <option key={d} value={d}>
                  {d}
                </option>
              ))}
            </select>
          )}
          <Button variant="primary" onClick={handleSyncPublicData} disabled={syncing}>
            <RefreshCw className={`size-4 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" />
            <span>{syncing ? "Syncing IDSP & Weather..." : "Sync Public Health Data"}</span>
          </Button>
          {selectedDisease && (
            <Button variant="secondary" onClick={handleRetrain} disabled={training}>
              <Activity className="size-4" aria-hidden="true" />
              <span>{training ? "Evaluating ML..." : "Run ML Evaluation"}</span>
            </Button>
          )}
        </div>
      </div>

      {statusMessage && (
        <Alert variant="info" title="Surveillance Action Complete">
          {statusMessage}
        </Alert>
      )}
      {error && <Alert variant="danger" title="Surveillance Error">{error}</Alert>}

      {/* Honest Empty State prior to initial live sync */}
      {!hasAnySyncedData && section !== "simulator" && (
        <Card>
          <CardContent className="py-10">
            <EmptyState
              icon={Database}
              title="No public health surveillance data synced yet"
              description="Click 'Sync Public Health Data' above to fetch verified 2026 NCDC/IDSP weekly outbreak PDFs, geocode affected districts, and retrieve Open-Meteo temperature, precipitation, and humidity records."
            />
          </CardContent>
        </Card>
      )}

      {/* SECTION 1: OVERVIEW */}
      {section === "overview" && hasAnySyncedData && (
        <>
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Card>
              <CardContent className="pt-5">
                <div className="text-xs font-medium text-muted-foreground">Verified Outbreak Reports</div>
                <div className="mt-1 font-mono text-2xl font-bold text-primary">{summary.total_reports}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Disease: {summary.selected_disease || "None"}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="text-xs font-medium text-muted-foreground">Observed Cases / Deaths</div>
                <div className="mt-1 font-mono text-2xl font-bold text-primary">
                  {summary.total_cases_observed} / {summary.total_deaths_observed}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">Strictly from NCDC/IDSP tables</div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="text-xs font-medium text-muted-foreground">Monitored Districts</div>
                <div className="mt-1 font-mono text-2xl font-bold text-secondary">{summary.monitored_regions}</div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Rated: {summary.rated_regions} | Insufficient Data: {summary.insufficient_data_regions}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardContent className="pt-5">
                <div className="text-xs font-medium text-muted-foreground">Last Official Sync</div>
                <div className="mt-1 font-mono text-sm font-bold text-primary">
                  {summary.last_sync_at ? formatDateTime(summary.last_sync_at) : "Never"}
                </div>
                <div className="mt-1 text-[11px] text-muted-foreground">
                  Status: {summary.last_sync_status} | Alerts: {summary.active_alerts}
                </div>
              </CardContent>
            </Card>
          </div>

          <div className="grid gap-6 lg:grid-cols-12">
            <Card className="lg:col-span-7">
              <CardHeader>
                <CardTitle className="text-sm">Recent Verified Official Outbreak Reports</CardTitle>
                <CardDescription>Deduplicated by unique IDSP outbreak code with source PDF provenance</CardDescription>
              </CardHeader>
              <CardContent className="overflow-x-auto">
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 pr-3">IDSP Code</th>
                      <th className="py-2 pr-3">District / State</th>
                      <th className="py-2 pr-3">Week</th>
                      <th className="py-2 pr-3">Cases / Deaths</th>
                      <th className="py-2">Bulletin PDF</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentReports.slice(0, 20).map((rep) => (
                      <tr key={rep.id} className="border-b border-border/60">
                        <td className="py-2 pr-3 font-mono text-[11px] font-semibold text-primary">
                          {rep.unique_outbreak_id}
                        </td>
                        <td className="py-2 pr-3">
                          <div className="font-medium">{rep.district}</div>
                          <div className="text-[11px] text-muted-foreground">{rep.state}</div>
                        </td>
                        <td className="py-2 pr-3 font-mono">
                          {rep.reporting_year}-W{String(rep.reporting_week).padStart(2, "0")}
                        </td>
                        <td className="py-2 pr-3 font-mono font-semibold">
                          {rep.cases} / {rep.deaths}
                        </td>
                        <td className="py-2">
                          <a
                            href={rep.source_url}
                            target="_blank"
                            rel="noreferrer"
                            className="text-secondary hover:underline"
                          >
                            {rep.source_document_id}
                          </a>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </CardContent>
            </Card>

            <Card className="lg:col-span-5">
              <CardHeader>
                <CardTitle className="text-sm">Data Synchronization Audit Trail</CardTitle>
                <CardDescription>Real network fetches logged per sync run</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                {syncRuns.map((run) => (
                  <div key={run.id} className="rounded-md border border-border bg-muted/20 p-3 text-xs">
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-primary">{run.source_name}</span>
                      <Badge variant={run.status === "completed" ? "verified" : "high"}>{run.status}</Badge>
                    </div>
                    <div className="mt-1.5 font-mono text-[11px] text-muted-foreground">
                      Bulletins: {run.documents_fetched} | Imported: {run.records_imported} | Deduplicated:{" "}
                      {run.duplicates_skipped}
                    </div>
                    <div className="mt-1 text-[11px] text-muted-foreground">
                      Started: {formatDateTime(run.started_at)}
                    </div>
                    {run.error_message && <div className="mt-1 text-destructive">{run.error_message}</div>}
                  </div>
                ))}
              </CardContent>
            </Card>
          </div>
        </>
      )}

      {/* SECTION 2: PREDICTION */}
      {section === "prediction" && hasAnySyncedData && (
        <>
          {modelMetrics.status !== "trained" ? (
            <Alert variant="warning" title="ML Forecast Not Calibrated (Insufficient Multi-Week Transitions)">
              {modelMetrics.insufficient_reason ||
                "Insufficient sequential multi-week observations exist for this disease to fit a validated classifier. Districts display observed IDSP counts and Insufficient Data risk status rather than guessed probabilities."}
            </Alert>
          ) : (
            <Alert variant="info" title={`Chronological ML Evaluation (${modelMetrics.model_name} ${modelMetrics.model_version})`}>
              Training window: <strong>{modelMetrics.training_data_period}</strong> | Target window:{" "}
              <strong>{modelMetrics.target_period}</strong> | Holdout Accuracy:{" "}
              <strong>{modelMetrics.accuracy ?? "N/A"}</strong> | Holdout ROC-AUC:{" "}
              <strong>{modelMetrics.roc_auc ?? "N/A"}</strong>
            </Alert>
          )}

          {overview?.feature_importances?.length > 0 && (
            <Card>
              <CardHeader>
                <CardTitle className="text-sm">RandomForestClassifier Feature Importances</CardTitle>
                <CardDescription>Measured contribution across IDSP case history and Open-Meteo covariates</CardDescription>
              </CardHeader>
              <CardContent className="h-[260px]">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={overview.feature_importances.slice(0, 7)}
                    layout="vertical"
                    margin={{ left: 160, right: 20, top: 8, bottom: 8 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" stroke="#1E335A" />
                    <XAxis type="number" tick={{ fontSize: 11, fill: "#94A9C9" }} />
                    <YAxis type="category" dataKey="label" tick={{ fontSize: 11, fill: "#E6F1FF" }} width={155} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: "#061124",
                        borderColor: "#22D3EE",
                        borderRadius: "8px",
                        fontSize: "12px",
                      }}
                    />
                    <Bar dataKey="importance" name="Feature Importance" fill="#22D3EE" radius={[0, 4, 4, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </CardContent>
            </Card>
          )}

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">District Risk Classification ({selectedDisease})</CardTitle>
              <CardDescription>
                Districts lacking disease observations remain rated as Insufficient Data rather than low risk
              </CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 pr-3">District</th>
                    <th className="py-2 pr-3">Recent Cases / Deaths</th>
                    <th className="py-2 pr-3">Surge Prob / Risk</th>
                    <th className="py-2 pr-3">Classification</th>
                    <th className="py-2">Uncertainty &amp; Notes</th>
                  </tr>
                </thead>
                <tbody>
                  {predictions.map((p) => (
                    <tr key={p.id} className="border-b border-border/60">
                      <td className="py-2.5 pr-3">
                        <div className="font-semibold text-primary">{p.region_name}</div>
                        <div className="text-[11px] text-muted-foreground">{p.state}</div>
                      </td>
                      <td className="py-2.5 pr-3 font-mono font-semibold">
                        {p.observed_cases_recent} / {p.observed_deaths_recent}
                      </td>
                      <td className="py-2.5 pr-3 font-mono">
                        {p.outbreak_probability !== null
                          ? `${Math.round(p.outbreak_probability * 100)}% (${p.risk_score}/100)`
                          : "N/A"}
                      </td>
                      <td className="py-2.5 pr-3">
                        <RiskBadge level={p.risk_level} />
                      </td>
                      <td className="py-2.5 text-[11px] text-muted-foreground">{p.confidence_or_uncertainty}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </>
      )}

      {/* SECTION 3: MAP */}
      {section === "map" && hasAnySyncedData && (
        <div className="flex flex-col gap-6">
          <div className="grid gap-6 lg:grid-cols-12">
            <Card className="lg:col-span-7">
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-sm">
                  <Globe2 className="size-4 text-primary" aria-hidden="true" />
                  Interactive 3D Epidemiological Globe ({selectedDisease})
                </CardTitle>
                <CardDescription>
                  Click any synced NCDC/IDSP district marker on the 3D globe or inspect the 2D Leaflet layer below.
                </CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col gap-3">
                <Suspense
                  fallback={
                    <div className="neo-glass flex h-[360px] items-center justify-center rounded-xl text-xs text-muted-foreground">
                      Loading 3D Epidemiological Globe...
                    </div>
                  }
                >
                  <OutbreakGlobe3D
                    regions={predictions}
                    selectedRegionId={selectedRegionId}
                    onSelectRegion={(id) => setSelectedRegionId(id)}
                    heightClass="h-[360px]"
                  />
                </Suspense>
                <OutbreakRiskMap
                  predictions={predictions}
                  selectedRegionId={selectedRegionId}
                  onSelectRegion={(id) => setSelectedRegionId(id)}
                />
                <div className="flex flex-wrap gap-2 text-xs">
                  <RiskBadge level="low" />
                  <RiskBadge level="moderate" />
                  <RiskBadge level="high" />
                  <RiskBadge level="critical" />
                  <RiskBadge level="insufficient_data" />
                </div>
              </CardContent>
            </Card>

          <Card className="lg:col-span-5">
            <CardHeader>
              <CardTitle className="text-sm">
                {regionHistory?.region?.name || "Select a District"} Details
              </CardTitle>
              <CardDescription>
                Separated NCDC/IDSP weekly reports and Open-Meteo weather observations
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4 text-xs">
              {!regionHistory ? (
                <p className="text-muted-foreground">Click any marker on the map to inspect district history.</p>
              ) : (
                <>
                  <div className="rounded-md border border-border bg-muted/20 p-3">
                    <div className="font-semibold text-primary">
                      {regionHistory.region.name}, {regionHistory.region.state}
                    </div>
                    <div className="mt-1 text-muted-foreground">
                      Coords: {regionHistory.region.latitude?.toFixed(3)}, {regionHistory.region.longitude?.toFixed(3)} |
                      Population:{" "}
                      {regionHistory.region.population ? regionHistory.region.population.toLocaleString() : "Unavailable"}
                    </div>
                  </div>
                  <div>
                    <div className="mb-1.5 font-semibold text-primary">Verified IDSP Weekly Bulletins</div>
                    {regionHistory.outbreak_reports?.length ? (
                      <div className="flex flex-col gap-1.5">
                        {regionHistory.outbreak_reports.map((r: any) => (
                          <div
                            key={r.unique_outbreak_id}
                            className="flex items-center justify-between rounded border border-border px-2.5 py-1.5"
                          >
                            <span className="font-mono">{r.period} ({r.unique_outbreak_id})</span>
                            <span className="font-mono font-semibold">
                              {r.cases} cases / {r.deaths} deaths
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">No reports for {selectedDisease} in this district.</p>
                    )}
                  </div>
                  <div>
                    <div className="mb-1.5 font-semibold text-primary">Recent Open-Meteo Weather</div>
                    {regionHistory.weather_observations?.length ? (
                      <div className="flex flex-col gap-1">
                        {regionHistory.weather_observations.slice(-5).map((w: any, idx: number) => (
                          <div key={idx} className="flex items-center justify-between text-[11px] text-muted-foreground">
                            <span>
                              {formatDate(w.obs_date)} ({w.is_forecast ? "Forecast" : "Historical"})
                            </span>
                            <span className="font-mono">
                              {w.temperature_c ?? "-"} C | {w.precipitation_mm ?? "-"} mm | {w.humidity_pct ?? "-"}% RH
                            </span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <p className="text-muted-foreground">No Open-Meteo weather rows stored for this district.</p>
                    )}
                  </div>
                </>
              )}
            </CardContent>
          </Card>
          </div>
        </div>
      )}

      {/* SECTION 4: ANALYTICS */}
      {section === "analytics" && hasAnySyncedData && (
        <div className="grid gap-6 lg:grid-cols-2">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <BarChart3 className="size-4 text-secondary" aria-hidden="true" />
                Observed Weekly Cases ({selectedDisease})
              </CardTitle>
              <CardDescription>Source: Official NCDC/IDSP Weekly Outbreak PDFs</CardDescription>
            </CardHeader>
            <CardContent className="h-[300px]">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={recentReports.slice(0, 12)}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#1E335A" />
                  <XAxis dataKey="district" tick={{ fontSize: 10, fill: "#94A9C9" }} />
                  <YAxis tick={{ fontSize: 11, fill: "#94A9C9" }} />
                  <Tooltip
                    contentStyle={{
                      backgroundColor: "#061124",
                      borderColor: "#22D3EE",
                      borderRadius: "8px",
                      fontSize: "12px",
                    }}
                  />
                  <Bar dataKey="cases" name="Observed Cases" fill="#22D3EE" radius={[4, 4, 0, 0]} />
                </BarChart>
              </ResponsiveContainer>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <CloudRain className="size-4 text-secondary" aria-hidden="true" />
                Environmental Covariates (Open-Meteo)
              </CardTitle>
              <CardDescription>Stored separately from disease counts; labels historical vs forecast</CardDescription>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead>
                  <tr className="border-b border-border text-muted-foreground">
                    <th className="py-2 pr-2">District</th>
                    <th className="py-2 pr-2">Date</th>
                    <th className="py-2 pr-2">Type</th>
                    <th className="py-2 pr-2">Temp</th>
                    <th className="py-2 pr-2">Precip</th>
                    <th className="py-2">Humidity</th>
                  </tr>
                </thead>
                <tbody>
                  {weatherObs.slice(0, 15).map((w) => (
                    <tr key={w.id} className="border-b border-border/60">
                      <td className="py-1.5 pr-2 font-medium">{w.region_name}</td>
                      <td className="py-1.5 pr-2 font-mono">{formatDate(w.obs_date)}</td>
                      <td className="py-1.5 pr-2">
                        <Badge variant={w.is_forecast ? "teal" : "neutral"}>
                          {w.is_forecast ? "Forecast" : "Observed"}
                        </Badge>
                      </td>
                      <td className="py-1.5 pr-2 font-mono">{w.temperature_c ?? "-"} C</td>
                      <td className="py-1.5 pr-2 font-mono">{w.precipitation_mm ?? "-"} mm</td>
                      <td className="py-1.5 font-mono">{w.humidity_pct ?? "-"}%</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </CardContent>
          </Card>
        </div>
      )}

      {/* SECTION 5: SIMULATOR */}
      {section === "simulator" && (
        <div className="grid gap-6 lg:grid-cols-12">
          <Card className="lg:col-span-5">
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Sliders className="size-4 text-secondary" aria-hidden="true" />
                Input-Driven SEIR Intervention Simulator
              </CardTitle>
              <CardDescription>
                Requires explicit initial caseload, hospital bed capacity, staff, and population inputs
              </CardDescription>
            </CardHeader>
            <CardContent>
              {regions.length === 0 ? (
                <EmptyState
                  icon={Info}
                  title="Sync districts first"
                  description="Click 'Sync Public Health Data' above to populate geocoded districts before running an SEIR simulation."
                />
              ) : (
                <form onSubmit={handleRunSimulator} className="flex flex-col gap-3.5 text-xs">
                  {simError && <Alert variant="danger" title="Simulation Validation Error">{simError}</Alert>}
                  <div className="flex flex-col gap-1">
                    <FieldLabel htmlFor="sim-name">Scenario Name</FieldLabel>
                    <Input id="sim-name" value={simName} onChange={(e) => setSimName(e.target.value)} required />
                  </div>
                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <FieldLabel htmlFor="sim-region">District</FieldLabel>
                      <select
                        id="sim-region"
                        value={simRegionId}
                        onChange={(e) => setSimRegionId(Number(e.target.value))}
                        className="min-h-[44px] rounded-md border border-input bg-card px-2.5"
                      >
                        {regions.map((r) => (
                          <option key={r.id} value={r.id}>
                            {r.name} ({r.population ? `Pop ${r.population.toLocaleString()}` : "Pop required"})
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="flex flex-col gap-1">
                      <FieldLabel htmlFor="sim-disease">Disease</FieldLabel>
                      <select
                        id="sim-disease"
                        value={simDisease}
                        onChange={(e) => setSimDisease(e.target.value)}
                        className="min-h-[44px] rounded-md border border-input bg-card px-2.5"
                      >
                        {Array.from(new Set([...availableDiseases, ...STANDARD_SEIR_DISEASES])).map((d) => (
                          <option key={d} value={d}>
                            {d}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <FieldLabel htmlFor="sim-cases">Initial Active Cases</FieldLabel>
                      <Input
                        id="sim-cases"
                        type="number"
                        min={0}
                        value={initialActiveCases}
                        onChange={(e) => setInitialActiveCases(Number(e.target.value))}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <FieldLabel htmlFor="sim-pop">
                        Target Population {selectedSimRegion?.population ? "(Auto or Override)" : "(Required)"}
                      </FieldLabel>
                      <Input
                        id="sim-pop"
                        type="number"
                        min={1}
                        value={populationOverride}
                        onChange={(e) => setPopulationOverride(e.target.value)}
                        placeholder={selectedSimRegion?.population ? String(selectedSimRegion.population) : "Enter population"}
                      />
                    </div>
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <FieldLabel htmlFor="sim-beds">Available Beds</FieldLabel>
                      <Input
                        id="sim-beds"
                        type="number"
                        min={0}
                        value={availableBeds}
                        onChange={(e) => setAvailableBeds(Number(e.target.value))}
                        required
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <FieldLabel htmlFor="sim-staff">Medical Staff</FieldLabel>
                      <Input
                        id="sim-staff"
                        type="number"
                        min={0}
                        value={medicalStaff}
                        onChange={(e) => setMedicalStaff(Number(e.target.value))}
                        required
                      />
                    </div>
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between">
                      <FieldLabel htmlFor="sim-prev">Prevention Coverage (%)</FieldLabel>
                      <span className="font-mono text-primary">{preventionPct}%</span>
                    </div>
                    <input
                      id="sim-prev"
                      type="range"
                      min={0}
                      max={100}
                      value={preventionPct}
                      onChange={(e) => setPreventionPct(Number(e.target.value))}
                    />
                  </div>

                  <div className="flex flex-col gap-1">
                    <div className="flex justify-between">
                      <FieldLabel htmlFor="sim-vax">Vaccination / Immunization (%)</FieldLabel>
                      <span className="font-mono text-primary">{vaccinationPct}%</span>
                    </div>
                    <input
                      id="sim-vax"
                      type="range"
                      min={0}
                      max={100}
                      value={vaccinationPct}
                      onChange={(e) => setVaccinationPct(Number(e.target.value))}
                    />
                  </div>

                  <div className="grid gap-3 sm:grid-cols-2">
                    <div className="flex flex-col gap-1">
                      <FieldLabel htmlFor="sim-budget">Budget (USD)</FieldLabel>
                      <Input
                        id="sim-budget"
                        type="number"
                        min={0}
                        value={budgetUsd}
                        onChange={(e) => setBudgetUsd(Number(e.target.value))}
                      />
                    </div>
                    <div className="flex flex-col gap-1">
                      <FieldLabel htmlFor="sim-day">Intervention Start Day</FieldLabel>
                      <Input
                        id="sim-day"
                        type="number"
                        min={1}
                        max={28}
                        value={startDay}
                        onChange={(e) => setStartDay(Number(e.target.value))}
                      />
                    </div>
                  </div>

                  <Button type="submit" disabled={simLoading}>
                    <Sliders className="size-4" aria-hidden="true" />
                    <span>{simLoading ? "Running SEIR Solver..." : "Run 30-Day SEIR Simulation"}</span>
                  </Button>
                </form>
              )}
            </CardContent>
          </Card>

          <div className="flex flex-col gap-5 lg:col-span-7">
            <Suspense
              fallback={
                <div className="neo-glass flex h-[220px] items-center justify-center rounded-xl text-xs text-muted-foreground">
                  Loading 3D Simulation Environment...
                </div>
              }
            >
              <OutbreakGlobe3D
                regions={predictions}
                selectedRegionId={simRegionId ? Number(simRegionId) : null}
                onSelectRegion={(id) => setSimRegionId(id)}
                heightClass="h-[220px]"
                simulationActive={Boolean(simResults)}
              />
            </Suspense>

            {simResults ? (
              <>
                <Alert variant="info" title="SEIR Equations &amp; Input Assumptions">
                  <div className="font-mono text-[11px]">{simResults.equations_and_assumptions?.equations}</div>
                  <div className="mt-1 text-xs">
                    Inputs used: Population={simResults.input_parameters?.population_used?.toLocaleString()} (
                    {simResults.input_parameters?.population_source}), Initial Cases=
                    {simResults.input_parameters?.initial_active_cases}, Beds={simResults.input_parameters?.available_beds},
                    Staff={simResults.input_parameters?.medical_staff}.
                  </div>
                </Alert>

                <div className="grid gap-3 sm:grid-cols-3">
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-[11px] text-muted-foreground">Estimated Cases Averted</div>
                      <div className="mt-1 font-mono text-xl font-bold text-emerald-400">
                        {simResults.summary_metrics.estimated_cases_averted}
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        -{simResults.summary_metrics.incidence_reduction_pct}% vs baseline
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-[11px] text-muted-foreground">Peak Hospital Demand</div>
                      <div className="mt-1 font-mono text-xl font-bold text-primary">
                        {simResults.summary_metrics.intervention_peak_hosp_demand} beds
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Baseline peak: {simResults.summary_metrics.baseline_peak_hosp_demand} beds
                      </div>
                    </CardContent>
                  </Card>
                  <Card>
                    <CardContent className="pt-4">
                      <div className="text-[11px] text-muted-foreground">Overload Days</div>
                      <div className="mt-1 font-mono text-xl font-bold text-secondary">
                        {simResults.summary_metrics.intervention_overload_days} days
                      </div>
                      <div className="text-[11px] text-muted-foreground">
                        Baseline: {simResults.summary_metrics.baseline_overload_days} days
                      </div>
                    </CardContent>
                  </Card>
                </div>

                <Card>
                  <CardHeader>
                    <CardTitle className="text-sm">30-Day Daily Incidence Comparison</CardTitle>
                    <CardDescription>{simResults.disclaimer}</CardDescription>
                  </CardHeader>
                  <CardContent className="h-[270px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <LineChart data={simResults.daily_comparison}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#1E335A" />
                        <XAxis dataKey="day" tick={{ fontSize: 10, fill: "#94A9C9" }} />
                        <YAxis tick={{ fontSize: 11, fill: "#94A9C9" }} />
                        <Tooltip
                          contentStyle={{
                            backgroundColor: "#061124",
                            borderColor: "#22D3EE",
                            borderRadius: "8px",
                            fontSize: "12px",
                          }}
                        />
                        <Legend />
                        <Line
                          type="monotone"
                          dataKey="baseline_cases"
                          name="Baseline (No Action)"
                          stroke="#F43F5E"
                          strokeWidth={2.5}
                        />
                        <Line
                          type="monotone"
                          dataKey="intervention_cases"
                          name="With Intervention"
                          stroke="#22D3EE"
                          strokeWidth={2.5}
                        />
                      </LineChart>
                    </ResponsiveContainer>
                  </CardContent>
                </Card>
              </>
            ) : (
              <Card>
                <CardContent className="py-12">
                  <EmptyState
                    icon={Sliders}
                    title="Configure baseline parameters to simulate"
                    description="Enter active cases, available hospital beds, medical staff, and intervention coverage to compute deterministic SEIR curves."
                  />
                </CardContent>
              </Card>
            )}

            {scenarios.length > 0 && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-sm">Saved Intervention Scenarios</CardTitle>
                </CardHeader>
                <CardContent className="overflow-x-auto">
                  <table className="w-full text-left text-xs">
                    <thead>
                      <tr className="border-b border-border text-muted-foreground">
                        <th className="py-2 pr-2">Scenario</th>
                        <th className="py-2 pr-2">District / Disease</th>
                        <th className="py-2 pr-2">Inputs (Cases / Beds / Staff)</th>
                        <th className="py-2">Averted Cases</th>
                      </tr>
                    </thead>
                    <tbody>
                      {scenarios.map((sc) => (
                        <tr key={sc.id} className="border-b border-border/60">
                          <td className="py-2 pr-2 font-medium">{sc.name}</td>
                          <td className="py-2 pr-2">
                            {sc.region_name} ({sc.disease})
                          </td>
                          <td className="py-2 pr-2 font-mono">
                            {sc.initial_active_cases} / {sc.available_beds} / {sc.medical_staff}
                          </td>
                          <td className="py-2 font-mono font-semibold text-emerald-400">
                            {sc.summary_metrics?.estimated_cases_averted ?? 0}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </CardContent>
              </Card>
            )}
          </div>
        </div>
      )}

      {/* SECTION 6: ALERTS */}
      {section === "alerts" && hasAnySyncedData && (
        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-sm">
              <Bell className="size-4 text-secondary" aria-hidden="true" />
              Official Surveillance Alerts
            </CardTitle>
            <CardDescription>Generated strictly from verified IDSP high-caseload or fatal outbreak reports</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {alerts.length === 0 ? (
              <EmptyState
                icon={CheckCircle2}
                title="No active alerts for this selection"
                description="High-severity alerts appear here automatically when synced IDSP reports contain >= 25 cases or reported deaths."
              />
            ) : (
              alerts.map((a) => (
                <div key={a.id} className="flex flex-col gap-2 rounded-lg border border-border bg-card p-4 text-xs sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <AlertTriangle className="size-4 text-rose-400" aria-hidden="true" />
                      <span className="font-semibold text-primary">{a.title}</span>
                      <RiskBadge level={a.severity} />
                      {a.is_acknowledged && <Badge variant="verified">Acknowledged</Badge>}
                    </div>
                    <p className="text-muted-foreground">{a.reason}</p>
                    <div className="font-mono text-[11px] text-muted-foreground">
                      IDSP ID: {a.source_outbreak_id || "N/A"} | Bulletin: {a.source_document_id || "N/A"} | Cases:{" "}
                      {a.metric_value}
                    </div>
                  </div>
                  {!a.is_acknowledged && (
                    <Button variant="outline" size="sm" onClick={() => handleAcknowledgeAlert(a.id)}>
                      Acknowledge
                    </Button>
                  )}
                </div>
              ))
            )}
          </CardContent>
        </Card>
      )}
    </div>
  );
}
