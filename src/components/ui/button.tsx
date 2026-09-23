import { cva, type VariantProps } from "class-variance-authority";
import { Slot } from "radix-ui";
import { Loader2 } from "lucide-react";
import { forwardRef } from "react";
import { cn } from "@/lib/utils";

export const buttonVariants = cva(
  "relative inline-flex shrink-0 cursor-pointer items-center justify-center gap-2 whitespace-nowrap font-semibold transition-all duration-200 select-none disabled:pointer-events-none disabled:opacity-55 active:scale-[0.97] [&_svg]:size-[1.1em] [&_svg]:shrink-0",
  {
    variants: {
      variant: {
        primary:
          "bg-coral-500 text-white shadow-coral hover:bg-coral-600 hover:shadow-[0_14px_34px_-10px_rgb(251_123_99/0.75)]",
        ocean: "bg-ocean-800 text-white shadow-soft hover:bg-ocean-700",
        soft: "bg-seal-100 text-seal-800 hover:bg-seal-200",
        outline: "border border-line bg-white text-ink shadow-soft hover:border-seal-300 hover:bg-seal-50",
        ghost: "text-ink-soft hover:bg-seal-100 hover:text-ink",
        glass: "border border-white/20 bg-white/10 text-white backdrop-blur hover:bg-white/20",
        white: "bg-white text-ocean-900 shadow-soft hover:bg-seal-50",
        danger: "bg-red-500 text-white hover:bg-red-600",
        link: "text-seal-700 underline-offset-4 hover:underline",
      },
      size: {
        xs: "h-8 rounded-lg px-2.5 text-xs",
        sm: "h-9 rounded-xl px-3.5 text-sm",
        md: "h-11 rounded-xl px-5 text-[0.95rem]",
        lg: "h-13 rounded-2xl px-7 text-base",
        xl: "h-15 rounded-2xl px-8 text-lg",
        icon: "size-10 rounded-xl",
        "icon-sm": "size-8 rounded-lg",
      },
    },
    defaultVariants: { variant: "primary", size: "md" },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
  loading?: boolean;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild, loading, children, disabled, ...props }, ref) => {
    const Comp = asChild ? Slot.Root : "button";
    return (
      <Comp
        ref={ref}
        className={cn(buttonVariants({ variant, size }), className)}
        disabled={disabled || loading}
        {...props}
      >
        {asChild ? (
          children
        ) : (
          <>
            {loading && <Loader2 className="animate-spin" />}
            {children}
          </>
        )}
      </Comp>
    );
  },
);
Button.displayName = "Button";
