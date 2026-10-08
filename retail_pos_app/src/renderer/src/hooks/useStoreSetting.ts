import { useCallback, useEffect, useSyncExternalStore } from "react";
import { StoreSetting } from "../types/models";
import { getStoreSetting } from "../service/store.service";
import { createStoreSettingCache } from "./store-setting-cache";

interface UseStoreSettingReturn {
  storeSetting: StoreSetting | null;
  loading: boolean;
  reload: () => Promise<void>;
}

// T-24 (R-17) — one shared cache for all consumers (store-setting-cache.ts).
const storeSettingCache = createStoreSettingCache<StoreSetting>(getStoreSetting);

// Call after saving the store setting and after a cloud Sync.
export function invalidateStoreSetting(): void {
  storeSettingCache.invalidate();
}

export function useStoreSetting(): UseStoreSettingReturn {
  const snapshot = useSyncExternalStore(
    storeSettingCache.subscribe,
    storeSettingCache.getSnapshot,
  );

  useEffect(() => {
    void storeSettingCache.ensure();
  }, []);

  const reload = useCallback(() => storeSettingCache.reload(), []);

  return { storeSetting: snapshot.value, loading: snapshot.loading, reload };
}
