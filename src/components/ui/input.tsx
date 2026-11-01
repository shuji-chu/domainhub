import * as React from "react";
import { cn } from "../../lib/utils";

const Input = React.forwardRef<HTMLInputElement, React.ComponentProps<"input">>(({ className, type, ...props }, ref) => (
  <input type={type} className={cn("flex h-11 w-full rounded-lg border border-white/10 bg-slate-950/70 px-3 py-2 text-sm text-slate-100 shadow-sm outline-none transition-all duration-200 placeholder:text-slate-500 hover:border-white/20 focus:border-sky-400/70 focus:shadow-[0_0_0_3px_rgba(56,189,248,.12),0_0_24px_rgba(56,189,248,.08)] disabled:cursor-not-allowed disabled:opacity-50", className)} ref={ref} {...props} />
));
Input.displayName = "Input";
export { Input };