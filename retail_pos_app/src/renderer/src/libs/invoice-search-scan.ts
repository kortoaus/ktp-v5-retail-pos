export const RECEIPT_QR_PREFIX = "receipt%%%";
export const MEMBER_QR_PREFIX = "member%%%";

export type InvoiceSearchScan =
  | { type: "receipt"; serial: string }
  | { type: "member"; memberId: string }
  | { type: "keyword"; keyword: string };

export function parseInvoiceSearchScan(payload: string): InvoiceSearchScan {
  if (payload.startsWith(RECEIPT_QR_PREFIX)) {
    return {
      type: "receipt",
      serial: payload.slice(RECEIPT_QR_PREFIX.length),
    };
  }

  if (payload.startsWith(MEMBER_QR_PREFIX)) {
    return {
      type: "member",
      memberId: payload.slice(MEMBER_QR_PREFIX.length),
    };
  }

  return { type: "keyword", keyword: payload };
}
