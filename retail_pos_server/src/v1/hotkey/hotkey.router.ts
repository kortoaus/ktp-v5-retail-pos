import { Router } from "express";
import {
  upsertHotkeyController,
  getHotkeysController,
  deleteHotkeyController,
} from "./hotkey.controller";

const hotkeyRouter = Router();

hotkeyRouter.post("/", upsertHotkeyController);
hotkeyRouter.get("/", getHotkeysController);
hotkeyRouter.delete("/:id", deleteHotkeyController);

export default hotkeyRouter;
