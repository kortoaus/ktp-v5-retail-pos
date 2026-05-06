import type { MouseEvent, PointerEvent, ReactNode } from "react";
import { cn } from "../../../libs/cn";

export default function TapTarget({
  children,
  className,
  disabled,
  onClick,
  onPointerDown,
}: {
  children: ReactNode;
  className?: string;
  disabled?: boolean;
  onClick?: (event: MouseEvent<HTMLDivElement>) => void;
  onPointerDown?: (event: PointerEvent<HTMLDivElement>) => void;
}) {
  return (
    <div
      role="button"
      aria-disabled={disabled || undefined}
      onClick={disabled ? undefined : onClick}
      onPointerDown={disabled ? undefined : onPointerDown}
      className={cn("select-none", className)}
    >
      {children}
    </div>
  );
}
