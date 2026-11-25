import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <svg
        width="34"
        height="34"
        viewBox="0 0 34 34"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <defs>
          <linearGradient id="medledger-core" x1="0" y1="0" x2="34" y2="34" gradientUnits="userSpaceOnUse">
            <stop offset="0%" stopColor="#08203E" />
            <stop offset="100%" stopColor="#0E3B5E" />
          </linearGradient>
        </defs>
        <rect width="34" height="34" rx="9" fill="url(#medledger-core)" stroke="#22D3EE" strokeOpacity="0.45" />
        <path
          d="M6.5 17.5H11.5L14 11L18 23L21 14.5L23.2 17.5H27.5"
          stroke="#22D3EE"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="17" cy="6.5" r="1.8" fill="#A78BFA" />
      </svg>
      <span className="font-display text-lg font-bold tracking-tight text-foreground">
        Med<span className="text-primary">Ledger</span>
      </span>
    </span>
  );
}
