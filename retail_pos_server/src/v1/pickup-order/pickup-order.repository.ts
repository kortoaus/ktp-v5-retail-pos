import { Prisma } from "../../generated/prisma/client";
import db from "../../libs/db";
import { BadRequestException, NotFoundException } from "../../libs/exceptions";
import type {
  CrmPickupOrderWire,
  PickupOrderListQuery,
  PickupOrderStatus,
} from "./pickup-order.types";

const validStatuses = new Set<PickupOrderStatus>([
  "PENDING",
  "ORDER_CONFIRMED",
  "READY",
  "COMPLETED",
  "CANCELLED_BY_STORE",
  "CANCELLED_BY_CUSTOMER",
]);

const positiveIntegerPattern = /^[1-9]\d*$/;

function first(value: unknown): unknown {
  return Array.isArray(value) ? value[0] : value;
}

function parsePositiveInt(value: unknown, fieldName: string): number {
  if (typeof value === "number" && Number.isInteger(value) && value > 0) {
    return value;
  }
  if (typeof value === "string" && positiveIntegerPattern.test(value)) {
    return Number(value);
  }
  throw new BadRequestException(`${fieldName} must be a positive integer`);
}

function parseOptionalDate(value: unknown, fieldName: string): Date | undefined {
  const raw = first(value);
  if (raw === undefined || raw === "") return undefined;
  if (typeof raw !== "string") {
    throw new BadRequestException(`${fieldName} must be a valid date`);
  }
  const parsed = new Date(raw);
  if (!Number.isFinite(parsed.getTime())) {
    throw new BadRequestException(`${fieldName} must be a valid date`);
  }
  return parsed;
}

export function parsePickupOrderListQuery(
  query: Record<string, unknown>,
): PickupOrderListQuery {
  const rawStatus = first(query.status);
  const rawKeyword = first(query.keyword);
  const rawMemberId = first(query.memberId);
  const page = parsePositiveInt(first(query.page) ?? "1", "page");
  const limit = parsePositiveInt(first(query.limit) ?? "20", "limit");

  if (limit > 100) {
    throw new BadRequestException("limit must be between 1 and 100");
  }
  if (rawStatus !== undefined && rawStatus !== "") {
    if (
      typeof rawStatus !== "string" ||
      !validStatuses.has(rawStatus as PickupOrderStatus)
    ) {
      throw new BadRequestException(
        "status must be a valid pickup order status",
      );
    }
  }
  if (rawKeyword !== undefined && typeof rawKeyword !== "string") {
    throw new BadRequestException("keyword must be a string");
  }
  if (rawMemberId !== undefined && typeof rawMemberId !== "string") {
    throw new BadRequestException("memberId must be a string");
  }

  const keyword = typeof rawKeyword === "string" ? rawKeyword.trim() : "";
  const memberId = typeof rawMemberId === "string" ? rawMemberId.trim() : "";
  return {
    ...(rawStatus ? { status: rawStatus as PickupOrderStatus } : {}),
    from: parseOptionalDate(query.from, "from"),
    to: parseOptionalDate(query.to, "to"),
    ...(keyword ? { keyword } : {}),
    ...(memberId ? { memberId } : {}),
    page,
    limit,
  };
}

export function buildPickupOrderKeywordWhere(
  keyword: string | undefined,
): Prisma.PickupOrderCacheWhereInput {
  if (!keyword) return {};
  return {
    OR: [
      { documentId: { contains: keyword, mode: "insensitive" } },
      { memberName: { contains: keyword, mode: "insensitive" } },
      {
        lines: {
          some: {
            OR: [
              { name_en: { contains: keyword, mode: "insensitive" } },
              { name_ko: { contains: keyword, mode: "insensitive" } },
              { barcode: { contains: keyword, mode: "insensitive" } },
              { code: { contains: keyword, mode: "insensitive" } },
            ],
          },
        },
      },
    ],
  };
}

function buildDateWhere(
  query: PickupOrderListQuery,
): Prisma.PickupOrderCacheWhereInput {
  const pickupStartsAt: Prisma.DateTimeFilter = {};
  if (query.from) pickupStartsAt.gte = query.from;
  if (query.to) pickupStartsAt.lte = query.to;
  return Object.keys(pickupStartsAt).length > 0 ? { pickupStartsAt } : {};
}

export function buildPickupOrderListWhere(
  query: PickupOrderListQuery,
): Prisma.PickupOrderCacheWhereInput {
  return {
    ...(query.status ? { status: query.status } : {}),
    ...(query.memberId ? { memberId: query.memberId } : {}),
    ...buildDateWhere(query),
    ...buildPickupOrderKeywordWhere(query.keyword),
  };
}

export function buildPickupOrderPaging(input: {
  page: number;
  limit: number;
  totalCount: number;
}) {
  const totalPages = Math.max(1, Math.ceil(input.totalCount / input.limit));
  return {
    hasPrev: input.page > 1,
    hasNext: input.page < totalPages,
    currentPage: input.page,
    totalPages,
  };
}

function toPrismaJson(value: unknown): Prisma.InputJsonValue {
  return value as Prisma.InputJsonValue;
}

export async function getPickupOrderSyncState() {
  return db.pickupOrderSyncState.upsert({
    where: { key: "pickup-order" },
    create: { key: "pickup-order" },
    update: {},
  });
}

