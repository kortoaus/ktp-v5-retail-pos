import React, { useCallback } from "react";

interface KeyboardKeyProps {
  label: string;
  value: string;
  width?: number;
  variant?: "default" | "action" | "space";
  active?: boolean;
  onPress: (value: string) => void;
}

const VARIANT_STYLES = {
  default: "bg-white active:bg-gray-200",
  action: "bg-gray-300 active:bg-gray-400 text-sm font-semibold",
  space: "bg-white active:bg-gray-200",
} as const;

export const KeyboardKey = React.memo(function KeyboardKey({
  label,
  value,
  width = 1,
  variant = "default",
  active = false,
  onPress,
}: KeyboardKeyProps) {
  const handlePointerDown = useCallback(
    (e: React.PointerEvent) => {
      e.preventDefault();
      onPress(value);
    },
    [value, onPress],
  );

  return (
    <button
      type="button"
      onPointerDown={handlePointerDown}
      className={`
        select-none rounded-lg shadow-sm border border-gray-300
        flex items-center justify-center
        min-h-[48px] text-lg
        transition-colors duration-75
        ${VARIANT_STYLES[variant]}
        ${active ? "!bg-blue-200 !border-blue-400" : ""}
      `}
      style={{ flex: width }}
    >
      {label}
    </button>
  );
});
