import React, { useEffect } from "react";
import { AlertTriangle, CheckCircle2, Info, Loader2, X } from "lucide-react";
import { cn } from "@/lib/utils";

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: "primary" | "secondary" | "outline" | "ghost" | "destructive" | "accent";
  size?: "sm" | "md" | "lg";
}

export function Button({
  variant = "primary",
  size = "md",
  className,
  type = "button",
  children,
  ...props
}: ButtonProps) {
  const variants: Record<NonNullable<ButtonProps["variant"]>, string> = {
    primary:
      "bg-[#0066FF] text-white hover:bg-[#0052CC] border border-transparent shadow-[0_8px_20px_-8px_rgba(0,102,255,0.55)]",
    accent:
      "bg-[#0066FF] text-white hover:bg-[#0052CC] border border-transparent shadow-[0_8px_20px_-8px_rgba(0,102,255,0.45)]",
    secondary:
      "bg-white text-[#111827] hover:bg-[#F6F8FB] border border-[#E5E9F0] shadow-xs",
    outline:
      "bg-white text-[#111827] border border-[#E5E9F0] hover:bg-[#F6F8FB] hover:border-[#0066FF]/40",
    ghost: "bg-transparent text-[#111827] hover:bg-[#E9EEF5]/70 border border-transparent",
    destructive:
      "bg-[#EF233C] text-white hover:bg-[#D90429] border border-transparent",
  };
  const sizes: Record<NonNullable<ButtonProps["size"]>, string> = {
    sm: "min-h-[40px] px-3.5 py-1.5 text-xs",
    md: "min-h-[44px] px-5 py-2 text-sm",
    lg: "min-h-[48px] px-6 py-2.5 text-base",
  };

  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-full font-medium transition-all duration-150 disabled:opacity-50",
        variants[variant],
        sizes[size],
        className
      )}
      {...props}
    >
      {children}
    </button>
  );
}

export function Card({ className, children }: { className?: string; children: React.ReactNode }) {
  return (
    <div
      className={cn(
        "rounded-3xl border border-[#E5E9F0] bg-white text-[#111827] shadow-[0_12px_32px_-16px_rgba(15,23,42,0.08)]",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("flex flex-col gap-1 border-b border-[#EEF1F5] bg-[#FAFBFC] rounded-t-3xl px-6 py-4", className)}>{children}</div>;
}

export function CardTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return <h3 className={cn("font-display text-base font-semibold text-[#111827]", className)}>{children}</h3>;
}

export function CardDescription({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn("text-xs text-[#64748B] leading-relaxed", className)}>{children}</p>;
}

export function CardContent({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("px-6 py-5", className)}>{children}</div>;
}

export function Badge({
  variant = "neutral",
  className,
  children,
}: {
  variant?: "neutral" | "low" | "moderate" | "high" | "critical" | "verified" | "teal" | "insufficient_data";
  className?: string;
  children: React.ReactNode;
}) {
  const styles: Record<string, string> = {
    neutral: "bg-[#F3F5F8] text-[#334155] border-[#E5E9F0]",
    teal: "bg-[#EFF6FF] text-[#0066FF] border-[#BFDBFE]",
    verified: "bg-emerald-50 text-emerald-700 border-emerald-200",
    low: "bg-emerald-50 text-emerald-700 border-emerald-200",
    moderate: "bg-amber-50 text-amber-800 border-amber-200",
    high: "bg-orange-50 text-orange-800 border-orange-200",
    critical: "bg-rose-50 text-[#EF233C] border-rose-200",
    insufficient_data: "bg-slate-100 text-slate-600 border-slate-200",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-xs font-medium", styles[variant], className)}>
      {children}
    </span>
  );
}

export function Alert({
  variant = "info",
  title,
  children,
  className,
}: {
  variant?: "info" | "warning" | "danger" | "success";
  title?: string;
  children: React.ReactNode;
  className?: string;
}) {
  const styles = {
    info: "border-[#BFDBFE] bg-[#EFF6FF] text-[#111827]",
    warning: "border-amber-200 bg-amber-50 text-amber-950",
    danger: "border-rose-200 bg-rose-50 text-rose-950",
    success: "border-emerald-200 bg-emerald-50 text-emerald-950",
  };
  const Icon = variant === "danger" || variant === "warning" ? AlertTriangle : variant === "success" ? CheckCircle2 : Info;
  return (
    <div role="alert" className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm", styles[variant], className)}>
      <Icon className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
      <div className="flex flex-1 flex-col gap-1">
        {title && <div className="font-semibold">{title}</div>}
        <div className="leading-relaxed">{children}</div>
      </div>
    </div>
  );
}

export function Input({ className, ...props }: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      className={cn(
        "min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-foreground placeholder:text-slate-500 disabled:bg-slate-100 focus:border-accent focus:outline-none",
        className
      )}
      {...props}
    />
  );
}

export function Select({ className, children, ...props }: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      className={cn(
        "min-h-[44px] w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-foreground disabled:bg-slate-100 focus:border-accent focus:outline-none",
        className
      )}
      {...props}
    >
      {children}
    </select>
  );
}

export function Textarea({ className, ...props }: React.TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      className={cn(
        "w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-foreground placeholder:text-slate-500 disabled:bg-slate-100 focus:border-accent focus:outline-none",
        className
      )}
      {...props}
    />
  );
}

export function FieldLabel({ htmlFor, children, className }: { htmlFor?: string; children: React.ReactNode; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn("text-xs font-semibold text-primary", className)}>
      {children}
    </label>
  );
}

export function Modal({
  open,
  onClose,
  title,
  description,
  children,
  maxWidthClass = "max-w-2xl",
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  description?: string;
  children: React.ReactNode;
  maxWidthClass?: string;
}) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#141C2E]/45 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-heading"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={cn("max-h-[90dvh] w-full overflow-y-auto rounded-xl border border-slate-300 bg-secondary shadow-2xl", maxWidthClass)}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-slate-200 bg-card px-5 py-4">
          <div className="flex flex-col gap-1">
            <h2 id="modal-heading" className="font-display text-lg font-semibold text-primary">
              {title}
            </h2>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-primary"
          >
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
        <div className="p-5">{children}</div>
      </div>
    </div>
  );
}

export function LoadingState({ message = "Loading records..." }: { message?: string }) {
  return (
    <div className="neo-glass flex flex-col items-center justify-center gap-3 rounded-xl p-10 text-center">
      <Loader2 className="size-6 animate-spin text-primary" aria-hidden="true" />
      <p className="text-sm font-medium text-muted-foreground">{message}</p>
    </div>
  );
}

export function ErrorState({ message, onRetry }: { message: string; onRetry?: () => void }) {
  return (
    <div className="flex flex-col items-start gap-3 rounded-xl border border-rose-300 bg-rose-50 p-5 text-sm text-rose-950">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-4 shrink-0 text-rose-700" aria-hidden="true" />
        <span>Unable to load data</span>
      </div>
      <p>{message}</p>
      {onRetry && (
        <Button variant="outline" size="sm" onClick={onRetry}>
          Try again
        </Button>
      )}
    </div>
  );
}

export function EmptyState({
  icon: Icon,
  title,
  description,
  action,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  description: string;
  action?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-slate-300 bg-secondary/75 p-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-full border border-[#E5E9F0] bg-[#EFF6FF] text-[#0066FF]">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <div className="flex max-w-md flex-col gap-1">
        <h3 className="font-display text-base font-semibold text-primary">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
