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
    // member%%%<id>[%%%<level>...] — level 세그먼트(libs/member-qr.ts 참조)는 버린다
    return {
      type: "member",
      memberId: payload.slice(MEMBER_QR_PREFIX.length).split("%%%")[0],
    };
  }

  return { type: "keyword", keyword: payload };
}
