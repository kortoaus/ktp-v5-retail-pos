import { Router } from "express";
import {
  openTerminalShiftController,
  getCurrentTerminalShiftController,
} from "./shift.controller";
import { scopeMiddleware, userMiddleware } from "../user/user.middleware";

const router = Router();

router.get("/current", getCurrentTerminalShiftController);

router.post(
  "/open",
  userMiddleware,
  scopeMiddleware("shift"),
  openTerminalShiftController,
);

export default router;
