import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatDate(iso?: string | null): string {
  if (!iso) return "Not specified";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString("en-IN", { year: "numeric", month: "short", day: "numeric" });
}

export function formatDateTime(iso?: string | null): string {
  if (!iso) return "Not specified";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString("en-IN", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function formatCountdown(seconds: number): string {
  if (seconds <= 0) return "Expired";
  const hrs = Math.floor(seconds / 3600);
  const mins = Math.floor((seconds % 3600) / 60);
  const secs = seconds % 60;
  if (hrs > 24) return `${Math.floor(hrs / 24)}d ${hrs % 24}h left`;
  if (hrs > 0) return `${hrs}h ${mins}m left`;
  return `${mins}m ${secs.toString().padStart(2, "0")}s left`;
}

export const CATEGORY_LABELS: Record<string, string> = {
  prescription: "Prescription",
  lab_report: "Laboratory Report",
  medical_certificate: "Medical Certificate",
  diagnostic_report: "Diagnostic Report",
  discharge_summary: "Discharge Summary",
};
