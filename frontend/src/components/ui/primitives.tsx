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
      "bg-primary text-primary-foreground hover:bg-primary/90 active:bg-primary/80 border border-primary/40 shadow-[0_0_20px_-8px_rgba(85,190,199,0.55)]",
    accent:
      "bg-accent text-accent-foreground hover:bg-accent/85 active:bg-accent/70 border border-border",
    secondary:
      "bg-secondary/20 text-foreground hover:bg-secondary/35 border border-secondary/45",
    outline:
      "bg-card/85 text-foreground border border-border hover:bg-accent/60 hover:border-secondary/50",
    ghost: "bg-transparent text-foreground hover:bg-accent/50 border border-transparent",
    destructive:
      "bg-destructive text-destructive-foreground hover:opacity-90 border border-destructive/40",
  };
  const sizes: Record<NonNullable<ButtonProps["size"]>, string> = {
    sm: "min-h-[44px] px-3 py-2 text-xs",
    md: "min-h-[44px] px-4 py-2 text-sm",
    lg: "min-h-[48px] px-5 py-2.5 text-base",
  };

  return (
    <button
      type={type}
      className={cn(
        "inline-flex items-center justify-center gap-2 rounded-lg font-medium transition-all duration-150 disabled:opacity-50",
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
        "rounded-xl border border-border/90 bg-card/80 text-card-foreground backdrop-blur-md shadow-[0_8px_30px_rgba(2,6,23,0.45)]",
        className
      )}
    >
      {children}
    </div>
  );
}

export function CardHeader({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("flex flex-col gap-1 border-b border-border/70 px-5 py-4", className)}>{children}</div>;
}

export function CardTitle({ className, children }: { className?: string; children: React.ReactNode }) {
  return <h3 className={cn("font-display text-base font-semibold text-foreground", className)}>{children}</h3>;
}

export function CardDescription({ className, children }: { className?: string; children: React.ReactNode }) {
  return <p className={cn("text-xs text-muted-foreground leading-relaxed", className)}>{children}</p>;
}

export function CardContent({ className, children }: { className?: string; children: React.ReactNode }) {
  return <div className={cn("px-5 py-4", className)}>{children}</div>;
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
    neutral: "bg-[#111F3D] text-slate-200 border-[#284270]",
    teal: "bg-cyan-950/70 text-cyan-200 border-cyan-500/40",
    verified: "bg-emerald-950/70 text-emerald-200 border-emerald-500/40",
    low: "bg-emerald-950/70 text-emerald-200 border-emerald-500/40",
    moderate: "bg-amber-950/70 text-amber-200 border-amber-500/40",
    high: "bg-orange-950/75 text-orange-200 border-orange-500/45",
    critical: "bg-rose-950/75 text-rose-200 border-rose-500/45",
    insufficient_data: "bg-slate-900/90 text-slate-300 border-slate-600/60",
  };
  return (
    <span className={cn("inline-flex items-center gap-1.5 rounded-md border px-2 py-0.5 text-xs font-medium", styles[variant], className)}>
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
    info: "border-cyan-500/35 bg-cyan-950/45 text-cyan-100",
    warning: "border-amber-500/40 bg-amber-950/45 text-amber-100",
    danger: "border-rose-500/45 bg-rose-950/50 text-rose-100",
    success: "border-emerald-500/40 bg-emerald-950/45 text-emerald-100",
  };
  const Icon = variant === "danger" || variant === "warning" ? AlertTriangle : variant === "success" ? CheckCircle2 : Info;
  return (
    <div role="alert" className={cn("flex gap-3 rounded-lg border px-4 py-3 text-sm backdrop-blur-sm", styles[variant], className)}>
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
        "min-h-[44px] w-full rounded-lg border border-input bg-[#071022]/90 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/75 disabled:bg-muted/50 focus:border-primary focus:outline-none",
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
        "min-h-[44px] w-full rounded-lg border border-input bg-[#071022]/90 px-3 py-2 text-sm text-foreground disabled:bg-muted/50 focus:border-primary focus:outline-none",
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
        "w-full rounded-lg border border-input bg-[#071022]/90 px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground/75 disabled:bg-muted/50 focus:border-primary focus:outline-none",
        className
      )}
      {...props}
    />
  );
}

export function FieldLabel({ htmlFor, children, className }: { htmlFor?: string; children: React.ReactNode; className?: string }) {
  return (
    <label htmlFor={htmlFor} className={cn("text-xs font-semibold text-foreground/90", className)}>
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-[#020612]/80 p-4 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="modal-heading"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className={cn("neo-glass max-h-[90dvh] w-full overflow-y-auto rounded-xl shadow-2xl", maxWidthClass)}>
        <div className="sticky top-0 z-10 flex items-start justify-between gap-4 border-b border-border bg-[#081226]/95 px-5 py-4 backdrop-blur-md">
          <div className="flex flex-col gap-1">
            <h2 id="modal-heading" className="font-display text-lg font-semibold text-foreground">
              {title}
            </h2>
            {description && <p className="text-xs text-muted-foreground">{description}</p>}
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close modal"
            className="inline-flex size-11 items-center justify-center rounded-lg text-muted-foreground hover:bg-muted hover:text-foreground"
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
    <div className="flex flex-col items-start gap-3 rounded-xl border border-rose-500/40 bg-rose-950/50 p-5 text-sm text-rose-100 backdrop-blur-sm">
      <div className="flex items-center gap-2 font-semibold">
        <AlertTriangle className="size-4 shrink-0 text-rose-400" aria-hidden="true" />
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
    <div className="flex flex-col items-center justify-center gap-3 rounded-xl border border-dashed border-border bg-[#071124]/60 p-10 text-center">
      <div className="flex size-12 items-center justify-center rounded-full border border-cyan-500/30 bg-cyan-950/50 text-primary">
        <Icon className="size-5" aria-hidden="true" />
      </div>
      <div className="flex max-w-md flex-col gap-1">
        <h3 className="font-display text-base font-semibold text-foreground">{title}</h3>
        <p className="text-sm text-muted-foreground">{description}</p>
      </div>
      {action && <div className="pt-1">{action}</div>}
    </div>
  );
}
