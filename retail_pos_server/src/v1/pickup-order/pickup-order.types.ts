export type PickupOrderStatus =
  | "PENDING"
  | "ORDER_CONFIRMED"
  | "READY"
  | "COMPLETED"
  | "CANCELLED_BY_STORE"
  | "CANCELLED_BY_CUSTOMER";

export type PickupOrderListSort =
  | "pickupStartsAtDesc"
  | "pickupStartsAtAsc";

export type CrmPickupOrderLineWire = {
  id: number;
  orderId: number;
  index: number;
  itemId: number;
  name_en: string;
  name_ko: string;
  barcode: string;
  code: string | null;
  uom: string;
  prices: number[];
  promoPrices: unknown;
  memberLevel: number;
  optionTotal: number;
  qty: number;
  total: number;
  note: string | null;
  selectedOptionsSnapshot: unknown;
  createdAt: string;
  updatedAt: string;
};

export type CrmPickupOrderWire = {
  id: number;
  companyId: number;
  documentId: string;
  status: PickupOrderStatus;
  memberId: string;
  memberName: string;
  memberLevel: number;
  memberPhoneLast4: string | null;
  pickupStartsAt: string;
  linesTotal: number;
  total: number;
  createdAt: string;
  updatedAt: string;
  lines: CrmPickupOrderLineWire[];
};

export type PickupOrderSyncCursor = {
  updatedAt: string;
  orderId: number;
};

export type PickupOrderSyncPage = {
  items: CrmPickupOrderWire[];
  nextCursor: PickupOrderSyncCursor | null;
  hasMore: boolean;
};

export type PickupOrderSyncOutcome = {
  pulled: number;
  inserted: number;
  updated: number;
  emittedNewOrderCount: number;
  cursorUpdatedAt: Date | null;
  cursorOrderId: number | null;
};

export type PickupOrderListQuery = {
  status?: PickupOrderStatus;
  statuses?: PickupOrderStatus[];
  from?: Date;
  to?: Date;
  keyword?: string;
  memberId?: string;
  sort: PickupOrderListSort;
  page: number;
  limit: number;
};
