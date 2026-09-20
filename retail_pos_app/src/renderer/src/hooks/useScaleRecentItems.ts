import { useCallback, useState } from "react";
import {
  parseRecentItems, pushRecent, serializeRecentItems,
  type RecentItemEntry,
} from "../libs/scale-recent-items";

/** The station is keyed by terminal, so this cache cannot cross terminals. */
export function useScaleRecentItems(storageKey: string) {
  const [recentItems, setRecentItems] = useState(() => {
    try {
      return parseRecentItems(localStorage.getItem(storageKey));
    } catch {
      return [];
    }
  });

  const record = useCallback((item: RecentItemEntry) => {
    setRecentItems((previous) => {
      const next = pushRecent(previous, {
        id: item.id, name_en: item.name_en, name_ko: item.name_ko, thumb: item.thumb,
      });
      try {
        localStorage.setItem(storageKey, serializeRecentItems(next));
      } catch {
        // A full or unavailable cache must not block weighing.
      }
      return next;
    });
  }, [storageKey]);

  return { recentItems, record };
}
