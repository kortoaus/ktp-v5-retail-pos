// PLACEHOLDER (retail-eftpos T-7, assumption A-21): the SCI logo asset is not
// in hand yet. Certification needs the "Simple Cloud Integration" name and the
// SCI logo on the pairing screen — drop the official file in
// `src/renderer/src/assets/` and render it here as an <img>; callers do not
// change. Never show the vendor name, only "SCI".
import { cn } from "../../libs/cn";

export default function SciLogo({ className }: { className?: string }) {
  return (
    <span
      aria-label="SCI logo"
      title="SCI"
      className={cn(
        "inline-flex items-center justify-center rounded-md border-2 border-slate-800 px-2 font-black tracking-widest text-slate-800",
        className,
      )}
    >
      SCI
    </span>
  );
}
