import { Request, Response } from "express";
import {
  getValidCustomerVouchersService,
  issueCustomerVoucherService,
  normalizeCustomerVoucherIssueAmount,
} from "./customer-voucher.service";
import { listCustomerVoucherOperationsService } from "./customer-voucher.operations.query";
import { normalizeOperationId } from "../sale/sale.operation";

export async function getValidCustomerVouchersController(
  req: Request,
  res: Response,
) {
  const memberId = String(req.query.memberId || "");
  if (!memberId) {
    res
      .status(400)
      .json({ ok: false, msg: "memberId is required", result: null });
    return;
  }
  res.json(await getValidCustomerVouchersService(memberId));
}

export async function issueCustomerVoucherController(req: Request, res: Response) {
  const memberId = String(req.body?.memberId || "");
  if (!memberId) {
    res
      .status(400)
      .json({ ok: false, msg: "memberId is required", result: null });
    return;
  }
  // T-17 (V-5): optional; malformed → 400, absent → legacy (no CRM requestId).
  const operationId = normalizeOperationId(req.body?.operationId);
  // D-24: cents, one of 1000/2500/5000/10000; absent → 1000; else 400.
  const amount = normalizeCustomerVoucherIssueAmount(req.body?.amount);
  res.json(await issueCustomerVoucherService(memberId, operationId, amount));
}

export async function getCustomerVoucherOperationsController(
  req: Request,
  res: Response,
) {
  res.json(
    await listCustomerVoucherOperationsService(
      typeof req.query.status === "string" ? req.query.status : undefined,
    ),
  );
}
