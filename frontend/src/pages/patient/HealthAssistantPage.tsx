import React, { Suspense, useCallback, useEffect, useRef, useState } from "react";
import ReactMarkdown from "react-markdown";

const IntelligenceOrb3D = React.lazy(() =>
  import("@/components/three/MiniBioWidgets").then((m) => ({ default: m.IntelligenceOrb3D }))
);
import {
  AlertTriangle,
  Bot,
  Camera,
  Database,
  ExternalLink,
  FileText,
  Info,
  Loader2,
  MessageSquarePlus,
  Paperclip,
  Pill,
  RotateCcw,
  Search,
  Send,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
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
  Input,
  LoadingState,
} from "@/components/ui/primitives";
import { apiFetch } from "@/lib/api";
import { formatDateTime } from "@/lib/utils";

interface ChatStatus {
  ai_configured: boolean;
  provider: string;
  model: string | null;
  ai_consent: boolean;
  ocr_available: boolean;
  supported_attachment_types: string[];
  drug_reference_api: string;
  rate_limit_per_minute: number;
}

interface FailedDraft {
  prompt: string;
  attachment: File | null;
  attachedDocId: string;
}

export function HealthAssistantPage() {
  const [conversations, setConversations] = useState<any[]>([]);
  const [activeConvoId, setActiveConvoId] = useState<number | null>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [vaultDocs, setVaultDocs] = useState<any[]>([]);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [chatStatus, setChatStatus] = useState<ChatStatus | null>(null);

  const [useVaultContext, setUseVaultContext] = useState(true);
  const [lastContextInfo, setLastContextInfo] = useState<{
    used: boolean;
    reason?: string;
    categories?: string[];
  } | null>(null);

  const [attachedDocId, setAttachedDocId] = useState<string>("");
  const [inputText, setInputText] = useState("");
  const [attachmentFile, setAttachmentFile] = useState<File | null>(null);
  const [attachmentPreviewUrl, setAttachmentPreviewUrl] = useState<string | null>(null);

  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [failedDraft, setFailedDraft] = useState<FailedDraft | null>(null);

  const [loading, setLoading] = useState(true);
  const [pageError, setPageError] = useState<string | null>(null);

  // OpenFDA medicine search state
  const [medQuery, setMedQuery] = useState("");
  const [medResults, setMedResults] = useState<any[]>([]);
  const [medSearched, setMedSearched] = useState(false);
  const [medLoading, setMedLoading] = useState(false);
  const [medError, setMedError] = useState<string | null>(null);
  const [medSource, setMedSource] = useState("OpenFDA Drug Label API (api.fda.gov)");

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  // Manage local object URL lifecycle for image previews
  useEffect(() => {
    if (!attachmentFile || !attachmentFile.type.startsWith("image/")) {
      setAttachmentPreviewUrl(null);
      return;
    }
    const url = URL.createObjectURL(attachmentFile);
    setAttachmentPreviewUrl(url);
    return () => {
      URL.revokeObjectURL(url);
    };
  }, [attachmentFile]);

  // Smoothly scroll to the newest message or loading indicator
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, sending]);

  const loadConvoMessages = useCallback(async (convoId: number) => {
    const res = await apiFetch(`/chat/conversations/${convoId}`);
    setMessages(res.messages || []);
    setUseVaultContext(Boolean(res.use_vault_context));
    setSendError(null);
    setFailedDraft(null);
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    setPageError(null);
    try {
      const [convRes, docsRes, sugRes, statusRes] = await Promise.all([
        apiFetch("/chat/conversations"),
        apiFetch("/vault/documents"),
        apiFetch("/chat/suggestions"),
        apiFetch("/chat/status"),
      ]);
      const list = convRes.conversations || [];
      setConversations(list);
      setVaultDocs(docsRes.documents || []);
      setSuggestions(sugRes.suggestions || []);
      setChatStatus(statusRes);
      if (list.length > 0) {
        const targetId = list[0].id;
        setActiveConvoId(targetId);
        await loadConvoMessages(targetId);
      } else {
        setActiveConvoId(null);
        setMessages([]);
      }
    } catch (err: any) {
      setPageError(err?.message || "Failed to load Health Assistant.");
    } finally {
      setLoading(false);
    }
  }, [loadConvoMessages]);

  useEffect(() => {
    loadAll();
  }, [loadAll]);

  const handleNewConversation = async () => {
    setSendError(null);
    setFailedDraft(null);
    setLastContextInfo(null);
    try {
      const created = await apiFetch("/chat/conversations", {
        method: "POST",
        body: JSON.stringify({ title: "New Consultation Question", use_vault_context: useVaultContext }),
      });
      await loadAll();
      setActiveConvoId(created.id);
      setMessages([]);
    } catch (err: any) {
      setSendError(err?.message || "Unable to create conversation.");
    }
  };

  const handleSelectConvo = async (id: number) => {
    setActiveConvoId(id);
    setLastContextInfo(null);
    await loadConvoMessages(id);
  };

  const handleDeleteConvo = async (id: number) => {
    await apiFetch(`/chat/conversations/${id}`, { method: "DELETE" });
    await loadAll();
  };

  const handleToggleVaultContext = async (checked: boolean) => {
    setUseVaultContext(checked);
    setLastContextInfo(null);
    if (activeConvoId) {
      try {
        await apiFetch(`/chat/conversations/${activeConvoId}`, {
          method: "PATCH",
          body: JSON.stringify({ use_vault_context: checked }),
        });
      } catch {
        // State stays synchronized on next message send via FormData
      }
    }
  };

  const clearAttachment = () => {
    setAttachmentFile(null);
    if (fileInputRef.current) {
      fileInputRef.current.value = "";
    }
  };

  const submitMessage = async (promptText: string, fileToSend: File | null, docIdToSend: string) => {
    const prompt = promptText.trim();
    if (!prompt) return;

    setSending(true);
    setSendError(null);
    setFailedDraft(null);
    try {
      let convoId = activeConvoId;
      if (!convoId) {
        const created = await apiFetch("/chat/conversations", {
          method: "POST",
          body: JSON.stringify({ title: prompt.slice(0, 56), use_vault_context: useVaultContext }),
        });
        convoId = created.id;
        setActiveConvoId(convoId);
      }

      const fd = new FormData();
      fd.append("message", prompt);
      fd.append("use_vault_context", String(useVaultContext));
      if (docIdToSend) fd.append("attached_document_id", docIdToSend);
      if (fileToSend) fd.append("image", fileToSend);

      const res = await apiFetch(`/chat/conversations/${convoId}/messages`, {
        method: "POST",
        body: fd,
      });

      setLastContextInfo({
        used: Boolean(res.context_used),
        reason: res.context_reason,
        categories: res.context_categories || [],
      });
      setInputText("");
      clearAttachment();
      await loadConvoMessages(convoId!);
      const convRes = await apiFetch("/chat/conversations");
      setConversations(convRes.conversations || []);
    } catch (err: any) {
      const msg = err?.message || "Failed to send message to Gemini assistant.";
      setSendError(msg);
      setFailedDraft({ prompt, attachment: fileToSend, attachedDocId: docIdToSend });
    } finally {
      setSending(false);
    }
  };

  const handleSend = async (e?: React.FormEvent, overridePrompt?: string) => {
    if (e) e.preventDefault();
    const prompt = (overridePrompt ?? inputText).trim();
    if (!prompt) return;
    await submitMessage(prompt, attachmentFile, attachedDocId);
  };

  const handleRetry = async () => {
    if (!failedDraft) return;
    await submitMessage(failedDraft.prompt, failedDraft.attachment, failedDraft.attachedDocId);
  };

  const handleMedicineSearch = async (e: React.FormEvent) => {
    e.preventDefault();
    const q = medQuery.trim();
    if (!q) return;
    setMedLoading(true);
    setMedError(null);
    setMedSearched(true);
    try {
      const res = await apiFetch(`/chat/medicines/search?q=${encodeURIComponent(q)}`);
      setMedResults(res.medicines || []);
      setMedSource(res.source || "OpenFDA Drug Label API (api.fda.gov)");
      if (res.error) setMedError(res.error);
    } catch (err: any) {
      setMedError(err?.message || "OpenFDA search failed.");
      setMedResults([]);
    } finally {
      setMedLoading(false);
    }
  };

  if (loading) return <LoadingState message="Loading Gemini Health Assistant and vault context..." />;
  if (pageError && !conversations.length && messages.length === 0) return <ErrorState message={pageError} onRetry={loadAll} />;

  const contextEffective = useVaultContext && (chatStatus?.ai_consent ?? true);

  return (
    <div className="mx-auto flex max-w-7xl flex-col gap-5">
      <div className="neo-glass-violet flex flex-col gap-4 rounded-2xl p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-3.5">
          <Suspense fallback={<div className="h-16 w-16 shrink-0 rounded-full border border-[#E5E9F0] bg-[#EFF6FF]" />}>
            <IntelligenceOrb3D thinking={sending} className="h-16 w-16 shrink-0" />
          </Suspense>
          <div>
            <h1 className="font-display text-2xl font-bold text-foreground">AI Healthcare Assistant</h1>
            <p className="text-sm text-muted-foreground">
              Powered by Google Gemini with optional scoped Medical Vault context, document/image analysis, and OpenFDA drug labels.
            </p>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {chatStatus && (
            <Badge variant={chatStatus.ai_configured ? "verified" : "high"}>
              <Sparkles className="size-3" aria-hidden="true" />
              <span>
                {chatStatus.ai_configured
                  ? `Gemini Ready (${chatStatus.model})`
                  : "Gemini Key Missing"}
              </span>
            </Badge>
          )}
          <Button variant="primary" onClick={handleNewConversation}>
            <MessageSquarePlus className="size-4" aria-hidden="true" />
            <span>New Chat</span>
          </Button>
        </div>
      </div>

      {chatStatus && !chatStatus.ai_configured && (
        <Alert variant="warning" title="Gemini API Key Not Configured">
          Set <code>GEMINI_API_KEY</code> in the server environment to enable Gemini responses. OpenFDA drug label search
          below remains operational.
        </Alert>
      )}

      {chatStatus && !chatStatus.ai_consent && (
        <Alert variant="info" title="Personal Vault AI Context Disabled in Profile">
          Your Patient Profile currently has AI processing consent turned off, so Gemini will answer strictly with
          general educational health information without reading your vault records.
        </Alert>
      )}

      <div className="grid gap-5 lg:grid-cols-12">
        {/* Conversations + OpenFDA Lookup Column */}
        <div className="flex flex-col gap-5 lg:col-span-4">
          <Card>
            <CardHeader>
              <CardTitle className="text-sm">Conversation History</CardTitle>
              <CardDescription>Stored privately for your account only</CardDescription>
            </CardHeader>
            <CardContent className="flex max-h-[260px] flex-col gap-2 overflow-y-auto">
              {conversations.length === 0 ? (
                <EmptyState
                  icon={Bot}
                  title="No chat history yet"
                  description="Start a new chat or click a suggested question to begin."
                />
              ) : (
                conversations.map((c) => (
                  <div
                    key={c.id}
                    className={`flex items-center justify-between gap-2 rounded-md border px-3 py-1.5 text-xs ${
                      activeConvoId === c.id ? "border-secondary/60 bg-secondary/20" : "border-border bg-card"
                    }`}
                  >
                    <button
                      type="button"
                      onClick={() => handleSelectConvo(c.id)}
                      className="min-h-[44px] flex-1 truncate text-left font-medium text-foreground"
                    >
                      {c.title}
                    </button>
                    <button
                      type="button"
                      aria-label={`Delete conversation ${c.title}`}
                      onClick={() => handleDeleteConvo(c.id)}
                      className="inline-flex size-10 shrink-0 items-center justify-center rounded text-muted-foreground hover:bg-muted hover:text-destructive"
                    >
                      <Trash2 className="size-4" aria-hidden="true" />
                    </button>
                  </div>
                ))
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-sm">
                <Pill className="size-4 text-[#0066FF]" aria-hidden="true" />
                OpenFDA Drug Label Lookup
              </CardTitle>
              <CardDescription>Live lookup from U.S. FDA official drug labeling (api.fda.gov)</CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              <form onSubmit={handleMedicineSearch} className="flex gap-2">
                <Input
                  value={medQuery}
                  onChange={(e) => setMedQuery(e.target.value)}
                  placeholder="Enter drug name (e.g. metformin)"
                  aria-label="Search FDA drug label"
                />
                <Button type="submit" variant="secondary" disabled={medLoading}>
                  <Search className="size-4" aria-hidden="true" />
                  <span>{medLoading ? "..." : "Lookup"}</span>
                </Button>
              </form>

              {medError && <Alert variant="danger" title="OpenFDA Lookup Error">{medError}</Alert>}

              {medSearched && !medLoading && !medError && medResults.length === 0 && (
                <p className="text-xs text-muted-foreground">No matching FDA drug label found for that query.</p>
              )}

              {medResults.map((m) => (
                <div key={m.key} className="rounded-md border border-border bg-muted/20 p-3 text-xs">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-semibold text-primary">{m.generic_name}</span>
                    <Badge variant="teal">OpenFDA</Badge>
                  </div>
                  {m.brand_names?.length > 0 && (
                    <div className="mt-1 text-[11px] text-muted-foreground">Brands: {m.brand_names.join(", ")}</div>
                  )}
                  <div className="mt-1 text-[11px] font-medium text-[#0066FF]">{m.drug_class}</div>
                  <p className="mt-2 leading-relaxed text-foreground">
                    <strong>Indications:</strong> {m.uses}
                  </p>
                  <p className="mt-1.5 leading-relaxed text-muted-foreground">
                    <strong>Warnings/Precautions:</strong> {m.precautions}
                  </p>
                  <p className="mt-1.5 leading-relaxed text-muted-foreground">
                    <strong>Interactions:</strong> {m.interactions}
                  </p>
                  <a
                    href={m.source_url}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-2 inline-flex min-h-[32px] items-center gap-1 text-[11px] font-medium text-[#0066FF] hover:underline"
                  >
                    <span>Source: {medSource}</span>
                    <ExternalLink className="size-3" aria-hidden="true" />
                  </a>
                </div>
              ))}
            </CardContent>
          </Card>
        </div>

        {/* Active Chat Thread */}
        <Card className="flex min-h-[600px] flex-col lg:col-span-8">
          <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <CardTitle className="text-sm">Consultation Assistant Thread</CardTitle>
              <CardDescription className="mt-0.5 flex flex-wrap items-center gap-2">
                <Badge variant={contextEffective ? "teal" : "neutral"}>
                  {contextEffective
                    ? "Answering With Relevant Personal Vault Context"
                    : "General Educational Mode (Vault Context Off)"}
                </Badge>
                {lastContextInfo?.used && lastContextInfo.categories && lastContextInfo.categories.length > 0 && (
                  <span className="text-[11px] text-muted-foreground">
                    Loaded: {lastContextInfo.categories.join(", ")}
                  </span>
                )}
              </CardDescription>
            </div>
            <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-2 rounded-md border border-border bg-background px-3 text-xs font-medium">
              <input
                type="checkbox"
                checked={useVaultContext}
                onChange={(e) => handleToggleVaultContext(e.target.checked)}
                disabled={chatStatus ? !chatStatus.ai_consent : false}
                className="size-4 accent-[#0E7C7B]"
              />
              <Database className="size-3.5 text-[#0066FF]" aria-hidden="true" />
              <span>Use My Medical Vault Context</span>
            </label>
          </CardHeader>

          <CardContent className="flex flex-1 flex-col justify-between gap-4">
            <div
              className="flex flex-col gap-3 overflow-y-auto pr-1"
              style={{ maxHeight: "460px" }}
              aria-live="polite"
            >
              {messages.length === 0 ? (
                <div className="flex flex-col gap-4 py-4">
                  <div className="rounded-md border border-border bg-muted/20 p-4 text-xs leading-relaxed text-muted-foreground">
                    <div className="flex items-center gap-2 font-semibold text-primary">
                      <Info className="size-4 text-[#0066FF]" aria-hidden="true" />
                      <span>Educational Healthcare Guidance &amp; Privacy</span>
                    </div>
                    <p className="mt-1.5">
                      This assistant explains reports, medicines, and symptoms in plain language. It never diagnoses
                      conditions, never prescribes medications, and retrieves only records relevant to your question when
                      vault context is enabled.
                    </p>
                  </div>
                  <div>
                    <div className="mb-2 text-xs font-semibold text-primary">Suggested Questions</div>
                    <div className="flex flex-wrap gap-2">
                      {suggestions.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => handleSend(undefined, s)}
                          disabled={sending}
                          className="min-h-[44px] rounded-md border border-border bg-card px-3 py-2 text-left text-xs font-medium text-foreground hover:bg-muted disabled:opacity-50"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                </div>
              ) : (
                messages.map((m) => (
                  <div
                    key={m.id}
                    className={`flex flex-col gap-2 rounded-lg border p-3.5 text-xs ${
                      m.role === "user"
                        ? "ml-auto max-w-[85%] border-primary/25 bg-primary/5 text-foreground"
                        : m.is_emergency
                        ? "border-destructive bg-destructive/10"
                        : "mr-auto w-full max-w-[95%] border-border bg-card"
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="font-semibold text-primary">
                        {m.role === "user" ? "You" : m.is_emergency ? "Urgent Safety Alert" : "Gemini Health Assistant"}
                      </span>
                      <div className="flex items-center gap-1.5">
                        {m.role === "assistant" && (
                          <Badge variant={m.is_emergency ? "critical" : "verified"}>
                            {m.provider_mode}
                          </Badge>
                        )}
                        <span className="text-[11px] text-muted-foreground">{formatDateTime(m.created_at)}</span>
                      </div>
                    </div>

                    {m.is_emergency && (
                      <div className="flex items-center gap-1.5 font-semibold text-destructive">
                        <ShieldAlert className="size-4" aria-hidden="true" />
                        <span>Immediate emergency evaluation advised</span>
                      </div>
                    )}

                    <div className="prose-chat text-xs leading-relaxed text-foreground">
                      <ReactMarkdown
                        components={{
                          h1: ({ children }) => <h3 className="mt-2 mb-1 text-sm font-bold text-primary">{children}</h3>,
                          h2: ({ children }) => <h3 className="mt-2 mb-1 text-sm font-bold text-primary">{children}</h3>,
                          h3: ({ children }) => <h4 className="mt-2 mb-1 text-xs font-bold uppercase tracking-wide text-primary">{children}</h4>,
                          p: ({ children }) => <p className="mb-2 last:mb-0">{children}</p>,
                          ul: ({ children }) => <ul className="mb-2 ml-4 list-disc space-y-1">{children}</ul>,
                          ol: ({ children }) => <ol className="mb-2 ml-4 list-decimal space-y-1">{children}</ol>,
                          li: ({ children }) => <li>{children}</li>,
                          strong: ({ children }) => <strong className="font-semibold text-primary">{children}</strong>,
                          code: ({ children }) => (
                            <code className="rounded bg-muted px-1 py-0.5 font-mono text-[11px]">{children}</code>
                          ),
                        }}
                      >
                        {m.content}
                      </ReactMarkdown>
                    </div>

                    {m.attachment_image_name && (
                      <div className="flex items-center gap-1 text-[11px] text-muted-foreground">
                        <Paperclip className="size-3" aria-hidden="true" />
                        <span>Attachment: {m.attachment_image_name}</span>
                      </div>
                    )}

                    {m.citations?.length > 0 && (
                      <div className="mt-1 flex flex-wrap gap-1.5 border-t border-border/60 pt-2">
                        {m.citations.map((c: any, idx: number) => (
                          <Badge key={idx} variant="neutral">
                            <FileText className="size-3" aria-hidden="true" />
                            <span>{c.label}</span>
                          </Badge>
                        ))}
                      </div>
                    )}
                  </div>
                ))
              )}

              {sending && (
                <div className="mr-auto flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-4 py-3 text-xs text-primary">
                  <Loader2 className="size-4 animate-spin text-[#0066FF]" aria-hidden="true" />
                  <span>Generating Gemini healthcare explanation...</span>
                </div>
              )}

              <div ref={messagesEndRef} />
            </div>

            {sendError && (
              <Alert variant="danger" title="Assistant Request Error">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <span>{sendError}</span>
                  {failedDraft && (
                    <Button variant="outline" size="sm" onClick={handleRetry} disabled={sending}>
                      <RotateCcw className="size-3.5" aria-hidden="true" />
                      <span>Retry</span>
                    </Button>
                  )}
                </div>
              </Alert>
            )}

            <form onSubmit={(e) => handleSend(e)} className="flex flex-col gap-2.5 border-t border-border pt-3">
              {/* Pending attachment preview */}
              {attachmentFile && (
                <div className="flex items-center justify-between gap-3 rounded-md border border-border bg-muted/30 p-2.5 text-xs">
                  <div className="flex items-center gap-3 overflow-hidden">
                    {attachmentPreviewUrl ? (
                      <img
                        src={attachmentPreviewUrl}
                        alt="Selected upload preview"
                        className="size-14 rounded border border-border object-cover"
                      />
                    ) : (
                      <div className="flex size-12 items-center justify-center rounded border border-border bg-card">
                        <FileText className="size-5 text-[#0066FF]" aria-hidden="true" />
                      </div>
                    )}
                    <div className="truncate">
                      <div className="truncate font-medium text-primary">{attachmentFile.name}</div>
                      <div className="text-[11px] text-muted-foreground">
                        {(attachmentFile.size / 1024).toFixed(1)} KB ready to send
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    aria-label="Remove attachment"
                    onClick={clearAttachment}
                    className="inline-flex size-10 shrink-0 items-center justify-center rounded-md border border-border bg-card text-muted-foreground hover:bg-muted hover:text-destructive"
                  >
                    <X className="size-4" aria-hidden="true" />
                  </button>
                </div>
              )}

              <div className="flex flex-wrap items-center gap-2">
                <select
                  aria-label="Attach vault document"
                  value={attachedDocId}
                  onChange={(e) => setAttachedDocId(e.target.value)}
                  className="min-h-[44px] rounded-md border border-input bg-card px-2.5 text-xs"
                >
                  <option value="">No vault document attached</option>
                  {vaultDocs.map((d) => (
                    <option key={d.id} value={String(d.id)}>
                      Attach: {d.title}
                    </option>
                  ))}
                </select>

                <label className="inline-flex min-h-[44px] cursor-pointer items-center gap-1.5 rounded-md border border-border bg-card px-3 text-xs font-medium hover:bg-muted">
                  <Camera className="size-4 text-[#0066FF]" aria-hidden="true" />
                  <span>{attachmentFile ? "Replace File" : "Attach Image / PDF"}</span>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept=".jpg,.jpeg,.png,.pdf"
                    className="hidden"
                    onChange={(e) => setAttachmentFile(e.target.files?.[0] || null)}
                  />
                </label>
              </div>

              <div className="flex gap-2">
                <Input
                  value={inputText}
                  onChange={(e) => setInputText(e.target.value)}
                  placeholder="Ask about your labs, medicines, symptoms, or an attached report..."
                  aria-label="Message Gemini healthcare assistant"
                  disabled={sending}
                />
                <Button type="submit" disabled={sending || !inputText.trim()}>
                  <Send className="size-4" aria-hidden="true" />
                  <span>{sending ? "Sending..." : "Send"}</span>
                </Button>
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <AlertTriangle className="size-3.5 shrink-0 text-amber-600" aria-hidden="true" />
                <span>
                  Educational information only. Not a diagnosis or prescription; seek a physician for medical decisions.
                </span>
              </div>
            </form>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
