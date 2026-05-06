import { Request, Response } from "express";
import {
  getValidCustomerVouchersService,
  issueCustomerVoucherService,
} from "./customer-voucher.service";

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
  res.json(await issueCustomerVoucherService(memberId));
}
