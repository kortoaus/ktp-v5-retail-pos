import apiService, { ApiResponse } from "../libs/api";
import { OnPaymentPayload } from "../types/models";
import { SaleLineType } from "../types/sales";

type InvoiceRowPayload = {
  type: string;
  itemId: number;
  name_en: string;
  name_ko: string;
  taxable: boolean;
  uom: string;
  barcode: string;
  index: number;
  barcodePrice: number | null;
  unit_price_original: number;
  unit_price_discounted: number | null;
  unit_price_adjusted: number | null;
  unit_price_effective: number;
  qty: number;
  measured_weight: number | null;
  subtotal: number;
  total: number;
  original_invoice_id: number | null;
  original_invoice_row_id: number | null;
  adjustments: string[];
};

function sanitizeRow(line: SaleLineType): InvoiceRowPayload {
  return {
    type: line.type,
    itemId: line.itemId,
    name_en: line.name_en,
    name_ko: line.name_ko,
    taxable: line.taxable,
    uom: line.uom,
    barcode: line.barcode,
    index: line.index,
    barcodePrice: line.barcode_price,
    unit_price_original: line.unit_price_original,
    unit_price_discounted: line.unit_price_discounted,
    unit_price_adjusted: line.unit_price_adjusted,
    unit_price_effective: line.unit_price_effective,
    qty: line.qty,
    measured_weight: line.measured_weight,
    subtotal: line.subtotal,
    total: line.total,
    original_invoice_id: line.original_invoice_id,
    original_invoice_row_id: line.original_invoice_row_id,
    adjustments: line.adjustments,
  };
}

export async function createSaleInvoice(
  payload: OnPaymentPayload,
  lines: SaleLineType[],
  memberId: number | null,
  memberLevel: number | null,
): Promise<ApiResponse<{ id: number }>> {
  return apiService.post<{ id: number }>("/api/sale/invoice/create", {
    ...payload,
    memberId,
    memberLevel,
    rows: lines.map(sanitizeRow),
  });
}
