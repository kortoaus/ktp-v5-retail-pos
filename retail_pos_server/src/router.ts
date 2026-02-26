import { Router } from "express";
import cloudRouter from "./v1/cloud/cloud.router";
import terminalRouter from "./v1/terminal/terminal.router";
import itemRouter from "./v1/item/item.router";
import hotkeyRouter from "./v1/hotkey/hotkey.router";
import crmRouter from "./v1/crm/crm.router";
import userRouter from "./v1/user/user.router";
import shiftRouter from "./v1/shift/shift.router";
import saleRouter from "./v1/sale/sale.router";
import printerRouter from "./v1/printer/printer.router";
import cashIORouter from "./v1/cashio/cashio.router";
import storeRouter from "./v1/store/store.router";

const router = Router();

router.use("/cloud", cloudRouter);
router.use("/terminal", terminalRouter);
router.use("/shift", shiftRouter);
router.use("/item", itemRouter);
router.use("/hotkey", hotkeyRouter);
router.use("/crm", crmRouter);
router.use("/user", userRouter);
router.use("/sale", saleRouter);
router.use("/printer", printerRouter);
router.use("/cashio", cashIORouter);
router.use("/store", storeRouter);
export default router;