export async function markPickupOrderSyncSuccess(input: {
  cursorUpdatedAt: Date | null;
  cursorOrderId: number | null;
}) {
  const now = new Date();
  return db.pickupOrderSyncState.upsert({
    where: { key: "pickup-order" },
    create: {
      key: "pickup-order",
      cursorUpdatedAt: input.cursorUpdatedAt,
      cursorOrderId: input.cursorOrderId,
      lastSyncedAt: now,
      lastSuccessAt: now,
      lastErrorAt: null,
      lastErrorMsg: null,
    },
    update: {
      cursorUpdatedAt: input.cursorUpdatedAt,
      cursorOrderId: input.cursorOrderId,
      lastSyncedAt: now,
      lastSuccessAt: now,
      lastErrorAt: null,
      lastErrorMsg: null,
    },
  });
}

export async function markPickupOrderSyncFailure(error: unknown) {
  const now = new Date();
  const message = error instanceof Error ? error.message : String(error);
  return db.pickupOrderSyncState.upsert({
    where: { key: "pickup-order" },
    create: {
      key: "pickup-order",
      lastSyncedAt: now,
      lastErrorAt: now,
      lastErrorMsg: message.slice(0, 1000),
    },
    update: {
      lastSyncedAt: now,
      lastErrorAt: now,
      lastErrorMsg: message.slice(0, 1000),
    },
  });
}

export async function findExistingPickupOrderIds(crmOrderIds: number[]) {
  if (crmOrderIds.length === 0) return new Set<number>();
  const rows = await db.pickupOrderCache.findMany({
    where: { crmOrderId: { in: crmOrderIds } },
    select: { crmOrderId: true },
  });
  return new Set(rows.map((row) => row.crmOrderId));
}

export async function upsertPickupOrderPage(items: CrmPickupOrderWire[]) {
  return db.$transaction(async (tx) => {
    for (const item of items) {
      await tx.pickupOrderCache.upsert({
        where: { crmOrderId: item.id },
        create: {
          crmOrderId: item.id,
          companyId: item.companyId,
          documentId: item.documentId,
          status: item.status,
          memberId: item.memberId,
          memberName: item.memberName,
          memberLevel: item.memberLevel,
          memberPhoneLast4: item.memberPhoneLast4,
          pickupStartsAt: new Date(item.pickupStartsAt),
          linesTotal: item.linesTotal,
          total: item.total,
          crmCreatedAt: new Date(item.createdAt),
          crmUpdatedAt: new Date(item.updatedAt),
          syncedAt: new Date(),
        },
        update: {
          documentId: item.documentId,
          status: item.status,
          memberId: item.memberId,
          memberName: item.memberName,
          memberLevel: item.memberLevel,
          memberPhoneLast4: item.memberPhoneLast4,
          pickupStartsAt: new Date(item.pickupStartsAt),
          linesTotal: item.linesTotal,
          total: item.total,
          crmUpdatedAt: new Date(item.updatedAt),
          syncedAt: new Date(),
        },
      });

      for (const line of item.lines) {
        const promoPrices =
          line.promoPrices === null
            ? Prisma.JsonNull
            : toPrismaJson(line.promoPrices);

        await tx.pickupOrderLineCache.upsert({
          where: { crmLineId: line.id },
          create: {
            crmLineId: line.id,
            crmOrderId: item.id,
            index: line.index,
            itemId: line.itemId,
            name_en: line.name_en,
            name_ko: line.name_ko,
            barcode: line.barcode,
            code: line.code,
            uom: line.uom,
            prices: line.prices,
            promoPrices,
            memberLevel: line.memberLevel,
            optionTotal: line.optionTotal,
            qty: line.qty,
            total: line.total,
            note: line.note,
            selectedOptionsSnapshot: toPrismaJson(
              line.selectedOptionsSnapshot,
            ),
            crmCreatedAt: new Date(line.createdAt),
            crmUpdatedAt: new Date(line.updatedAt),
            syncedAt: new Date(),
          },
          update: {
            index: line.index,
            itemId: line.itemId,
            name_en: line.name_en,
            name_ko: line.name_ko,
            barcode: line.barcode,
            code: line.code,
            uom: line.uom,
            prices: line.prices,
            promoPrices,
            memberLevel: line.memberLevel,
            optionTotal: line.optionTotal,
            qty: line.qty,
            total: line.total,
            note: line.note,
            selectedOptionsSnapshot: toPrismaJson(
              line.selectedOptionsSnapshot,
            ),
            crmUpdatedAt: new Date(line.updatedAt),
            syncedAt: new Date(),
          },
        });
      }
    }
  });
}

export async function listCachedPickupOrders(query: PickupOrderListQuery) {
  const where = buildPickupOrderListWhere(query);

  const [rows, totalCount] = await db.$transaction([
    db.pickupOrderCache.findMany({
      where,
      orderBy: [{ pickupStartsAt: "asc" }, { crmOrderId: "asc" }],
      skip: (query.page - 1) * query.limit,
      take: query.limit,
      include: {
        lines: {
          orderBy: { index: "asc" },
          take: 1,
        },
      },
    }),
    db.pickupOrderCache.count({ where }),
  ]);

  return {
    ok: true,
    msg: "Pickup orders loaded",
    result: rows,
    paging: buildPickupOrderPaging({
      page: query.page,
      limit: query.limit,
      totalCount,
    }),
  };
}

export async function getCachedPickupOrderByCrmId(crmOrderId: number) {
  const row = await db.pickupOrderCache.findUnique({
    where: { crmOrderId },
    include: { lines: { orderBy: { index: "asc" } } },
  });
  if (!row) throw new NotFoundException("Pickup order not found");
  return { ok: true, msg: "Pickup order loaded", result: row, paging: null };
}
