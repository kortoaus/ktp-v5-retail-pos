// Invoice list tender summary — the Cash / Credit / Others columns of the
// invoice search list (components/SaleInvoiceSearchPanel), hoisted so the
// runner's Refund picker shows the same split (retail-runner T-16, S-4 §3 /
// A13). Pure: no React, DOM or HTTP client. Runner copies this file verbatim.

import type { SaleInvoiceListItem } from "./invoice.types";

// Same shape as libs/payment-colors PaymentCategoryAmounts (kept local so this
// module needs nothing else to be copied).
export interface InvoiceTenderSummary {
  cash: number;
  credit: number;
  others: number;
}

// Cents per category: CASH → cash, CREDIT → credit, everything else (gift
// card, vouchers) → others.
export function tenderSummary(
  inv: Pick<SaleInvoiceListItem, "payments">,
): InvoiceTenderSummary {
  return inv.payments.reduce(
    (summary, payment) => {
      if (payment.type === "CASH") summary.cash += payment.amount;
      else if (payment.type === "CREDIT") summary.credit += payment.amount;
      else summary.others += payment.amount;
      return summary;
    },
    { cash: 0, credit: 0, others: 0 },
  );
}
