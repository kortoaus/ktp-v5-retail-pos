import React, { useEffect, useState } from "react";
import { Hotkey } from "../types/models";
import { getHotkeys } from "../service/hotkey.service";

export default function useHotkeys() {
  const [hotkeys, setHotkeys] = useState<Hotkey[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        const res = await getHotkeys();
        if (res.ok && res.result) {
          setHotkeys(res.result);
        }
      } catch (e) {
        console.log(e);
        window.alert("Failed to load hotkeys");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, []);

  async function refreshHotkeys() {
    if (loading) return;
    setLoading(true);

    try {
      const res = await getHotkeys();
      if (res.ok && res.result) {
        setHotkeys(res.result);
      }
    } catch (e) {
      console.log(e);
      window.alert("Failed to load hotkeys");
    } finally {
      setLoading(false);
    }
  }

  return { hotkeys, hotkeysLoading: loading, refresh: refreshHotkeys };
}
