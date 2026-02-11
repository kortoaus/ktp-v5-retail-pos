import { Router } from "express";
import cloudRouter from "./v1/cloud/cloud.router";
import terminalRouter from "./v1/terminal/terminal.router";
import itemRouter from "./v1/item/item.router";

const router = Router();

router.use("/cloud", cloudRouter);
router.use("/terminal", terminalRouter);
router.use("/item", itemRouter);

export default router;
