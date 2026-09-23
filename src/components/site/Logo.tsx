import Link from "next/link";
import { cn } from "@/lib/utils";
import { SealMark } from "@/components/mascot/SealMark";

export function Logo({ className, dark = false, href = "/" }: { className?: string; dark?: boolean; href?: string }) {
  return (
    <Link href={href} className={cn("group inline-flex items-center gap-2.5", className)} aria-label="Seal English — на головну">
      <span className="relative flex size-10 items-center justify-center overflow-hidden rounded-2xl bg-gradient-to-br from-ocean-900 via-ocean-800 to-seal-700 shadow-soft ring-1 ring-white/10 transition-transform duration-300 group-hover:-rotate-6 group-hover:scale-105">
        <span aria-hidden className="absolute -top-3 -right-3 size-8 rounded-full bg-seal-400/40 blur-md" />
        <SealMark className="relative mt-2 w-[46px]" />
      </span>
      <span className={cn("font-display text-[1.05rem] leading-none font-bold tracking-tight", dark ? "text-white" : "text-ocean-900")}>
        Seal<span className={dark ? "text-seal-300" : "text-seal-600"}>English</span>
      </span>
    </Link>
  );
}
