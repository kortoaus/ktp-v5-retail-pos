import React from "react";
import { cn } from "../../libs/cn";
import { PagingType } from "../../libs/api";
import {
  FaArrowsDownToLine,
  FaArrowDown,
  FaArrowUp,
  FaArrowsUpToLine,
} from "react-icons/fa6";

type ServerPagingListProps<T> = {
  rows: T[];
  pageSize: number;
  paging: PagingType | null;
  onPageChange: (page: number) => void;
  Renderer: (props: { item: T; index: number }) => React.ReactNode;
};

export default function ServerPagingList<T>({
  rows,
  pageSize,
  paging,
  onPageChange,
  Renderer,
}: ServerPagingListProps<T>) {
  const currentPage = paging?.currentPage ?? 1;
  const totalPages = paging?.totalPages ?? 1;
  const hasPrev = paging?.hasPrev ?? false;
  const hasNext = paging?.hasNext ?? false;

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
          const item = rows[i];
          return (
            <div key={i}>
              {item != null &&
                Renderer({ item, index: (currentPage - 1) * pageSize + i })}
            </div>
          );
        })}
      </div>

      <div className="h-12 grid grid-cols-4 divide-x divide-gray-200 border-t border-gray-200">
        <PagingButton
          icon={<FaArrowsUpToLine />}
          disabled={!hasPrev}
          onPress={() => onPageChange(1)}
        />
        <PagingButton
          icon={<FaArrowUp />}
          disabled={!hasPrev}
          onPress={() => onPageChange(currentPage - 1)}
        />
        <PagingButton
          icon={<FaArrowDown />}
          disabled={!hasNext}
          onPress={() => onPageChange(currentPage + 1)}
        />
        <PagingButton
          icon={<FaArrowsDownToLine />}
          disabled={!hasNext}
          onPress={() => onPageChange(totalPages)}
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
