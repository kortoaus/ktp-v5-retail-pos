import { Router } from "express";
import {
  getDailyVouchersController,
  issueDailyVoucherController,
} from "./voucher.controller";
import { scopeMiddleware, userMiddleware } from "../user/user.middleware";
import { withContext } from "../request-context";

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
  withContext(["storeSetting"]),
  issueDailyVoucherController,
);

export default voucherRouter;
