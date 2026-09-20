// Display snapshots only. Selecting an entry re-fetches the item for weighing.
export type RecentItemEntry = {
  id: number;
  name_en: string;
  name_ko: string;
  thumb: string | null;
};

export const RECENT_ITEMS_CAP = 12;

export function recentItemsStorageKey(server: string, terminalId: number): string {
  return `retail-pos/scale-recent-items/${encodeURIComponent(server)}/${terminalId}`;
}

export function pushRecent(
  list: readonly RecentItemEntry[],
  entry: RecentItemEntry,
  cap: number = RECENT_ITEMS_CAP,
): RecentItemEntry[] {
  return [entry, ...list.filter((item) => item.id !== entry.id)].slice(0, cap);
}

function isEntry(value: unknown): value is RecentItemEntry {
  if (typeof value !== "object" || value === null) return false;
  const entry = value as Record<string, unknown>;
  return (
    typeof entry.id === "number" && Number.isInteger(entry.id) &&
    typeof entry.name_en === "string" && typeof entry.name_ko === "string" &&
    (entry.thumb === null || typeof entry.thumb === "string")
  );
}

export function parseRecentItems(raw: string | null): RecentItemEntry[] {
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    const seen = new Set<number>();
    const items: RecentItemEntry[] = [];
    for (const entry of parsed) {
      if (!isEntry(entry) || seen.has(entry.id)) continue;
      seen.add(entry.id);
      items.push({ id: entry.id, name_en: entry.name_en, name_ko: entry.name_ko, thumb: entry.thumb });
      if (items.length >= RECENT_ITEMS_CAP) break;
    }
    return items;
  } catch {
    return [];
  }
}

export function serializeRecentItems(list: readonly RecentItemEntry[]): string {
  return JSON.stringify(list);
}
