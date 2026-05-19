export type PaymentColorCategory = "cash" | "credit" | "others";

export interface PaymentCategoryAmounts {
  cash: number;
  credit: number;
  others: number;
}

export const PAYMENT_CATEGORY_CLASSES: Record<
  PaymentColorCategory,
  {
    text: string;
    strongText: string;
    rowBorder: string;
    button: string;
  }
> = {
  cash: {
    text: "text-emerald-700",
    strongText: "text-emerald-700 font-bold",
    rowBorder: "border-l-emerald-500",
    button: "bg-emerald-600 text-white active:bg-emerald-700",
  },
  credit: {
    text: "text-blue-700",
    strongText: "text-blue-700 font-bold",
    rowBorder: "border-l-blue-500",
    button: "bg-blue-600 text-white active:bg-blue-700",
  },
  others: {
    text: "text-amber-700",
    strongText: "text-amber-700 font-bold",
    rowBorder: "border-l-amber-500",
    button: "bg-amber-500 text-white active:bg-amber-600",
  },
};

export function getDominantPaymentCategory(
  amounts: PaymentCategoryAmounts,
): PaymentColorCategory | null {
  const cash = Math.max(0, amounts.cash);
  const credit = Math.max(0, amounts.credit);
  const others = Math.max(0, amounts.others);
  const max = Math.max(cash, credit, others);

  if (max <= 0) return null;

  if (credit === max) return "credit";
  if (cash === max) return "cash";
  return "others";
}
