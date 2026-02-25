import { Router } from "express";
import {
  createSaleInvoiceController,
  getLatestTerminalInvoiceController,
  getRefundableSaleInvoiceByIdController,
  getSaleInvoiceByIdController,
  getSaleInvoicesController,
} from "./sale.controller";
import { userMiddleware } from "../user/user.middleware";

const router = Router();

router.post("/invoice/create", createSaleInvoiceController);
router.get("/invoice/latest", getLatestTerminalInvoiceController);
router.get("/invoices", userMiddleware, getSaleInvoicesController);
router.get("/invoice/:id", getSaleInvoiceByIdController);
router.get("/invoice/:id/refundable", getRefundableSaleInvoiceByIdController);

export default router;
