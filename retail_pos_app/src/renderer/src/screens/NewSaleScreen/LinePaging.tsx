import { FaArrowUp, FaArrowDown } from "react-icons/fa6";
import { cn } from "../../libs/cn";

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
    <div className="w-10 h-full grid grid-rows-2 divide-y divide-gray-200">
      <div
        onPointerDown={() => {
          if (lineOffset > 0) setLineOffset(lineOffset - 1);
        }}
        className={cn(
          "flex items-center justify-center bg-slate-500 text-white text-xl",
          lineOffset <= 0 && "opacity-50",
        )}
      >
        <FaArrowUp />
      </div>
      <div
        onPointerDown={() => {
          if (lineOffset < maxOffset) setLineOffset(lineOffset + 1);
        }}
        className={cn(
          "flex items-center justify-center bg-slate-500 text-white text-xl",
          lineOffset >= maxOffset && "opacity-50",
        )}
      >
        <FaArrowDown />
      </div>
    </div>
  );
}
