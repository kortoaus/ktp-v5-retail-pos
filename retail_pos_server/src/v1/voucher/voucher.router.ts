import { Router } from "express";
import {
  getDailyVouchersController,
  issueDailyVoucherController,
} from "./voucher.controller";
import { scopeMiddleware, userMiddleware } from "../user/user.middleware";

const voucherRouter = Router();

voucherRouter.get(
  "/daily",
  userMiddleware,
  scopeMiddleware("sale"),
  getDailyVouchersController,
);

voucherRouter.post(
  "/daily/issue",
  userMiddleware,
  scopeMiddleware("sale"),
  issueDailyVoucherController,
);

export default voucherRouter;
