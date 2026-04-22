import { Request, Response } from "express";
import { BadRequestException } from "../../libs/exceptions";
import { createSaleService } from "./sale.create.service";
import { createSpendService } from "./spend.create.service";
import {
  FindManyQuery,
  getLatestInvoiceForTerminalService,
  getSaleInvoiceByIdService,
  getSaleInvoicesService,
} from "./sale.query.service";
import { SaleCreatePayload } from "./sale.types";
import { InvoiceType } from "../../generated/prisma/enums";

export async function createSaleController(req: Request, res: Response) {
  // Context — terminalMiddleware + userMiddleware 가 세팅한 res.locals 에서 추출.
  // Open shift 없으면 sale 생성 불가.
  const { terminal, storeSetting, shift, user } = res.locals;
  if (!shift) {
    throw new BadRequestException("No open shift — sale cannot be created");
  }

  const payload = req.body as SaleCreatePayload;
  const result = await createSaleService(payload, {
    terminal,
    storeSetting,
    user,
    shift,
  });
  res.json(result);
}

export async function createSpendController(req: Request, res: Response) {
  const { terminal, storeSetting, shift, user } = res.locals;
  if (!shift) {
    throw new BadRequestException("No open shift — spend cannot be created");
  }

  const payload = req.body as SaleCreatePayload;
  const result = await createSpendService(payload, {
    terminal,
    storeSetting,
    user,
    shift,
  });
  res.json(result);
}

// ──────────────────────────────────────────────────────────────
// Query helpers — req.query 는 전부 string. 숫자/enum 안전 파싱.
// ──────────────────────────────────────────────────────────────
function parseIntOr(v: unknown, fallback: number): number {
  if (v == null) return fallback;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : fallback;
}
function parseOptInt(v: unknown): number | undefined {
  if (v == null) return undefined;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : undefined;
}
function parseOptStr(v: unknown): string | undefined {
  if (v == null) return undefined;
  const s = String(v).trim();
  return s.length ? s : undefined;
}

const VALID_INVOICE_TYPES: InvoiceType[] = ["SALE", "REFUND", "SPEND"];
function parseInvoiceType(v: unknown): InvoiceType | undefined {
  const s = parseOptStr(v);
  if (!s) return undefined;
  const upper = s.toUpperCase() as InvoiceType;
  return VALID_INVOICE_TYPES.includes(upper) ? upper : undefined;
}

export async function getSaleInvoicesController(req: Request, res: Response) {
  const q: FindManyQuery = {
    page: Math.max(1, parseIntOr(req.query.page, 1)),
    limit: Math.min(200, Math.max(1, parseIntOr(req.query.limit, 20))),
    keyword: parseOptStr(req.query.keyword),
    from: parseOptStr(req.query.from),
    to: parseOptStr(req.query.to),
    memberId: parseOptStr(req.query.memberId),
    minTotal: parseOptInt(req.query.minTotal), // cents
    maxTotal: parseOptInt(req.query.maxTotal), // cents
    type: parseInvoiceType(req.query.type),
  };
  const result = await getSaleInvoicesService(q);
  res.json(result);
}

export async function getSaleInvoiceByIdController(
  req: Request,
  res: Response,
) {
  const id = parseInt(String(req.params.id), 10);
  if (!Number.isFinite(id)) {
    res.status(400).json({ ok: false, msg: "Invalid invoice id" });
    return;
  }
  const result = await getSaleInvoiceByIdService(id);
  res.json(result);
}

export async function getLatestInvoiceController(
  _req: Request,
  res: Response,
) {
  const { terminal } = res.locals;
  if (!terminal) {
    res.status(400).json({ ok: false, msg: "Terminal context missing" });
    return;
  }
  const result = await getLatestInvoiceForTerminalService(terminal.id);
  res.json(result);
}
