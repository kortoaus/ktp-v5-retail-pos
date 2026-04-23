// 원본 SaleInvoiceRow[] 를 read-only 로 표시. Repay 에서는 cart 편집이 없으므로
// PaymentModal 의 Lines 컬럼을 단순화한 버전.

import type { SaleInvoiceRowItem } from "../../service/sale.service";
import { MONEY_DP, MONEY_SCALE, QTY_SCALE } from "../../libs/constants";

const fmtMoney = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);

const fmtQty = (q: number) => {
  const v = q / QTY_SCALE;
  return Number.isInteger(v) ? String(v) : v.toFixed(3).replace(/\.?0+$/, "");
};

export default function RepayLineViewer({
  rows,
}: {
  rows: SaleInvoiceRowItem[];
}) {
  return (
    <div className="flex flex-col divide-y divide-gray-300 min-h-0">
      <div className="h-14 px-3 flex items-center font-medium">
        Lines ({rows.length})
      </div>
      <div className="flex-1 overflow-y-auto">
        {rows.map((r) => (
          <div
            key={r.id}
            className="flex items-start justify-between px-3 py-2 gap-2 border-b border-gray-100 last:border-b-0"
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium truncate text-sm">{r.name_en}</div>
              <div className="text-xs text-gray-500 truncate">{r.name_ko}</div>
            </div>
            <div className="text-right shrink-0 text-xs leading-tight">
              <div className="text-gray-500">
                ${fmtMoney(r.unit_price_effective)} × {fmtQty(r.qty)}
              </div>
              <div className="font-bold text-sm">= ${fmtMoney(r.total)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
