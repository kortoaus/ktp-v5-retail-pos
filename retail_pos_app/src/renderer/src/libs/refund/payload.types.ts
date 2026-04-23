// Client-side mirror of server's RefundCreatePayload (retail_pos_server
// src/v1/sale/sale.types.ts). Keep in sync manually.

import type { PaymentTypeWire } from "../sale/payload.types";

export interface RefundRowPayload {
  originalInvoiceRowId: number;
  refund_qty: number; // ×1000 (QTY_SCALE)
}

export interface RefundPaymentPayload {
  type: PaymentTypeWire;
  amount: number; // cents
  entityType?: "user-voucher" | "customer-voucher";
  entityId?: number;
  entityLabel?: string;
}

export interface RefundCreatePayload {
  originalInvoiceId: number;
  rows: RefundRowPayload[];
  payments: RefundPaymentPayload[];
  note?: string;
}
