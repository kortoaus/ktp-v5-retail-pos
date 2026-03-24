import { useEffect, useState } from "react";
import { getAvailablePromotions } from "../service/promotion.service";
import { useNewSalesStore } from "../store/newSalesStore";

export default function useNewPromotions() {
  const setPromotions = useNewSalesStore((s) => s.setPromotions);
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

  return { promotionsLoading: loading };
}
