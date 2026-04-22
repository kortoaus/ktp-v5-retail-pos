import { Request, Response } from "express";
import {
  getDailyVouchersService,
  issueDailyVoucherService,
} from "./voucher.service";

export async function getDailyVouchersController(
  _req: Request,
  res: Response,
) {
  const result = await getDailyVouchersService();
  res.json(result);
}

export async function issueDailyVoucherController(
  req: Request,
  res: Response,
) {
  const raw = req.body?.userId;
  const userId = typeof raw === "number" ? raw : parseInt(raw);
  if (!Number.isFinite(userId)) {
    res.status(400).json({ ok: false, msg: "Invalid userId" });
    return;
  }
  const result = await issueDailyVoucherService(
    userId,
    res.locals.storeSetting,
    res.locals.user,
  );
  res.json(result);
}
