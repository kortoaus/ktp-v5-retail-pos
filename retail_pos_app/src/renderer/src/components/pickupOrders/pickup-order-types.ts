export const PICKUP_ORDER_STATUSES = [
  "PENDING",
  "ORDER_CONFIRMED",
  "READY",
  "COMPLETED",
  "CANCELLED_BY_STORE",
  "CANCELLED_BY_CUSTOMER",
] as const;

export type PickupOrderStatus = (typeof PICKUP_ORDER_STATUSES)[number];
export type PickupOrderStatusFilter = "ALL" | PickupOrderStatus;

export type PickupOrderSelectedOption = {
  key: string;
  name_en: string;
  name_ko: string;
  qty: number;
  priceDelta: number;
};

export type PickupOrderSelectedOptionGroup = {
  optionGroupId: number;
  key: string;
  name_en: string;
  name_ko: string;
  type: "SINGLE" | "MULTIPLE" | "QUANTITY";
  selectedOptions: PickupOrderSelectedOption[];
};

export type PickupOrderLine = {
  crmLineId: number;
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
  selectedOptionsSnapshot: PickupOrderSelectedOptionGroup[];
};

export type PickupOrderLineWire = Omit<
  PickupOrderLine,
  "selectedOptionsSnapshot"
> & {
  selectedOptionsSnapshot: unknown;
};

export type PickupOrderListItem = {
  crmOrderId: number;
  documentId: string;
  status: PickupOrderStatus;
  memberId: string;
  memberName: string;
  memberLevel: number;
  memberPhoneLast4: string | null;
  pickupStartsAt: string;
  linesTotal: number;
  total: number;
  crmCreatedAt: string;
  crmUpdatedAt: string;
  syncedAt: string;
  lines: PickupOrderLine[];
};

export type PickupOrderListItemWire = Omit<PickupOrderListItem, "lines"> & {
  lines: PickupOrderLineWire[];
};

export type PickupOrderDetail = PickupOrderListItem;
export type PickupOrderDetailWire = PickupOrderListItemWire;

export type PickupOrderListParams = {
  page?: number;
  limit?: number;
  keyword?: string;
  from?: string;
  to?: string;
  status?: PickupOrderStatus;
  memberId?: string;
};
