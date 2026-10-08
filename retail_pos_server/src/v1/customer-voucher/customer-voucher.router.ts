import { Router } from "express";
import { scopeMiddleware, userMiddleware } from "../user/user.middleware";
import {
  getCustomerVoucherOperationsController,
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

// T-15 — local customer-voucher operation ledger, e.g.
// ?status=UNRESOLVED,CONFIRMED (default INTENT,CONFIRMED,UNRESOLVED).
customerVoucherRouter.get(
  "/operations",
  userMiddleware,
  scopeMiddleware("sale"),
  getCustomerVoucherOperationsController,
);

export default customerVoucherRouter;
