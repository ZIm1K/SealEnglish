"use client";

import { Dialog as D, DropdownMenu as DM, Tooltip as T } from "radix-ui";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";

// ───────────── Dialog ─────────────
export const Dialog = D.Root;
export const DialogTrigger = D.Trigger;
export const DialogClose = D.Close;

export function DialogContent({
  title, description, children, className, size = "md", hideClose,
}: {
  title: React.ReactNode;
  description?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  size?: "sm" | "md" | "lg" | "xl";
  hideClose?: boolean;
}) {
  const w = { sm: "max-w-md", md: "max-w-lg", lg: "max-w-2xl", xl: "max-w-4xl" }[size];
  return (
    <D.Portal>
      <D.Overlay className="fixed inset-0 z-50 bg-ocean-950/40 backdrop-blur-sm data-[state=closed]:animate-[fadeOut_.15s] data-[state=open]:animate-[fadeIn_.2s]" />
      <D.Content
        className={cn(
          "fixed inset-x-0 bottom-0 z-50 mx-auto max-h-[92dvh] w-full overflow-y-auto rounded-t-3xl bg-white p-5 shadow-lift outline-none sm:top-1/2 sm:bottom-auto sm:-translate-y-1/2 sm:rounded-3xl sm:p-7",
          "data-[state=open]:animate-[dialogIn_.25s_cubic-bezier(.2,.9,.3,1.2)]",
          w,
          className,
        )}
      >
        <div className="mb-5 pr-8">
          <D.Title className="font-display text-lg font-semibold text-ink">{title}</D.Title>
          {description ? (
            <D.Description className="mt-1 text-sm text-mute">{description}</D.Description>
          ) : (
            <D.Description className="sr-only">{typeof title === "string" ? title : ""}</D.Description>
          )}
        </div>
        {children}
        {!hideClose && (
          <D.Close className="absolute top-4 right-4 flex size-9 cursor-pointer items-center justify-center rounded-xl text-mute transition hover:bg-seal-100 hover:text-ink">
            <X className="size-5" />
            <span className="sr-only">Закрити</span>
          </D.Close>
        )}
      </D.Content>
    </D.Portal>
  );
}

// ───────────── Dropdown ─────────────
export const Menu = DM.Root;
export const MenuTrigger = DM.Trigger;

export function MenuContent({ children, align = "end", className }: { children: React.ReactNode; align?: "start" | "end" | "center"; className?: string }) {
  return (
    <DM.Portal>
      <DM.Content
        align={align}
        sideOffset={8}
        className={cn(
          "z-50 min-w-52 rounded-2xl border border-line bg-white p-1.5 shadow-lift data-[state=open]:animate-[popIn_.16s_ease-out]",
          className,
        )}
      >
        {children}
      </DM.Content>
    </DM.Portal>
  );
}

export function MenuItem({ className, danger, ...props }: React.ComponentProps<typeof DM.Item> & { danger?: boolean }) {
  return (
    <DM.Item
      className={cn(
        "flex cursor-pointer items-center gap-2.5 rounded-xl px-3 py-2 text-sm font-medium text-ink-soft outline-none select-none data-[highlighted]:bg-seal-50 data-[highlighted]:text-ink [&_svg]:size-4 [&_svg]:text-mute",
        danger && "text-red-600 data-[highlighted]:bg-red-50 data-[highlighted]:text-red-700 [&_svg]:text-red-500",
        className,
      )}
      {...props}
    />
  );
}

export function MenuSeparator() {
  return <DM.Separator className="my-1 h-px bg-line" />;
}

export function MenuLabel({ children }: { children: React.ReactNode }) {
  return <DM.Label className="px-3 pt-2 pb-1 text-xs font-semibold text-mute">{children}</DM.Label>;
}

// ───────────── Tooltip ─────────────
export function Tip({ content, children, side = "top" }: { content: React.ReactNode; children: React.ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <T.Provider delayDuration={250}>
      <T.Root>
        <T.Trigger asChild>{children}</T.Trigger>
        <T.Portal>
          <T.Content side={side} sideOffset={6} className="z-50 rounded-lg bg-ocean-900 px-2.5 py-1.5 text-xs font-medium text-white shadow-lift">
            {content}
            <T.Arrow className="fill-ocean-900" />
          </T.Content>
        </T.Portal>
      </T.Root>
    </T.Provider>
  );
}
