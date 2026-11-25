import React, { useCallback, useEffect, useState } from "react";
import { Save, ShieldAlert, Trash2 } from "lucide-react";
import {
  Alert,
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

export function PatientProfilePage() {
  const [profile, setProfile] = useState<any>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await apiFetch("/vault/profile");
      setProfile(res);
    } catch (err: any) {
      setError(err?.message || "Failed to load profile.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const updated = await apiFetch("/vault/profile", {
        method: "PUT",
        body: JSON.stringify({
          full_name: profile.full_name,
          date_of_birth: profile.date_of_birth || null,
          gender: profile.gender || null,
          blood_group: profile.blood_group || null,
          phone: profile.phone || null,
          emergency_contact_name: profile.emergency_contact_name || null,
          emergency_contact_phone: profile.emergency_contact_phone || null,
          ai_consent: profile.ai_consent,
          sharing_consent: profile.sharing_consent,
        }),
      });
      setProfile(updated);
      setSuccess("Profile and privacy consent preferences saved.");
    } catch (err: any) {
      setError(err?.message || "Could not update profile.");
    } finally {
      setSaving(false);
    }
  };

  const handleDeleteAllData = async () => {
    if (
      !window.confirm(
        "Delete ALL uploaded medical documents, lab values, timeline events, and summaries from your vault? Your account remains active."
      )
    ) {
      return;
    }
    try {
      await apiFetch("/vault/account/data", { method: "DELETE" });
      setSuccess("All stored medical documents and clinical records have been permanently deleted.");
    } catch (err: any) {
      setError(err?.message || "Failed to delete vault data.");
    }
  };

  if (loading) return <LoadingState message="Loading health profile and consent settings..." />;
  if (error && !profile) return <ErrorState message={error} onRetry={load} />;

  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-primary">Profile &amp; Health Privacy Controls</h1>
        <p className="text-sm text-muted-foreground">
          Manage your clinical demographics, emergency contact, AI processing consent, and data deletion rights.
        </p>
      </div>

      {error && <Alert variant="danger">{error}</Alert>}
      {success && <Alert variant="success">{success}</Alert>}

      <form onSubmit={handleSave} className="flex flex-col gap-6">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Patient Demographics &amp; Emergency Contact</CardTitle>
          </CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2">
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="prof-name">Full Name</FieldLabel>
              <Input
                id="prof-name"
                value={profile.full_name || ""}
                onChange={(e) => setProfile({ ...profile, full_name: e.target.value })}
                required
              />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="prof-dob">Date of Birth</FieldLabel>
              <Input
                id="prof-dob"
                type="date"
                value={profile.date_of_birth || ""}
                onChange={(e) => setProfile({ ...profile, date_of_birth: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="prof-gender">Gender</FieldLabel>
              <Input
                id="prof-gender"
                value={profile.gender || ""}
                onChange={(e) => setProfile({ ...profile, gender: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="prof-blood">Blood Group</FieldLabel>
              <Input
                id="prof-blood"
                placeholder="e.g. O+"
                value={profile.blood_group || ""}
                onChange={(e) => setProfile({ ...profile, blood_group: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="prof-phone">Phone</FieldLabel>
              <Input
                id="prof-phone"
                value={profile.phone || ""}
                onChange={(e) => setProfile({ ...profile, phone: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="prof-ec-name">Emergency Contact Name</FieldLabel>
              <Input
                id="prof-ec-name"
                value={profile.emergency_contact_name || ""}
                onChange={(e) => setProfile({ ...profile, emergency_contact_name: e.target.value })}
              />
            </div>
            <div className="flex flex-col gap-1 sm:col-span-2">
              <FieldLabel htmlFor="prof-ec-phone">Emergency Contact Phone</FieldLabel>
              <Input
                id="prof-ec-phone"
                value={profile.emergency_contact_phone || ""}
                onChange={(e) => setProfile({ ...profile, emergency_contact_phone: e.target.value })}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Explicit Consent &amp; Data Control</CardTitle>
            <CardDescription>Control whether your records can be referenced by the AI Health Assistant.</CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3 text-sm">
            <label className="flex items-start gap-3 rounded-md border border-border bg-background p-3">
              <input
                type="checkbox"
                checked={Boolean(profile.ai_consent)}
                onChange={(e) => setProfile({ ...profile, ai_consent: e.target.checked })}
                className="mt-0.5 size-4 accent-[#0E7C7B]"
              />
              <div>
                <div className="font-semibold text-foreground">AI Clinical Processing &amp; Assistant Context Consent</div>
                <div className="text-xs text-muted-foreground">
                  Allow OCR extraction refinement and let the Personalized Health Assistant reference your verified
                  allergies, medications, and lab history.
                </div>
              </div>
            </label>
            <label className="flex items-start gap-3 rounded-md border border-border bg-background p-3">
              <input
                type="checkbox"
                checked={Boolean(profile.sharing_consent)}
                onChange={(e) => setProfile({ ...profile, sharing_consent: e.target.checked })}
                className="mt-0.5 size-4 accent-[#0E7C7B]"
              />
              <div>
                <div className="font-semibold text-foreground">Allow Temporary Clinician Record Sharing</div>
                <div className="text-xs text-muted-foreground">
                  Permit generating expiring QR links for selected documents. Public-health administrators never see
                  personal records regardless of this setting.
                </div>
              </div>
            </label>
            <div className="flex justify-end pt-2">
              <Button type="submit" variant="accent" disabled={saving}>
                <Save className="size-4" aria-hidden="true" />
                <span>{saving ? "Saving..." : "Save Profile & Preferences"}</span>
              </Button>
            </div>
          </CardContent>
        </Card>
      </form>

      <Card className="border-rose-500/40">
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base text-destructive">
            <ShieldAlert className="size-4" aria-hidden="true" />
            Data Deletion Control
          </CardTitle>
          <CardDescription>
            Permanently remove all uploaded documents, OCR extractions, lab readings, and generated summaries from your
            vault.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <Button variant="destructive" onClick={handleDeleteAllData}>
            <Trash2 className="size-4" aria-hidden="true" />
            <span>Delete All My Medical Records</span>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
}
