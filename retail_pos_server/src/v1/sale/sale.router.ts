import { Router } from "express";
import {
  createSaleInvoiceController,
  getLatestTerminalInvoiceController,
  getRefundableSaleInvoiceByIdController,
  getSaleInvoiceByIdController,
  getSaleInvoiceWithChildrenController,
  getSaleInvoicesController,
} from "./sale.controller";
import { createRefundInvoiceController } from "./sale.refund.controller";
import { scopeMiddleware, userMiddleware } from "../user/user.middleware";

const router = Router();

router.post("/invoice/create", createSaleInvoiceController);
router.get("/invoice/latest", getLatestTerminalInvoiceController);
router.get("/invoices", userMiddleware, getSaleInvoicesController);
router.get("/invoice/:id", getSaleInvoiceByIdController);
router.get("/invoice/:id/refundable", getRefundableSaleInvoiceByIdController);
router.post(
  "/refund",
  userMiddleware,
  scopeMiddleware("refund"),
  createRefundInvoiceController,
);
router.get("/invoice/:id/with-children", getSaleInvoiceWithChildrenController);

export default router;
