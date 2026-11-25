import { useId } from "react";
import { cn } from "@/lib/utils";

export function BrandMark({
  className,
  inverted = false,
  compact = false,
}: {
  className?: string;
  inverted?: boolean;
  compact?: boolean;
}) {
  const uid = useId().replace(/:/g, "");
  const gradId = `ayuvaMark-${uid}`;

  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <span className="relative flex size-9 shrink-0 items-center justify-center rounded-xl shadow-[0_8px_18px_-6px_rgba(0,102,255,0.5)]">
        <svg viewBox="0 0 40 40" className="size-9" fill="none" aria-hidden="true">
          <defs>
            <linearGradient id={gradId} x1="4" y1="2" x2="36" y2="38" gradientUnits="userSpaceOnUse">
              <stop offset="0%" stopColor="#0A74FF" />
              <stop offset="100%" stopColor="#0044C4" />
            </linearGradient>
          </defs>
          <rect x="1" y="1" width="38" height="38" rx="11" fill={`url(#${gradId})`} />
          <rect x="1.5" y="1.5" width="37" height="37" rx="10.5" stroke="#FFFFFF" strokeOpacity="0.22" />
          <path
            d="M20 31.2C13.8 27.1 9.6 22.8 9.6 17.3C9.6 13.7 12.4 10.8 15.9 10.8C17.9 10.8 19.3 11.8 20 13.2C20.7 11.8 22.1 10.8 24.1 10.8C27.6 10.8 30.4 13.7 30.4 17.3C30.4 22.8 26.2 27.1 20 31.2Z"
            fill="#FFFFFF"
            fillOpacity="0.16"
            stroke="#FFFFFF"
            strokeWidth="1.8"
            strokeLinejoin="round"
          />
          <path
            d="M11.2 20.3H15.2L17.3 15.8L19.7 23.8L22.1 17.8L23.7 20.3H28.8"
            stroke="#FFFFFF"
            strokeWidth="1.9"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
          <circle cx="29.5" cy="11.2" r="2.7" fill="#FF4D6D" stroke="#FFFFFF" strokeWidth="1.1" />
        </svg>
      </span>
      {!compact && (
        <span className="flex flex-col leading-none">
          <span
            className={cn(
              "font-display text-lg font-bold tracking-tight",
              inverted ? "text-white" : "text-[#111827]"
            )}
          >
            Ayu<span className={inverted ? "text-[#93C5FD]" : "text-[#0066FF]"}>va</span>
          </span>
          <span
            className={cn(
              "mt-0.5 font-mono text-[9px] font-semibold uppercase tracking-[0.16em]",
              inverted ? "text-slate-300" : "text-[#64748B]"
            )}
          >
            Health AI
          </span>
        </span>
      )}
    </span>
  );
}
