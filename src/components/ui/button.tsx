import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../../lib/utils";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-md text-sm font-semibold transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-2 focus-visible:ring-offset-slate-950 disabled:pointer-events-none disabled:opacity-50 active:translate-y-px",
  { variants: {
    variant: {
      default: "bg-sky-400 text-slate-950 shadow-[0_0_24px_rgba(56,189,248,.18)] hover:bg-sky-300 hover:shadow-[0_0_30px_rgba(56,189,248,.3)]",
      destructive: "bg-rose-500 text-white hover:bg-rose-400",
      outline: "border border-white/15 bg-white/[0.03] text-slate-100 hover:border-sky-400/50 hover:bg-sky-400/[0.08]",
      secondary: "bg-slate-800 text-slate-100 hover:bg-slate-700",
      ghost: "text-slate-300 hover:bg-white/[0.06] hover:text-white",
      link: "text-sky-300 underline-offset-4 hover:underline"
    },
    size: { default: "h-10 px-4 py-2", sm: "h-9 rounded-md px-3", lg: "h-11 rounded-lg px-8", icon: "h-10 w-10" }
  }, defaultVariants: { variant: "default", size: "default" } }
);

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement>, VariantProps<typeof buttonVariants> { asChild?: boolean; }

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(({ className, variant, size, asChild = false, ...props }, ref) => {
  const Comp = asChild ? Slot : "button";
  return <Comp ref={ref} className={cn(buttonVariants({ variant, size }), className)} {...props} />;
});
Button.displayName = "Button";
export { Button, buttonVariants };