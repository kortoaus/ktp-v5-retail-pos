export interface CustomerVoucherWire {
  id: number;
  memberId: string;
  serial: string;
  kind: "POINT_EXCHANGE" | "REFUND";
  initAmount: number;
  balance: number;
  status: "ACTIVE" | "EXPIRED" | "ARCHIVED";
  validFrom: string;
  validTo: string;
  label: string;
}

export interface CustomerVoucherRedeemRequest {
  memberId: string;
  voucherId: number;
  amount: number;
  requestId: string;
  entityType: string;
  entityId: string;
  entitySerial?: string | null;
  note?: string | null;
}

export interface CustomerVoucherRefundIssueRequest {
  memberId: string;
  amount: number;
  entityType: string;
  entityId: string;
  entitySerial?: string | null;
  note?: string | null;
}

export interface CustomerVoucherRedeemResult {
  requestId: string;
  voucherId: number;
  amount: number;
}
