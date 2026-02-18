import React from "react";

export default function Paging({
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
      <div
        className="center"
        onClick={() => {
          if (lineOffset <= 0) return;
          setLineOffset(0);
        }}
      >
        Top
      </div>
      <div
        className="center"
        onClick={() => {
          if (lineOffset <= 0) return;
          setLineOffset(Math.max(0, lineOffset - 1));
        }}
      >
        Up
      </div>
      <div
        className="center"
        onClick={() => {
          if (lineOffset >= maxOffset) return;
          setLineOffset(Math.min(maxOffset, lineOffset + 1));
        }}
      >
        Down
      </div>
      <div
        className="center"
        onClick={() => {
          if (lineOffset >= maxOffset) return;
          setLineOffset(maxOffset);
        }}
      >
        Bottom
      </div>
    </div>
  );
}
