export const PRINTED_HISTORY_ENTITY_PICKUP_ORDER = "PICKUP_ORDER" as const;
export const PRINTED_HISTORY_ENTITY_TYPES = [
  PRINTED_HISTORY_ENTITY_PICKUP_ORDER,
] as const;

export type PrintedHistoryEntityType =
  (typeof PRINTED_HISTORY_ENTITY_TYPES)[number];

export type PrintedHistoryBody = {
  entityType: PrintedHistoryEntityType;
  entityId: number;
};

export type PrintedHistoryQuery = {
  entityType: PrintedHistoryEntityType;
  entityIds: number[];
};

export type PrintedHistoryUser = {
  id: number;
  name: string;
};

export type PrintedHistorySummary = {
  entityId: number;
  printCount: number;
  lastPrintedAt: string;
  lastPrintedByUserId: number | null;
  lastPrintedByUserName: string | null;
};
