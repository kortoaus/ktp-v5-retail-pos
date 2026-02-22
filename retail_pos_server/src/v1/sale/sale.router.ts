import { Router } from "express";
import { createSaleInvoiceController } from "./sale.controller";
import { userMiddleware } from "../user/user.middleware";

const router = Router();

router.post("/invoice/create", createSaleInvoiceController);

export default router;
