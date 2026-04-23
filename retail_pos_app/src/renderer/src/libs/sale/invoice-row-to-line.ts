// SaleInvoiceRow (서버 응답 shape) → SaleLineType (cart line shape) 변환.
//
// 용도: PaymentModalForRepay 가 usePaymentCal 훅을 재사용하려면 lines 가
// SaleLineType[] 여야 함. Repay 는 cart 편집을 허용하지 않고 "원본 rows 를
// 그대로 재결제" 하므로, 훅이 실제 읽는 필드 (`total`, `tax_amount`) 만
// 유효하면 되고, 나머지는 UI 렌더링과 타입 요구사항 충족용으로 채운다.

import type { SaleInvoiceRowItem } from "../../service/sale.service";
import type { SaleLineType } from "../../types/sales";
import type { ItemTypes } from "../item-utils";
import type { RowTypeWire } from "./payload.types";

// Wire row type (enum 식) → cart ItemTypes (slug 식) 변환.
const ROW_TYPE_TO_ITEM_TYPE: Record<RowTypeWire, ItemTypes> = {
  NORMAL: "normal",
  PREPACKED: "prepacked",
  WEIGHT: "weight",
  WEIGHT_PREPACKED: "weight-prepacked",
};

export function invoiceRowToLine(row: SaleInvoiceRowItem): SaleLineType {
  const ppMarkdown =
    row.ppMarkdownType != null && row.ppMarkdownAmount != null
      ? {
          discountType: row.ppMarkdownType,
          discountAmount: row.ppMarkdownAmount,
        }
      : null;

  return {
    // SaleLineItem fields
    type: ROW_TYPE_TO_ITEM_TYPE[row.type],
    itemId: row.itemId,
    name_en: row.name_en,
    name_ko: row.name_ko,
    // price / promoPrice 는 repay 에서 재평가하지 않음 — null.
    price: null,
    promoPrice: null,
    taxable: row.taxable,
    uom: row.uom,
    barcode: row.barcode,

    // SaleLineType fields
    // Repay 새 SALE 시점에서 이 line 은 refund 가 아님 — refund linkage null.
    original_invoice_id: null,
    original_invoice_row_id: null,
    // React key — row.id 기반으로 안정.
    lineKey: `repay-row-${row.id}`,
    index: row.index,
    unit_price_adjusted: row.unit_price_adjusted,
    unit_price_discounted: row.unit_price_discounted,
    unit_price_original: row.unit_price_original,
    unit_price_effective: row.unit_price_effective,
    qty: row.qty,
    measured_weight: row.measured_weight,
    total: row.total,
    tax_amount: row.tax_amount,
    net: row.net,
    adjustments: row.adjustments,
    ppMarkdown,
  };
}

export function invoiceRowsToLines(
  rows: SaleInvoiceRowItem[],
): SaleLineType[] {
  return rows.map(invoiceRowToLine);
}
