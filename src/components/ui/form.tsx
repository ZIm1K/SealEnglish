import { forwardRef } from "react";
import { ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

const field =
  "w-full rounded-xl border border-line bg-white px-3.5 text-[0.95rem] text-ink shadow-[0_1px_2px_rgb(13_26_46/0.04)] transition placeholder:text-mute/70 hover:border-seal-300 focus:border-seal-500 focus:ring-4 focus:ring-seal-200/60 focus:outline-none disabled:cursor-not-allowed disabled:bg-seal-50 disabled:opacity-70 aria-[invalid=true]:border-coral-500 aria-[invalid=true]:ring-coral-100";

export const Input = forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...props }, ref) => <input ref={ref} className={cn(field, "h-11", className)} {...props} />,
);
Input.displayName = "Input";

export const Textarea = forwardRef<HTMLTextAreaElement, React.TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...props }, ref) => <textarea ref={ref} className={cn(field, "min-h-24 py-2.5 leading-relaxed", className)} {...props} />,
);
Textarea.displayName = "Textarea";

export const Select = forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <div className="relative">
      <select ref={ref} className={cn(field, "h-11 appearance-none pr-10", className)} {...props}>
        {children}
      </select>
      <ChevronDown className="pointer-events-none absolute top-1/2 right-3 size-4 -translate-y-1/2 text-mute" />
    </div>
  ),
);
Select.displayName = "Select";

export function Label({ className, children, hint, ...props }: React.LabelHTMLAttributes<HTMLLabelElement> & { hint?: React.ReactNode }) {
  return (
    <label className={cn("mb-1.5 flex items-baseline justify-between gap-2 text-sm font-semibold text-ink-soft", className)} {...props}>
      <span>{children}</span>
      {hint && <span className="text-xs font-normal text-mute">{hint}</span>}
    </label>
  );
}

export function Field({
  label, hint, error, children, className, htmlFor,
}: {
  label?: React.ReactNode;
  hint?: React.ReactNode;
  error?: string;
  children: React.ReactNode;
  className?: string;
  htmlFor?: string;
}) {
  return (
    <div className={className}>
      {label && <Label htmlFor={htmlFor} hint={hint}>{label}</Label>}
      {children}
      {error && <p className="mt-1.5 text-xs font-medium text-coral-600">{error}</p>}
    </div>
  );
}

export function Checkbox({ className, label, ...props }: React.InputHTMLAttributes<HTMLInputElement> & { label?: React.ReactNode }) {
  return (
    <label className={cn("inline-flex cursor-pointer items-center gap-2.5 text-sm text-ink-soft select-none", className)}>
      <input
        type="checkbox"
        className="size-4.5 cursor-pointer rounded-md border-line accent-seal-600"
        {...props}
      />
      {label}
    </label>
  );
}

export function Segmented<T extends string>({
  value, onChange, options, className, size = "md",
}: {
  value: T;
  onChange: (v: T) => void;
  options: { value: T; label: React.ReactNode }[];
  className?: string;
  size?: "sm" | "md";
}) {
  return (
    <div className={cn("inline-flex rounded-xl bg-seal-100/70 p-1", className)} role="tablist">
      {options.map((o) => (
        <button
          key={o.value}
          type="button"
          role="tab"
          aria-selected={value === o.value}
          onClick={() => onChange(o.value)}
          className={cn(
            "cursor-pointer rounded-lg font-semibold transition",
            size === "sm" ? "px-2.5 py-1 text-xs" : "px-3.5 py-1.5 text-sm",
            value === o.value ? "bg-white text-ink shadow-soft" : "text-mute hover:text-ink",
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}
