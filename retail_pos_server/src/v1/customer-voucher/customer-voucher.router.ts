import { Router } from "express";
import { scopeMiddleware, userMiddleware } from "../user/user.middleware";
import {
  getValidCustomerVouchersController,
  issueCustomerVoucherController,
} from "./customer-voucher.controller";

const customerVoucherRouter = Router();

customerVoucherRouter.get(
  "/valid",
  userMiddleware,
  scopeMiddleware("sale"),
  getValidCustomerVouchersController,
);

customerVoucherRouter.post(
  "/issue",
  userMiddleware,
  scopeMiddleware("sale"),
  issueCustomerVoucherController,
);

export default customerVoucherRouter;
