import { CF_URL } from "../../libs/cf-image-utils";
import type { RecentItemEntry } from "../../libs/scale-recent-items";

export default function RecentItemsRow({ items, onPick }: {
  items: RecentItemEntry[];
  onPick: (itemId: number) => void;
}) {
  if (items.length === 0) return null;
  return (
    <div className="shrink-0 pt-2 pb-1">
      <div className="px-3 text-xs font-bold uppercase text-gray-400">Recent</div>
      <div className="flex gap-2 overflow-x-auto px-3 py-1">
        {items.map((item) => (
          <div
            key={item.id}
            role="button"
            onClick={() => onPick(item.id)}
            className="shrink-0 flex items-center gap-2 h-14 w-56 px-2 rounded-lg border border-gray-200 bg-white cursor-pointer select-none active:bg-blue-50"
          >
            {item.thumb ? (
              <img src={CF_URL(item.thumb, "thumb")} alt="" className="h-10 w-10 shrink-0 rounded-lg object-cover" />
            ) : (
              <div className="h-10 w-10 shrink-0 rounded-lg bg-gray-100" />
            )}
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{item.name_en}</div>
              <div className="text-xs text-gray-400">Item #{item.id}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
