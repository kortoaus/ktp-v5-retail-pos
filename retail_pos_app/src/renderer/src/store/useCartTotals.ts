import { Decimal } from "decimal.js";
import { useShallow } from "zustand/shallow";
import { useSalesStore } from "./salesStore";

export const useCartTotals = () => {
  return useSalesStore(
    useShallow((s) => {
      const cart = s.carts[s.activeCartIndex];
      const lines = cart.lines ?? [];

      const itemCount = [...new Set(lines.map((l) => l.itemId))].length;
      const lineCount = lines.length;
      const qtyCount = lines.reduce((acc, l) => {
        if (l.type === "weight" || l.type === "weight-prepacked") {
          return acc + 1;
        }
        return acc + l.qty;
      }, 0);

      const total = lines.reduce((acc, l) => {
        return acc.add(new Decimal(l.total));
      }, new Decimal(0));
      const tax_amount = lines.reduce((acc, l) => {
        return acc.add(new Decimal(l.tax_amount));
      }, new Decimal(0));
      const subtotal = lines.reduce((acc, l) => {
        return acc.add(new Decimal(l.subtotal));
      }, new Decimal(0));

      return {
        itemCount,
        lineCount,
        qtyCount,
        total: total.toNumber(),
        tax_amount: tax_amount.toNumber(),
        subtotal: subtotal.toNumber(),
        discounts: cart.discounts,
      };
    }),
  );
};
