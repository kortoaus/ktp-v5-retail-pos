import React from "react";
import { cn } from "../../libs/cn";
import {
  FaArrowsDownToLine,
  FaArrowDown,
  FaArrowUp,
  FaArrowsUpToLine,
} from "react-icons/fa6";

export default function LinePaging({
  lineOffset,
  maxOffset,
  setLineOffset,
}: {
  lineOffset: number;
  maxOffset: number;
  setLineOffset: (offset: number) => void;
}) {
  return (
    <div className="w-[64px] bg-gray-100 h-full grid grid-rows-4 overflow-hidden divide-y divide-gray-200">
      <PageButton
        icon={<FaArrowsUpToLine />}
        disabled={lineOffset <= 0}
        onClick={() => {
          if (lineOffset <= 0) return;
          setLineOffset(0);
        }}
      />
      <PageButton
        icon={<FaArrowUp />}
        disabled={lineOffset <= 0}
        onClick={() => {
          if (lineOffset <= 0) return;
          setLineOffset(Math.max(0, lineOffset - 1));
        }}
      />

      <PageButton
        icon={<FaArrowDown />}
        disabled={lineOffset >= maxOffset}
        onClick={() => {
          if (lineOffset >= maxOffset) return;
          setLineOffset(Math.min(maxOffset, lineOffset + 1));
        }}
      />
      <PageButton
        icon={<FaArrowsDownToLine />}
        disabled={lineOffset >= maxOffset}
        onClick={() => {
          if (lineOffset >= maxOffset) return;
          setLineOffset(maxOffset);
        }}
      />
    </div>
  );
}

function PageButton({
  icon,
  onClick,
  disabled,
}: {
  icon: React.ReactNode;
  onClick: () => void;
  disabled: boolean;
}) {
  return (
    <div
      className={cn(
        "center bg-slate-500 text-white *:scale-150",
        disabled ? "opacity-50" : "",
      )}
      onClick={onClick}
    >
      {icon}
    </div>
  );
}
