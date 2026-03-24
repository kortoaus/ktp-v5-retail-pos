import { cn } from "../libs/cn";

export function InputField({
  label,
  active,
  onActivate,
  children,
}: {
  label: string;
  active: boolean;
  onActivate: () => void;
  children: React.ReactNode;
}) {
  return (
    <div
      onPointerDown={onActivate}
      className={cn(
        "flex items-center justify-between rounded-xl border-2 px-4 h-16 transition-colors",
        active ? "border-blue-500 bg-blue-50" : "border-gray-200 bg-white",
      )}
    >
      <span className="text-base font-medium text-gray-500">{label}</span>
      <div className="flex items-center gap-2">{children}</div>
    </div>
  );
}

export function SummaryRow({
  label,
  value,
  bold,
  className,
}: {
  label: string;
  value: string;
  bold?: boolean;
  className?: string;
}) {
  return (
    <div className="flex justify-between items-center">
      <span
        className={cn(
          "text-sm",
          bold ? "font-bold text-gray-900" : "text-gray-600",
          className,
        )}
      >
        {label}
      </span>
      <span
        className={cn(
          "text-sm font-medium",
          bold ? "font-bold text-gray-900" : "",
          className,
        )}
      >
        {value}
      </span>
    </div>
  );
}
