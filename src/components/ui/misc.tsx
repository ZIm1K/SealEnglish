"use client";

import { cva, type VariantProps } from "class-variance-authority";
import { Avatar as AvatarPrimitive } from "radix-ui";
import { Loader2 } from "lucide-react";
import { cn, initials } from "@/lib/utils";

export const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold whitespace-nowrap",
  {
    variants: {
      tone: {
        seal: "bg-seal-100 text-seal-800",
        coral: "bg-coral-100 text-coral-700",
        mint: "bg-emerald-50 text-emerald-700",
        sun: "bg-amber-50 text-amber-700",
        grape: "bg-violet-50 text-violet-700",
        gray: "bg-slate-100 text-slate-600",
        red: "bg-red-50 text-red-600",
        ocean: "bg-ocean-800 text-white",
      },
    },
    defaultVariants: { tone: "seal" },
  },
);

export function Badge({ className, tone, ...props }: React.HTMLAttributes<HTMLSpanElement> & VariantProps<typeof badgeVariants>) {
  return <span className={cn(badgeVariants({ tone }), className)} {...props} />;
}

const AVATAR_TONES = [
  "from-seal-400 to-seal-600",
  "from-coral-300 to-coral-500",
  "from-emerald-300 to-emerald-500",
  "from-violet-300 to-violet-500",
  "from-amber-300 to-amber-500",
  "from-sky-300 to-sky-500",
];

export function Avatar({ name, src, size = 36, className }: { name?: string | null; src?: string | null; size?: number; className?: string }) {
  const tone = AVATAR_TONES[(name ?? "").split("").reduce((a, c) => a + c.charCodeAt(0), 0) % AVATAR_TONES.length];
  return (
    <AvatarPrimitive.Root
      className={cn("relative inline-flex shrink-0 overflow-hidden rounded-full ring-2 ring-white", className)}
      style={{ width: size, height: size }}
    >
      {src && <AvatarPrimitive.Image src={src} alt={name ?? ""} className="size-full object-cover" />}
      <AvatarPrimitive.Fallback
        className={cn("flex size-full items-center justify-center bg-gradient-to-br font-semibold text-white", tone)}
        style={{ fontSize: size * 0.38 }}
      >
        {initials(name)}
      </AvatarPrimitive.Fallback>
    </AvatarPrimitive.Root>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <Loader2 className={cn("size-5 animate-spin text-seal-600", className)} />;
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cn("skeleton h-4", className)} />;
}

export function Card({ className, ...props }: React.HTMLAttributes<HTMLDivElement>) {
  return <div className={cn("card", className)} {...props} />;
}

export function CardHeader({
  title, description, action, className,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-4 px-5 pt-5 sm:px-6 sm:pt-6", className)}>
      <div className="min-w-0">
        <h3 className="font-display text-base font-semibold text-ink">{title}</h3>
        {description && <p className="mt-1 text-sm text-mute">{description}</p>}
      </div>
      {action}
    </div>
  );
}

const URL_RE = /(https?:\/\/[^\s<>"']+|www\.[^\s<>"']+)/gi;

/** Plain text with http(s)/www links made clickable (opens in a new tab). Trailing punctuation stays outside the link. */
export function Linkify({ text, className }: { text: string; className?: string }) {
  const parts = text.split(URL_RE);
  return (
    <>
      {parts.map((part, i) => {
        if (i % 2 === 0) return part;
        const url = part.replace(/[.,;:!?)\]]+$/, "");
        const tail = part.slice(url.length);
        return (
          <span key={i}>
            <a
              href={url.startsWith("www.") ? `https://${url}` : url}
              target="_blank"
              rel="noopener noreferrer"
              onClick={(e) => e.stopPropagation()}
              className={cn("font-medium break-all text-seal-700 underline decoration-seal-300 underline-offset-2 hover:text-seal-800", className)}
            >
              {url}
            </a>
            {tail}
          </span>
        );
      })}
    </>
  );
}
