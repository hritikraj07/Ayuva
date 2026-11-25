import React, { useCallback, useEffect, useState } from "react";
import {
  Camera,
  CheckCircle2,
  Download,
  Edit3,
  Eye,
  FileText,
  FolderLock,
  Loader2,
  Plus,
  Search,
  Trash2,
  Upload,
} from "lucide-react";
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
  Textarea,
} from "@/components/ui/primitives";
import {
  apiFetch,
  downloadAuthenticatedBlob,
  fetchAuthenticatedObjectUrl,
  uploadDocumentWithProgress,
} from "@/lib/api";
import { CATEGORY_LABELS, formatBytes, formatDate, formatDateTime } from "@/lib/utils";

const CATEGORIES = [
  { value: "prescription", label: "Prescription" },
  { value: "lab_report", label: "Laboratory Report" },
  { value: "medical_certificate", label: "Medical Certificate" },
  { value: "diagnostic_report", label: "Diagnostic Report" },
  { value: "discharge_summary", label: "Discharge Summary" },
];

export function MedicalVaultPage() {
  const [docs, setDocs] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [doctorFilter, setDoctorFilter] = useState("");
  const [conditionFilter, setConditionFilter] = useState("");

  // Upload state
  const [uploadTitle, setUploadTitle] = useState("");
  const [uploadCategory, setUploadCategory] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [uploadStatusMsg, setUploadStatusMsg] = useState<string | null>(null);
  const [uploadError, setUploadError] = useState<string | null>(null);

  // Preview state
  const [previewDoc, setPreviewDoc] = useState<any>(null);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewLoading, setPreviewLoading] = useState(false);

  // Verify / Edit extracted state
  const [editDoc, setEditDoc] = useState<any>(null);
  const [editForm, setEditForm] = useState<any>(null);
  const [showRawOcrInVerify, setShowRawOcrInVerify] = useState(false);
  const [savingVerify, setSavingVerify] = useState(false);
  const [actionMsg, setActionMsg] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<"all" | "verified" | "pending">("all");

  const loadDocuments = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (categoryFilter !== "all") params.set("category", categoryFilter);
      if (search.trim()) params.set("search", search.trim());
      if (doctorFilter.trim()) params.set("doctor", doctorFilter.trim());
      if (conditionFilter.trim()) params.set("condition", conditionFilter.trim());
      const res = await apiFetch(`/vault/documents?${params.toString()}`);
      setDocs(res.documents || []);
    } catch (err: any) {
      setError(err?.message || "Could not load vault documents.");
    } finally {
      setLoading(false);
    }
  }, [categoryFilter, search, doctorFilter, conditionFilter]);

  useEffect(() => {
    loadDocuments();
  }, [loadDocuments]);

  const openVerifyModal = (doc: any) => {
    setEditDoc(doc);
    setEditForm({
      title: doc.title || "",
      category: doc.category || "prescription",
      document_date: doc.document_date || doc.extracted?.document_date || "",
      doctor_name: doc.doctor_name || doc.extracted?.doctor_name || "",
      hospital_name: doc.hospital_name || doc.extracted?.hospital_name || "",
      primary_condition: doc.primary_condition || doc.extracted?.diagnosis || "",
      notes: doc.notes || "",
      patient_name: doc.extracted?.patient_name || "",
      diagnosis: doc.extracted?.diagnosis || "",
      allergiesText: (doc.extracted?.allergies || []).join(", "),
      observationsText: (doc.extracted?.observations || []).join("\n"),
      medications: doc.extracted?.medications || [],
      lab_values: doc.extracted?.lab_values || [],
      missing_fields: doc.extracted?.missing_fields || [],
      uncertain_fields: doc.extracted?.uncertain_fields || [],
      commit_to_profile: true,
    });
    setShowRawOcrInVerify(false);
  };

  const handleFileUpload = async (file: File | null) => {
    if (!file) return;
    setUploadError(null);
    setActionMsg(null);
    const allowed = [".pdf", ".jpg", ".jpeg", ".png"];
    const ext = "." + (file.name.split(".").pop() || "").toLowerCase();
    if (!allowed.includes(ext)) {
      setUploadError("Unsupported file type. Allowed formats: PDF, JPG, JPEG, PNG.");
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setUploadError("File exceeds 10 MB size limit.");
      return;
    }

    const formData = new FormData();
    formData.append("file", file);
    if (uploadTitle.trim()) formData.append("title", uploadTitle.trim());
    if (uploadCategory) formData.append("category", uploadCategory);

    try {
      setUploadProgress(10);
      setUploadStatusMsg("Uploading file and running OCR extraction...");
      const created = await uploadDocumentWithProgress(formData, (pct) => {
        setUploadProgress(pct);
        if (pct >= 90) setUploadStatusMsg("Running RapidOCR and structured clinical extraction...");
      });
      setUploadTitle("");
      setUploadCategory("");
      setUploadProgress(null);
      setUploadStatusMsg(null);
      setActionMsg(`Stored "${created.title}" (Document #${created.id}). Review extracted fields below before finalizing.`);
      await loadDocuments();
      openVerifyModal(created);
    } catch (err: any) {
      setUploadProgress(null);
      setUploadStatusMsg(null);
      setUploadError(err?.message || "Upload failed.");
    }
  };

  const handleSaveVerification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editDoc || !editForm) return;
    setSavingVerify(true);
    try {
      await apiFetch(`/vault/documents/${editDoc.id}/verify`, {
        method: "PUT",
        body: JSON.stringify({
          title: editForm.title.trim() || editDoc.title,
          category: editForm.category,
          document_date: editForm.document_date || null,
          doctor_name: editForm.doctor_name || null,
          hospital_name: editForm.hospital_name || null,
          primary_condition: editForm.primary_condition || editForm.diagnosis || null,
          notes: editForm.notes || null,
          commit_to_profile: editForm.commit_to_profile,
          extracted: {
            patient_name: editForm.patient_name || null,
            doctor_name: editForm.doctor_name || null,
            hospital_name: editForm.hospital_name || null,
            document_date: editForm.document_date || null,
            diagnosis: editForm.diagnosis || null,
            medications: editForm.medications.filter((m: any) => m.medicine_name?.trim()),
            lab_values: editForm.lab_values.filter((l: any) => l.test_name?.trim()),
            allergies: editForm.allergiesText
              .split(",")
              .map((s: string) => s.trim())
              .filter(Boolean),
            observations: editForm.observationsText
              .split("\n")
              .map((s: string) => s.trim())
              .filter(Boolean),
            missing_fields: editForm.missing_fields || [],
          },
        }),
      });
      setEditDoc(null);
      setActionMsg("Document verified and saved to your medical timeline.");
      await loadDocuments();
    } catch (err: any) {
      setError(err?.message || "Could not save verified metadata.");
    } finally {
      setSavingVerify(false);
    }
  };

  const handleOpenPreview = async (doc: any) => {
    setPreviewDoc(doc);
    setPreviewLoading(true);
    if (previewUrl) URL.revokeObjectURL(previewUrl);
    setPreviewUrl(null);
    try {
      const objUrl = await fetchAuthenticatedObjectUrl(`/vault/documents/${doc.id}/file`);
      setPreviewUrl(objUrl);
    } catch {
      setPreviewUrl(null);
    } finally {
      setPreviewLoading(false);
    }
  };

  const handleDelete = async (doc: any) => {
    if (!window.confirm(`Permanently delete "${doc.title}" from your medical vault?`)) return;
    try {
      await apiFetch(`/vault/documents/${doc.id}`, { method: "DELETE" });
      setActionMsg(`Deleted "${doc.title}".`);
      await loadDocuments();
    } catch (err: any) {
      setError(err?.message || "Failed to delete document.");
    }
  };

  return (
    <div className="mx-auto flex max-w-6xl flex-col gap-6">
      <div>
        <h1 className="font-display text-2xl font-bold text-primary">My Medical Vault</h1>
        <p className="text-sm text-muted-foreground">
          Upload prescriptions, lab reports, diagnostic scans, certificates, and discharge summaries. OCR extracts
          explicit facts for your review before saving.
        </p>
      </div>

      {actionMsg && <Alert variant="success">{actionMsg}</Alert>}

      {/* Upload Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <Upload className="size-4 text-[#0066FF]" aria-hidden="true" />
            Upload or Capture Medical Document
          </CardTitle>
          <CardDescription>Accepted formats: PDF, JPG, JPEG, PNG (max 10 MB). Missing fields are never invented.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          {uploadError && <Alert variant="danger">{uploadError}</Alert>}
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="doc-title-opt">Document Title (optional)</FieldLabel>
              <Input
                id="doc-title-opt"
                placeholder="e.g. November CBC Report"
                value={uploadTitle}
                onChange={(e) => setUploadTitle(e.target.value)}
              />
            </div>
            <div className="flex flex-col gap-1.5">
              <FieldLabel htmlFor="doc-cat-opt">Category (auto-detected if blank)</FieldLabel>
              <Select id="doc-cat-opt" value={uploadCategory} onChange={(e) => setUploadCategory(e.target.value)}>
                <option value="">Auto-detect from OCR text</option>
                {CATEGORIES.map((c) => (
                  <option key={c.value} value={c.value}>
                    {c.label}
                  </option>
                ))}
              </Select>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 focus-within:outline-2 focus-within:outline-[#0E7C7B] focus-within:outline-offset-2">
              <Upload className="size-4" aria-hidden="true" />
              <span>Select PDF or Image</span>
              <input
                type="file"
                accept=".pdf,.jpg,.jpeg,.png,application/pdf,image/jpeg,image/png"
                className="sr-only"
                onChange={(e) => handleFileUpload(e.target.files?.[0] || null)}
              />
            </label>
            <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-border bg-card px-4 py-2 text-sm font-medium text-foreground hover:bg-muted focus-within:outline-2 focus-within:outline-[#0E7C7B] focus-within:outline-offset-2">
              <Camera className="size-4 text-[#0066FF]" aria-hidden="true" />
              <span>Capture Physical Document Photo</span>
              <input
                type="file"
                accept="image/jpeg,image/png"
                capture="environment"
                className="sr-only"
                onChange={(e) => handleFileUpload(e.target.files?.[0] || null)}
              />
            </label>
          </div>

          {uploadProgress !== null && (
            <div className="flex flex-col gap-1.5 rounded-md border border-border bg-background p-3">
              <div className="flex items-center justify-between text-xs font-medium">
                <span className="flex items-center gap-2 text-primary">
                  <Loader2 className="size-3.5 animate-spin text-[#0066FF]" aria-hidden="true" />
                  {uploadStatusMsg}
                </span>
                <span className="font-mono">{uploadProgress}%</span>
              </div>
              <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                <div className="h-full bg-accent transition-all" style={{ width: `${uploadProgress}%` }} />
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Filters & Vault Summary Strip */}
      <div className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-card px-4 py-2.5 text-xs">
        <span>
          <strong className="text-primary">{docs.length}</strong> record(s) displayed ·{" "}
          <strong>{docs.filter((d) => !d.is_verified).length}</strong> pending verification
          {docs[0]?.created_at ? ` · Latest uploaded ${formatDateTime(docs[0].created_at)}` : ""}
        </span>
        <div className="flex gap-1.5">
          {(["all", "pending", "verified"] as const).map((st) => (
            <Button
              key={st}
              size="sm"
              variant={statusFilter === st ? "primary" : "outline"}
              onClick={() => setStatusFilter(st)}
            >
              {st === "all" ? "All Status" : st === "pending" ? "Pending Review" : "Verified"}
            </Button>
          ))}
        </div>
      </div>

      {/* Filters */}
      <Card>
        <CardContent className="grid gap-3 pt-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="vault-search">Search text or title</FieldLabel>
            <div className="relative flex items-center">
              <Search className="pointer-events-none absolute left-3 size-4 text-muted-foreground" aria-hidden="true" />
              <Input
                id="vault-search"
                className="pl-9"
                placeholder="Search title, OCR text..."
                value={search}
                onChange={(e) => setSearch(e.target.value)}
              />
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="vault-cat-filter">Category</FieldLabel>
            <Select id="vault-cat-filter" value={categoryFilter} onChange={(e) => setCategoryFilter(e.target.value)}>
              <option value="all">All categories</option>
              {CATEGORIES.map((c) => (
                <option key={c.value} value={c.value}>
                  {c.label}
                </option>
              ))}
            </Select>
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="vault-doc-filter">Filter by doctor</FieldLabel>
            <Input
              id="vault-doc-filter"
              placeholder="Filter by physician name"
              value={doctorFilter}
              onChange={(e) => setDoctorFilter(e.target.value)}
            />
          </div>
          <div className="flex flex-col gap-1">
            <FieldLabel htmlFor="vault-cond-filter">Filter by condition</FieldLabel>
            <Input
              id="vault-cond-filter"
              placeholder="e.g. Diabetes"
              value={conditionFilter}
              onChange={(e) => setConditionFilter(e.target.value)}
            />
          </div>
        </CardContent>
      </Card>

      {/* Document List */}
      {loading ? (
        <LoadingState message="Loading medical documents..." />
      ) : error ? (
        <ErrorState message={error} onRetry={loadDocuments} />
      ) : docs.filter((d) => statusFilter === "all" || (statusFilter === "verified" ? d.is_verified : !d.is_verified)).length === 0 ? (
        <EmptyState
          icon={FolderLock}
          title={docs.length === 0 && !search && categoryFilter === "all" ? "Your medical vault is empty." : "No matching documents found"}
          description={
            docs.length === 0 && !search && categoryFilter === "all"
              ? "Upload your first medical document to start organizing your health records."
              : "Upload a new PDF or photograph above, or clear your search and status filters."
          }
        />
      ) : (
        <div className="grid gap-4">
          {docs
            .filter((d) => statusFilter === "all" || (statusFilter === "verified" ? d.is_verified : !d.is_verified))
            .map((doc) => (
            <Card key={doc.id}>
              <CardContent className="flex flex-col gap-4 pt-5 lg:flex-row lg:items-center lg:justify-between">
                <div className="flex items-start gap-3.5">
                  <div className="flex size-10 shrink-0 items-center justify-center rounded-md bg-secondary/20 text-primary">
                    <FileText className="size-5" aria-hidden="true" />
                  </div>
                  <div className="flex flex-col gap-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-muted-foreground">#{doc.id}</span>
                      <h2 className="font-display text-base font-semibold text-foreground">{doc.title}</h2>
                      <Badge variant="teal">{CATEGORY_LABELS[doc.category] || doc.category}</Badge>
                      <Badge variant={doc.is_verified ? "verified" : "moderate"}>
                        {doc.is_verified ? "Verified" : "Pending Review"}
                      </Badge>
                    </div>
                    <div className="text-xs text-muted-foreground">
                      Doc Date: <span className="font-medium text-foreground">{formatDate(doc.document_date)}</span> | Doctor:{" "}
                      <span className="font-medium text-foreground">{doc.doctor_name || "Not stated"}</span> | Hospital:{" "}
                      <span className="font-medium text-foreground">{doc.hospital_name || "Not stated"}</span>
                    </div>
                    <div className="flex flex-wrap gap-3 text-xs text-muted-foreground">
                      <span>Condition: {doc.primary_condition || "Unspecified"}</span>
                      <span>
                        File: <span className="font-mono">{doc.original_filename}</span> ({formatBytes(doc.file_size)})
                      </span>
                      <span>Uploaded: {formatDateTime(doc.created_at)}</span>
                      <span>OCR confidence: {Math.round((doc.extraction_confidence || 0) * 100)}%</span>
                    </div>
                  </div>
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <Button variant="outline" size="sm" onClick={() => handleOpenPreview(doc)}>
                    <Eye className="size-4" aria-hidden="true" />
                    <span>Preview</span>
                  </Button>
                  <Button variant="outline" size="sm" onClick={() => openVerifyModal(doc)}>
                    <Edit3 className="size-4" aria-hidden="true" />
                    <span>{doc.is_verified ? "Edit Extracted" : "Review & Verify"}</span>
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => downloadAuthenticatedBlob(`/vault/documents/${doc.id}/file?download=true`, doc.original_filename)}
                  >
                    <Download className="size-4" aria-hidden="true" />
                    <span>Download</span>
                  </Button>
                  <Button variant="ghost" size="sm" onClick={() => handleDelete(doc)} aria-label={`Delete ${doc.title}`}>
                    <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Preview Modal */}
      <Modal
        open={Boolean(previewDoc)}
        onClose={() => {
          setPreviewDoc(null);
          if (previewUrl) URL.revokeObjectURL(previewUrl);
          setPreviewUrl(null);
        }}
        title={previewDoc?.title || "Document Preview"}
        description={previewDoc ? `${CATEGORY_LABELS[previewDoc.category] || previewDoc.category} · ${previewDoc.original_filename}` : ""}
        maxWidthClass="max-w-4xl"
      >
        {previewDoc && (
          <div className="flex flex-col gap-4">
            {previewLoading ? (
              <LoadingState message="Loading secure document file..." />
            ) : previewUrl ? (
              previewDoc.mime_type === "application/pdf" ? (
                <iframe src={previewUrl} title={previewDoc.title} className="h-[440px] w-full rounded border border-border" />
              ) : (
                <img
                  src={previewUrl}
                  alt={previewDoc.title}
                  className="max-h-[440px] w-full rounded border border-border object-contain bg-muted/30"
                />
              )
            ) : (
              <Alert variant="warning">Preview file unavailable in browser; OCR text is displayed below.</Alert>
            )}
            <div className="rounded-md border border-border bg-background p-3.5">
              <div className="text-xs font-semibold text-primary">Extracted OCR Text ({previewDoc.extraction_provider})</div>
              <pre className="mt-2 max-h-60 overflow-y-auto whitespace-pre-wrap font-mono text-xs leading-relaxed text-foreground">
                {previewDoc.ocr_text || "No text could be extracted from this file."}
              </pre>
            </div>
          </div>
        )}
      </Modal>

      {/* Review & Verify Modal */}
      <Modal
        open={Boolean(editDoc && editForm)}
        onClose={() => setEditDoc(null)}
        title="Review & Verify Extracted Medical Information"
        description="Confirm or correct OCR-extracted fields before saving to your medical timeline. Unmentioned fields remain blank."
        maxWidthClass="max-w-3xl"
      >
        {editDoc && editForm && (
          <form onSubmit={handleSaveVerification} className="flex flex-col gap-4">
            {(!editDoc.ocr_text || editDoc.ocr_text.trim().length < 5) && (
              <Alert variant="danger" title="OCR Extraction Failed">
                Unable to extract text from this document. Please retry or upload a clearer file.
              </Alert>
            )}
            {editForm.uncertain_fields?.length > 0 && (
              <Alert variant="warning" title="Uncertain OCR Extractions">
                {editForm.uncertain_fields.join(" ")}
              </Alert>
            )}
            {editForm.missing_fields?.length > 0 && (
              <Alert variant="info" title="Fields Not Found in Document">
                The following fields were not detected in the source text and were left empty:{" "}
                <span className="font-medium">{editForm.missing_fields.join(", ")}</span>.
              </Alert>
            )}

            <div className="flex justify-end">
              <Button size="sm" variant="outline" onClick={() => setShowRawOcrInVerify((v) => !v)}>
                {showRawOcrInVerify ? "Hide Raw OCR Text" : "Compare Raw OCR Text"}
              </Button>
            </div>
            {showRawOcrInVerify && (
              <pre className="max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border border-border bg-background p-3 font-mono text-[11px] leading-relaxed">
                {editDoc.ocr_text || "No OCR text extracted."}
              </pre>
            )}

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="ver-title">Document Title</FieldLabel>
                <Input
                  id="ver-title"
                  value={editForm.title}
                  onChange={(e) => setEditForm({ ...editForm, title: e.target.value })}
                  required
                />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="ver-cat">Category</FieldLabel>
                <Select
                  id="ver-cat"
                  value={editForm.category}
                  onChange={(e) => setEditForm({ ...editForm, category: e.target.value })}
                >
                  {CATEGORIES.map((c) => (
                    <option key={c.value} value={c.value}>
                      {c.label}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="ver-date">Document Date</FieldLabel>
                <Input
                  id="ver-date"
                  type="date"
                  value={editForm.document_date}
                  onChange={(e) => setEditForm({ ...editForm, document_date: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="ver-patient">Extracted Patient Name</FieldLabel>
                <Input
                  id="ver-patient"
                  placeholder="Not stated in document"
                  value={editForm.patient_name}
                  onChange={(e) => setEditForm({ ...editForm, patient_name: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="ver-doc">Doctor Name</FieldLabel>
                <Input
                  id="ver-doc"
                  placeholder="Not stated"
                  value={editForm.doctor_name}
                  onChange={(e) => setEditForm({ ...editForm, doctor_name: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="ver-hosp">Hospital / Laboratory</FieldLabel>
                <Input
                  id="ver-hosp"
                  placeholder="Not stated"
                  value={editForm.hospital_name}
                  onChange={(e) => setEditForm({ ...editForm, hospital_name: e.target.value })}
                />
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="ver-diag">Diagnosis / Medical Condition</FieldLabel>
                <Input
                  id="ver-diag"
                  placeholder="Not stated"
                  value={editForm.diagnosis}
                  onChange={(e) => setEditForm({ ...editForm, diagnosis: e.target.value })}
                />
              </div>
              <div className="flex flex-col gap-1">
                <FieldLabel htmlFor="ver-allergy">Allergies (comma separated)</FieldLabel>
                <Input
                  id="ver-allergy"
                  placeholder="None documented"
                  value={editForm.allergiesText}
                  onChange={(e) => setEditForm({ ...editForm, allergiesText: e.target.value })}
                />
              </div>
            </div>

            {/* Medications */}
            <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-primary">Extracted Medications</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setEditForm({
                      ...editForm,
                      medications: [...editForm.medications, { medicine_name: "", dosage: "", frequency: "", instructions: "" }],
                    })
                  }
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  <span>Add Medicine</span>
                </Button>
              </div>
              {editForm.medications.length === 0 ? (
                <p className="text-xs text-muted-foreground">No medicines extracted from this document.</p>
              ) : (
                editForm.medications.map((m: any, idx: number) => (
                  <div key={idx} className="grid gap-2 sm:grid-cols-12 items-center">
                    <Input
                      className="sm:col-span-4"
                      placeholder="Medicine name"
                      value={m.medicine_name || ""}
                      onChange={(e) => {
                        const next = [...editForm.medications];
                        next[idx] = { ...next[idx], medicine_name: e.target.value };
                        setEditForm({ ...editForm, medications: next });
                      }}
                    />
                    <Input
                      className="sm:col-span-3"
                      placeholder="Dosage (e.g. 500 mg)"
                      value={m.dosage || ""}
                      onChange={(e) => {
                        const next = [...editForm.medications];
                        next[idx] = { ...next[idx], dosage: e.target.value };
                        setEditForm({ ...editForm, medications: next });
                      }}
                    />
                    <Input
                      className="sm:col-span-4"
                      placeholder="Frequency (e.g. Twice daily)"
                      value={m.frequency || ""}
                      onChange={(e) => {
                        const next = [...editForm.medications];
                        next[idx] = { ...next[idx], frequency: e.target.value };
                        setEditForm({ ...editForm, medications: next });
                      }}
                    />
                    <Button
                      size="sm"
                      variant="ghost"
                      className="sm:col-span-1"
                      aria-label={`Remove medication row ${idx + 1}`}
                      onClick={() =>
                        setEditForm({
                          ...editForm,
                          medications: editForm.medications.filter((_: any, i: number) => i !== idx),
                        })
                      }
                    >
                      <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                    </Button>
                  </div>
                ))
              )}
            </div>

            {/* Lab Values */}
            <div className="flex flex-col gap-2 rounded-md border border-border bg-background p-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-semibold text-primary">Extracted Laboratory Results</span>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() =>
                    setEditForm({
                      ...editForm,
                      lab_values: [
                        ...editForm.lab_values,
                        { test_name: "", value_numeric: null, value_text: "", unit: "", reference_range: "", flag: "normal", is_abnormal: false },
                      ],
                    })
                  }
                >
                  <Plus className="size-3.5" aria-hidden="true" />
                  <span>Add Lab Row</span>
                </Button>
              </div>
              {editForm.lab_values.length === 0 ? (
                <p className="text-xs text-muted-foreground">No lab values extracted from this document.</p>
              ) : (
                editForm.lab_values.map((l: any, idx: number) => (
                  <div key={idx} className="grid gap-2 sm:grid-cols-12 items-center">
                    <Input
                      className="sm:col-span-3"
                      placeholder="Test name"
                      value={l.test_name || ""}
                      onChange={(e) => {
                        const next = [...editForm.lab_values];
                        next[idx] = { ...next[idx], test_name: e.target.value };
                        setEditForm({ ...editForm, lab_values: next });
                      }}
                    />
                    <Input
                      className="sm:col-span-2"
                      placeholder="Value"
                      value={l.value_text || ""}
                      onChange={(e) => {
                        const next = [...editForm.lab_values];
                        const num = Number(e.target.value);
                        next[idx] = { ...next[idx], value_text: e.target.value, value_numeric: Number.isFinite(num) ? num : null };
                        setEditForm({ ...editForm, lab_values: next });
                      }}
                    />
                    <Input
                      className="sm:col-span-2"
                      placeholder="Unit"
                      value={l.unit || ""}
                      onChange={(e) => {
                        const next = [...editForm.lab_values];
                        next[idx] = { ...next[idx], unit: e.target.value };
                        setEditForm({ ...editForm, lab_values: next });
                      }}
                    />
                    <Input
                      className="sm:col-span-2"
                      placeholder="Ref range"
                      value={l.reference_range || ""}
                      onChange={(e) => {
                        const next = [...editForm.lab_values];
                        next[idx] = { ...next[idx], reference_range: e.target.value };
                        setEditForm({ ...editForm, lab_values: next });
                      }}
                    />
                    <Select
                      aria-label={`Lab flag row ${idx + 1}`}
                      className="sm:col-span-2"
                      value={l.flag || "normal"}
                      onChange={(e) => {
                        const next = [...editForm.lab_values];
                        next[idx] = { ...next[idx], flag: e.target.value, is_abnormal: e.target.value !== "normal" };
                        setEditForm({ ...editForm, lab_values: next });
                      }}
                    >
                      <option value="normal">Normal</option>
                      <option value="low">Low</option>
                      <option value="high">High</option>
                      <option value="critical">Critical</option>
                    </Select>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="sm:col-span-1"
                      aria-label={`Remove lab row ${idx + 1}`}
                      onClick={() =>
                        setEditForm({
                          ...editForm,
                          lab_values: editForm.lab_values.filter((_: any, i: number) => i !== idx),
                        })
                      }
                    >
                      <Trash2 className="size-4 text-destructive" aria-hidden="true" />
                    </Button>
                  </div>
                ))
              )}
            </div>

            <div className="flex flex-col gap-1">
              <FieldLabel htmlFor="ver-obs">Observations (one per line)</FieldLabel>
              <Textarea
                id="ver-obs"
                rows={3}
                value={editForm.observationsText}
                onChange={(e) => setEditForm({ ...editForm, observationsText: e.target.value })}
              />
            </div>

            <label className="flex items-center gap-2 text-xs font-medium text-foreground">
              <input
                type="checkbox"
                checked={editForm.commit_to_profile}
                onChange={(e) => setEditForm({ ...editForm, commit_to_profile: e.target.checked })}
                className="size-4 accent-[#0E7C7B]"
              />
              <span>Commit verified conditions, medications, allergies, and lab values to my timeline</span>
            </label>

            <div className="flex justify-end gap-2 border-t border-border pt-3">
              <Button variant="outline" onClick={() => setEditDoc(null)}>
                Cancel
              </Button>
              <Button type="submit" variant="accent" disabled={savingVerify}>
                <CheckCircle2 className="size-4" aria-hidden="true" />
                <span>{savingVerify ? "Saving..." : "Verify & Save Record"}</span>
              </Button>
            </div>
          </form>
        )}
      </Modal>
    </div>
  );
}
