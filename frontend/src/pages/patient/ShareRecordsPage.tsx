import React, { useCallback, useEffect, useState } from "react";
import { Check, Clock, Copy, ExternalLink, Lock, QrCode, ShieldOff } from "lucide-react";
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
  Select,
} from "@/components/ui/primitives";
import { apiFetch } from "@/lib/api";
import { CATEGORY_LABELS, formatCountdown, formatDate, formatDateTime } from "@/lib/utils";

export function ShareRecordsPage() {
  const [docs, setDocs] = useState<any[]>([]);
  const [shares, setShares] = useState<any[]>([]);
  const [auditLogs, setAuditLogs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [title, setTitle] = useState("Doctor Consultation Share");
  const [selectedDocIds, setSelectedDocIds] = useState<number[]>([]);
  const [expiryMinutes, setExpiryMinutes] = useState("30");
  const [pin, setPin] = useState("");
  const [doctorEmail, setDoctorEmail] = useState("");
  const [includeSummary, setIncludeSummary] = useState(true);
  const [creating, setCreating] = useState(false);
  const [copiedId, setCopiedId] = useState<number | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [shareFilter, setShareFilter] = useState<"all" | "active" | "inactive">("all");

  const loadData = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [docRes, shareRes] = await Promise.all([apiFetch("/vault/documents"), apiFetch("/shares")]);
      const docList = docRes.documents || [];
      setDocs(docList);
      setShares(shareRes.shares || []);
      setAuditLogs(shareRes.audit_logs || []);
      if (docList.length && selectedDocIds.length === 0) {
        setSelectedDocIds([docList[0].id]);
      }
    } catch (err: any) {
      setError(err?.message || "Failed to load sharing sessions.");
    } finally {
      setLoading(false);
    }
  }, [selectedDocIds.length]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  const toggleDoc = (id: number) => {
    setSelectedDocIds((prev) => (prev.includes(id) ? prev.filter((d) => d !== id) : [...prev, id]));
  };

  const handleCreateShare = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setMsg(null);
    if (selectedDocIds.length === 0) {
      setError("Select at least one document to include in the temporary share.");
      return;
    }
    if (pin && (pin.trim().length < 4 || pin.trim().length > 8)) {
      setError("Optional PIN must be 4 to 8 characters.");
      return;
    }
    setCreating(true);
    try {
      await apiFetch("/shares", {
        method: "POST",
        body: JSON.stringify({
          title: title.trim() || "Temporary Consultation Share",
          document_ids: selectedDocIds,
          include_summary: includeSummary,
          expiry_minutes: Number(expiryMinutes),
          pin: pin.trim() || null,
          recipient_doctor_email: doctorEmail.trim() || null,
        }),
      });
      setPin("");
      setMsg("Temporary QR share link created. Only the selected documents are accessible.");
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Failed to create sharing session.");
    } finally {
      setCreating(false);
    }
  };

  const handleRevoke = async (id: number) => {
    try {
      await apiFetch(`/shares/${id}/revoke`, { method: "POST" });
      setMsg("Access revoked immediately. Existing links and QR codes are now blocked.");
      await loadData();
    } catch (err: any) {
      setError(err?.message || "Failed to revoke share session.");
    }
  };

  const copyLink = async (id: number, url: string) => {
    await navigator.clipboard.writeText(url);
    setCopiedId(id);
    window.setTimeout(() => setCopiedId(null), 2000);
  };

  if (loading) return <LoadingState message="Loading temporary sharing sessions..." />;

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-primary">Temporary Medical Record Sharing</h1>
        <p className="text-sm text-muted-foreground">
          Share strictly selected documents via expiring QR codes and optional PINs. Unselected vault documents are never
          exposed.
        </p>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}
      {msg && <Alert variant="success">{msg}</Alert>}

      <div className="grid gap-6 lg:grid-cols-12">
        {/* Create Share Form */}
        <Card className="lg:col-span-5">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <QrCode className="size-4 text-[#0066FF]" aria-hidden="true" />
              Create Scoped Share Link &amp; QR
            </CardTitle>
            <CardDescription>Default expiration is 30 minutes for in-clinic consultations.</CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleCreateShare} className="flex flex-col gap-4">
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="sh-title">Share Purpose Label</FieldLabel>
                <Input id="sh-title" value={title} onChange={(e) => setTitle(e.target.value)} required />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="flex flex-col gap-1">
                  <FieldLabel htmlFor="sh-exp">Expiration</FieldLabel>
                  <Select id="sh-exp" value={expiryMinutes} onChange={(e) => setExpiryMinutes(e.target.value)}>
                    <option value="15">15 minutes</option>
                    <option value="30">30 minutes</option>
                    <option value="120">2 hours</option>
                    <option value="1440">24 hours</option>
                    <option value="10080">7 days</option>
                  </Select>
                </div>
                <div className="flex flex-col gap-1">
                  <FieldLabel htmlFor="sh-pin">Optional PIN (4-8 chars)</FieldLabel>
                  <Input
                    id="sh-pin"
                    type="password"
                    placeholder="e.g. 4821"
                    value={pin}
                    onChange={(e) => setPin(e.target.value)}
                  />
                </div>
              </div>

              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="sh-doc-email">Assign to Doctor Account (optional)</FieldLabel>
                <Input
                  id="sh-doc-email"
                  type="email"
                  placeholder="clinician@hospital.org"
                  value={doctorEmail}
                  onChange={(e) => setDoctorEmail(e.target.value)}
                />
              </div>

              <div className="flex flex-col gap-2">
                <FieldLabel>Select Specific Documents to Share ({selectedDocIds.length} selected)</FieldLabel>
                <div className="max-h-52 overflow-y-auto rounded-md border border-border bg-background p-2.5 flex flex-col gap-2">
                  {docs.length === 0 ? (
                    <span className="text-xs text-muted-foreground">Upload documents in My Medical Vault first.</span>
                  ) : (
                    docs.map((d) => (
                      <label key={d.id} className="flex items-start gap-2.5 rounded p-1.5 text-xs hover:bg-card">
                        <input
                          type="checkbox"
                          checked={selectedDocIds.includes(d.id)}
                          onChange={() => toggleDoc(d.id)}
                          className="mt-0.5 size-4 accent-[#0E7C7B]"
                        />
                        <div>
                          <div className="font-semibold text-foreground">{d.title}</div>
                          <div className="text-muted-foreground">
                            {CATEGORY_LABELS[d.category] || d.category} · {formatDate(d.document_date)}
                          </div>
                        </div>
                      </label>
                    ))
                  )}
                </div>
              </div>

              <label className="flex items-center gap-2 text-xs font-medium">
                <input
                  type="checkbox"
                  checked={includeSummary}
                  onChange={(e) => setIncludeSummary(e.target.checked)}
                  className="size-4 accent-[#0E7C7B]"
                />
                <span>Include allergy header &amp; summary scoped strictly to selected documents</span>
              </label>

              <Button type="submit" variant="accent" disabled={creating || docs.length === 0}>
                {creating ? "Generating QR & Token..." : "Generate QR & Temporary Share Link"}
              </Button>
            </form>
          </CardContent>
        </Card>

        {/* Active & Past Share Sessions */}
        <div className="flex flex-col gap-5 lg:col-span-7">
          <Card>
            <CardHeader className="flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div>
                <CardTitle className="text-base">Sharing Sessions ({shares.length})</CardTitle>
                <CardDescription>Monitor access counts, expiration timers, or revoke immediately.</CardDescription>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {(
                  [
                    { id: "all", label: `All (${shares.length})` },
                    { id: "active", label: `Active (${shares.filter((s) => s.is_active).length})` },
                    { id: "inactive", label: `Expired/Revoked (${shares.filter((s) => !s.is_active).length})` },
                  ] as const
                ).map((tab) => (
                  <Button
                    key={tab.id}
                    size="sm"
                    variant={shareFilter === tab.id ? "primary" : "outline"}
                    onClick={() => setShareFilter(tab.id)}
                  >
                    {tab.label}
                  </Button>
                ))}
              </div>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              {shares.filter((s) => (shareFilter === "all" ? true : shareFilter === "active" ? s.is_active : !s.is_active)).length === 0 ? (
                <EmptyState
                  icon={QrCode}
                  title={shares.length === 0 ? "You have not shared any medical records yet." : "No matching share sessions"}
                  description="Pick specific documents on the left to generate an expiring consultation link and QR code."
                />
              ) : (
                shares
                  .filter((s) => (shareFilter === "all" ? true : shareFilter === "active" ? s.is_active : !s.is_active))
                  .map((s) => (
                  <div key={s.id} className="flex flex-col gap-4 rounded-lg border border-border bg-background p-4 sm:flex-row">
                    <div className="shrink-0">
                      <img
                        src={s.qr_data_url}
                        alt={`QR code for ${s.title}`}
                        width={112}
                        height={112}
                        className="size-28 rounded border border-border bg-white p-1"
                      />
                    </div>
                    <div className="flex flex-1 flex-col gap-2 text-xs">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-display text-sm font-semibold text-primary">{s.title}</span>
                        <Badge variant={s.is_active ? "verified" : s.is_revoked ? "critical" : "moderate"}>
                          {s.status.toUpperCase()}
                        </Badge>
                      </div>
                      <div className="flex flex-wrap gap-3 text-muted-foreground">
                        <span className="flex items-center gap-1">
                          <Clock className="size-3.5 text-[#0066FF]" aria-hidden="true" />
                          {s.is_active ? formatCountdown(s.remaining_seconds) : `Ended (${formatDateTime(s.expires_at)})`}
                        </span>
                        <span>{s.document_count} document(s)</span>
                        {s.requires_pin && (
                          <span className="flex items-center gap-1 text-primary font-medium">
                            <Lock className="size-3" aria-hidden="true" />
                            PIN Protected
                          </span>
                        )}
                        <span>Views: {s.access_count}</span>
                      </div>
                      <div className="truncate rounded border border-border bg-card px-2.5 py-1.5 font-mono text-[11px]">
                        {s.share_url}
                      </div>
                      <div className="flex flex-wrap gap-2 pt-1">
                        <Button variant="outline" size="sm" onClick={() => copyLink(s.id, s.share_url)}>
                          {copiedId === s.id ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                          <span>{copiedId === s.id ? "Copied" : "Copy Link"}</span>
                        </Button>
                        <a
                          href={`/share/${s.token}`}
                          target="_blank"
                          rel="noreferrer"
                          className="inline-flex min-h-[44px] items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted"
                        >
                          <ExternalLink className="size-3.5" aria-hidden="true" />
                          <span>Open Viewer</span>
                        </a>
                        {s.is_active && (
                          <Button variant="destructive" size="sm" onClick={() => handleRevoke(s.id)}>
                            <ShieldOff className="size-3.5" aria-hidden="true" />
                            <span>Revoke Access</span>
                          </Button>
                        )}
                      </div>
                    </div>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Sharing Access Audit Log</CardTitle>
            </CardHeader>
            <CardContent className="overflow-x-auto">
              {auditLogs.length === 0 ? (
                <p className="text-xs text-muted-foreground">No share view events logged yet.</p>
              ) : (
                <table className="w-full text-left text-xs">
                  <thead>
                    <tr className="border-b border-border text-muted-foreground">
                      <th className="py-2 pr-3 font-semibold">Action</th>
                      <th className="py-2 pr-3 font-semibold">Actor Role</th>
                      <th className="py-2 font-semibold">Timestamp</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-border">
                    {auditLogs.map((l) => (
                      <tr key={l.id}>
                        <td className="py-2 pr-3 font-medium">{l.action.replace(/_/g, " ")}</td>
                        <td className="py-2 pr-3">{l.actor_role}</td>
                        <td className="py-2 font-mono text-muted-foreground">{formatDateTime(l.created_at)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
}
