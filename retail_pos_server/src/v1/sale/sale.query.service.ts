import db from "../../libs/db";
import {
  HttpException,
  InternalServerException,
  NotFoundException,
} from "../../libs/exceptions";
import { InvoiceType } from "../../generated/prisma/enums";

export interface FindManyQuery {
  page: number;
  limit: number;
  keyword?: string;
  from?: string; // ISO date string — createdAt lower bound
  to?: string; // ISO date string — createdAt upper bound
  memberId?: string;
  // 금액(total) 범위 — cents. 클라 측에서 dollars × 100 해서 전달.
  minTotal?: number;
  maxTotal?: number;
  type?: InvoiceType; // SALE | REFUND | SPEND. 없으면 전부.
}

// SaleInvoice 리스트 조회. keyword 는 공백으로 쪼개 AND 조합,
// 각 토큰은 serial / companyName / memberName / row(name_en/name_ko/barcode) OR.
// 날짜는 createdAt, 금액은 total 범위로 필터.
export async function getSaleInvoicesService(q: FindManyQuery) {
  try {
    const kws = (q.keyword || "")
      .split(" ")
      .map((k) => k.trim())
      .filter(Boolean);

    // Prisma generated WhereInput 타입 직접 import 대신 object literal 로
    // 구성 (generated path 변동성 회피). findMany 호출부에서 Prisma 가 타입 추론.
    const where: Record<string, unknown> = {};

    if (kws.length) {
      where.AND = kws.map((kw) => ({
        OR: [
          { serial: { contains: kw, mode: "insensitive" as const } },
          { companyName: { contains: kw, mode: "insensitive" as const } },
          { memberName: { contains: kw, mode: "insensitive" as const } },
          {
            rows: {
              some: {
                OR: [
                  { name_en: { contains: kw, mode: "insensitive" as const } },
                  { name_ko: { contains: kw, mode: "insensitive" as const } },
                  { barcode: { contains: kw, mode: "insensitive" as const } },
                ],
              },
            },
          },
        ],
      }));
    }

    if (q.from || q.to) {
      const range: Record<string, Date> = {};
      if (q.from) range.gte = new Date(q.from);
      if (q.to) range.lte = new Date(q.to);
      where.createdAt = range;
    }

    if (q.memberId) where.memberId = q.memberId;
    if (q.type) where.type = q.type;

    if (q.minTotal != null || q.maxTotal != null) {
      const range: Record<string, number> = {};
      if (q.minTotal != null) range.gte = q.minTotal;
      if (q.maxTotal != null) range.lte = q.maxTotal;
      where.total = range;
    }

    const totalCount = await db.saleInvoice.count({ where });
    const totalPages = Math.max(1, Math.ceil(totalCount / q.limit));
    const skip = (q.page - 1) * q.limit;

    const result = await db.saleInvoice.findMany({
      where,
      skip,
      take: q.limit,
      orderBy: { createdAt: "desc" },
      include: {
        rows: true,
        payments: true,
        terminal: true,
      },
    });

    return {
      ok: true,
      result,
      paging: {
        currentPage: q.page,
        totalPages,
        hasPrev: q.page > 1,
        hasNext: q.page < totalPages,
      },
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getSaleInvoicesService error:", e);
    throw new InternalServerException("Internal server error");
  }
}

// 단일 invoice 조회 — receipt reprint / refund 시작 지점.
// refunds (children REFUND invoices) 까지 include — refund UI 가
// per-tender / per-voucher-entity 남은 cap 을 client 에서 실시간 계산.
//
// ★ `refunds` 는 **REFUND type 만** 반환한다. Repay 로 생성되는 새 SALE 은
//   같은 originalInvoiceId 를 공유하므로, 명시적 type 필터 없이는
//   refund cap 계산/배너/drift 에 잘못 섞인다. 서버에서 source filter.
export async function getSaleInvoiceByIdService(id: number) {
  try {
    const invoice = await db.saleInvoice.findUnique({
      where: { id },
      include: {
        rows: { orderBy: { index: "asc" } },
        payments: true,
        terminal: true,
        refunds: {
          where: { type: "REFUND" },
          include: {
            rows: { orderBy: { index: "asc" } },
            payments: true,
          },
          orderBy: { createdAt: "asc" },
        },
      },
    });
    if (!invoice) throw new NotFoundException("Invoice not found");
    return { ok: true, result: invoice };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getSaleInvoiceByIdService error:", e);
    throw new InternalServerException("Internal server error");
  }
}

// 특정 invoice 의 **모든 children** — `originalInvoiceId = id` 인 invoice 들.
// Reprint 전용: parent + children 을 한 strip 에 출력하기 위함. Children 에는
//   - REFUND 자식 (일반 환불 + repay 의 refund)
//   - SALE 자식 (repay 로 생성된 새 SALE)
// 둘 다 포함 — "이 거래가 어떻게 완결됐는지" story 를 영수증에 보여주기 위해
// type 필터 없이 전부 반환. Refund cap 계산 등 다른 용도는 `refunds` (REFUND-
// filtered) 를 그대로 사용.
// Ordering: id ASC — repay tx 내부에서 refund 가 먼저, 새 SALE 이 다음 생성되어
// id 순서가 그대로 chronological.
export async function getSaleInvoiceChildrenService(parentId: number) {
  try {
    const children = await db.saleInvoice.findMany({
      where: { originalInvoiceId: parentId },
      include: {
        rows: { orderBy: { index: "asc" } },
        payments: true,
        terminal: true,
      },
      orderBy: { id: "asc" },
    });
    return { ok: true, result: children };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getSaleInvoiceChildrenService error:", e);
    throw new InternalServerException("Internal server error");
  }
}

// 해당 terminal 의 마지막 invoice — "Print Latest" 버튼용.
// 없으면 result: null (에러 아님). 모든 type (SALE/REFUND/SPEND) 대상.
export async function getLatestInvoiceForTerminalService(terminalId: number) {
  try {
    const invoice = await db.saleInvoice.findFirst({
      where: { terminalId },
      orderBy: { createdAt: "desc" },
      include: {
        rows: { orderBy: { index: "asc" } },
        payments: true,
        terminal: true,
      },
    });
    return { ok: true, result: invoice };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getLatestInvoiceForTerminalService error:", e);
    throw new InternalServerException("Internal server error");
  }
}
