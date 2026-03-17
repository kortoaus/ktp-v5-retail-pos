import { useEffect, useState } from "react";
import { getAvailablePromotions } from "../service/promotion.service";
import { useSalesStore } from "../store/salesStore";

export default function usePromotions() {
  const setPromotions = useSalesStore((s) => s.setPromotions);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const init = async () => {
      try {
        const res = await getAvailablePromotions();
        if (res.ok && res.result) {
          setPromotions(res.result);
        }
      } catch (e) {
        console.log(e);
        window.alert("Failed to load promotions");
      } finally {
        setLoading(false);
      }
    };
    init();
  }, [setPromotions]);

  async function refreshPromotions() {
    if (loading) return;
    setLoading(true);

    try {
      const res = await getAvailablePromotions();
      if (res.ok && res.result) {
        setPromotions(res.result);
      }
    } catch (e) {
      console.log(e);
      window.alert("Failed to load promotions");
    } finally {
      setLoading(false);
    }
  }

  return { promotionsLoading: loading, refresh: refreshPromotions };
}
