import { Request, Response } from "express";
import {
  getUserVouchersByUserIdsService,
  issueDailyVoucherService,
} from "./user.voucher.service";
import { UnauthorizedException } from "../../libs/exceptions";

export async function getUserVouchersByUserIdsController(
  req: Request,
  res: Response,
) {
  const { userIds } = req.body;
  const result = await getUserVouchersByUserIdsService(userIds);
  res.status(200).json(result);
}

export async function issueDailyVoucherController(req: Request, res: Response) {
  const issuedBy = res.locals.user;
  if (!issuedBy) throw new UnauthorizedException("Unauthorized");
  const { userId } = req.body;
  const result = await issueDailyVoucherService(issuedBy, userId);
  res.status(200).json(result);
}
