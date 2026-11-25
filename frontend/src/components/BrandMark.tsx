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
        <rect width="34" height="34" rx="9" fill="#323A4D" />
        <path
          d="M6.5 17.5H11.5L14 11L18 23L21 14.5L23.2 17.5H27.5"
          stroke="#66A9EC"
          strokeWidth="2.3"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="17" cy="6.5" r="1.8" fill="#FFFFFF" />
      </svg>
      <span className="font-display text-lg font-bold tracking-tight text-primary">
        Ayu<span className="text-[#0284C7]">va</span>
      </span>
    </span>
  );
}
