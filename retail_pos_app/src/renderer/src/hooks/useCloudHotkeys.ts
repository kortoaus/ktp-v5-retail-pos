import React, { useEffect, useState } from "react";
import { CloudHotkey, Hotkey } from "../types/models";
import { getHotkeys } from "../service/hotkey.service";
import { getCloudHotkeys } from "../service/cloudHotkey.service";

export default function useCloudHotkeys() {
  const [cloudHotkeys, setCloudHotkeys] = useState<CloudHotkey[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        const res = await getCloudHotkeys();
        if (res.ok && res.result) {
          setCloudHotkeys(res.result);
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

  async function refreshCloudHotkeys() {
    if (loading) return;
    setLoading(true);

    try {
      const res = await getCloudHotkeys();
      if (res.ok && res.result) {
        setCloudHotkeys(res.result);
      }
    } catch (e) {
      console.log(e);
      window.alert("Failed to load hotkeys");
    } finally {
      setLoading(false);
    }
  }

  return {
    cloudHotkeys,
    cloudHotkeysLoading: loading,
    refresh: refreshCloudHotkeys,
  };
}
