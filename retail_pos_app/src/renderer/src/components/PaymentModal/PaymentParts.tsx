import { cn } from "../../libs/cn";

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
        "rounded-xl p-4 flex flex-col gap-1 cursor-pointer transition-colors border-2",
        active ? "border-blue-500 bg-blue-50" : "border-gray-200 bg-white",
      )}
    >
      <span className="text-xs font-medium text-gray-500 uppercase tracking-wide">
        {label}
      </span>
      {children}
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
    <div
      className={cn(
        "flex justify-between items-center",
        bold ? "text-lg font-bold" : "text-sm",
        className,
      )}
    >
      <span>{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  );
}
