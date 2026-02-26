import { useCallback, useEffect, useRef, useState } from "react";
import { StoreSetting } from "../types/models";
import { getStoreSetting } from "../service/store.service";

interface UseStoreSettingReturn {
  storeSetting: StoreSetting | null;
  loading: boolean;
  reload: () => Promise<void>;
}

export function useStoreSetting(): UseStoreSettingReturn {
  const [storeSetting, setStoreSetting] = useState<StoreSetting | null>(null);
  const [loading, setLoading] = useState(true);
  const mountedRef = useRef(true);

  const reload = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getStoreSetting();
      if (mountedRef.current && res.ok && res.result) {
        setStoreSetting(res.result);
      }
    } finally {
      if (mountedRef.current) {
        setLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    reload();
    return () => {
      mountedRef.current = false;
    };
  }, [reload]);

  return { storeSetting, loading, reload };
}
