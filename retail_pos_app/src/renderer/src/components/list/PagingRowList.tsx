import React, { useMemo, useState } from "react";
import { cn } from "../../libs/cn";
import {
  FaArrowsDownToLine,
  FaArrowDown,
  FaArrowUp,
  FaArrowsUpToLine,
} from "react-icons/fa6";

type PagingRowListProps<T> = {
  rows: T[];
  pageSize: number;
  Renderer: (props: { item: T; index: number }) => React.ReactNode;
};

export default function PagingRowList<T>({
  rows,
  pageSize,
  Renderer,
}: PagingRowListProps<T>) {
  const [offset, setOffset] = useState(0);
  const maxOffset = Math.max(0, rows.length - pageSize);
  const visibleRows = useMemo(
    () => rows.slice(offset, offset + pageSize),
    [rows, offset, pageSize],
  );

  return (
    <div className="h-full flex flex-col">
      <div
        className="flex-1 overflow-hidden divide-y divide-gray-200"
        style={{
          display: "grid",
          gridTemplateRows: `repeat(${pageSize}, 1fr)`,
        }}
      >
        {Array.from({ length: pageSize }).map((_, i) => {
          const item = visibleRows[i];
          return (
            <div key={i}>
              {item != null && Renderer({ item, index: offset + i })}
            </div>
          );
        })}
      </div>

      <div className="h-12 grid grid-cols-4 divide-x divide-gray-200 border-t border-gray-200">
        <PagingButton
          icon={<FaArrowsUpToLine />}
          disabled={offset <= 0}
          onPress={() => setOffset(0)}
        />
        <PagingButton
          icon={<FaArrowUp />}
          disabled={offset <= 0}
          onPress={() => setOffset(Math.max(0, offset - 1))}
        />
        <PagingButton
          icon={<FaArrowDown />}
          disabled={offset >= maxOffset}
          onPress={() => setOffset(Math.min(maxOffset, offset + 1))}
        />
        <PagingButton
          icon={<FaArrowsDownToLine />}
          disabled={offset >= maxOffset}
          onPress={() => setOffset(maxOffset)}
        />
      </div>
    </div>
  );
}

function PagingButton({
  icon,
  disabled,
  onPress,
}: {
  icon: React.ReactNode;
  disabled: boolean;
  onPress: () => void;
}) {
  return (
    <div
      onPointerDown={disabled ? undefined : onPress}
      className={cn(
        "flex items-center justify-center bg-slate-500 text-white text-lg",
        disabled && "opacity-50",
      )}
    >
      {icon}
    </div>
  );
}
