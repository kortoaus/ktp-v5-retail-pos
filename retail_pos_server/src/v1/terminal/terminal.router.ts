import { Router } from "express";
import { scopeMiddleware, userMiddleware } from "../user/user.middleware";
import {
  getMyTerminal,
  listTerminals,
  setTerminalOrderChime,
} from "./terminal.controller";

const terminalRouter = Router();

// 리터럴 라우트를 param 라우트보다 먼저 선언한다.
terminalRouter.get("/me", getMyTerminal);
terminalRouter.get("/", listTerminals);
terminalRouter.patch(
  "/:id/order-chime",
  userMiddleware,
  scopeMiddleware("store"),
  setTerminalOrderChime,
);

export default terminalRouter;
