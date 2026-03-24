import { useMemo } from "react";
import { useNewSalesStore } from "../store/newSalesStore";
import { applyPromotions } from "../store/newSalesStore.helper";
import { SaleStoreDiscount } from "../types/sales";

export default function useCartDiscounts(): SaleStoreDiscount[] {
  const lines = useNewSalesStore(
    (s) => s.carts[s.activeCartIndex]?.lines ?? [],
  );
  const promotions = useNewSalesStore((s) => s.promotions);

  return useMemo(
    () => applyPromotions(lines, promotions),
    [lines, promotions],
  );
}
