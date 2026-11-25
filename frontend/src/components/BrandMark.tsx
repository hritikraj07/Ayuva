import { cn } from "@/lib/utils";

export function BrandMark({ className }: { className?: string; inverted?: boolean }) {
  return (
    <span className={cn("inline-flex items-center gap-2.5 select-none", className)}>
      <span className="flex size-9 items-center justify-center rounded-full bg-white border border-[#E5E9F0] shadow-xs">
        <span className="font-display text-sm font-extrabold tracking-tight text-[#111827]">
          A<sup className="ml-0.5 text-[11px] font-bold text-[#0066FF]">+</sup>
        </span>
      </span>
      <span className="font-display text-lg font-bold tracking-tight text-[#111827]">
        Ayu<span className="text-[#0066FF]">va</span>
      </span>
    </span>
  );
}
