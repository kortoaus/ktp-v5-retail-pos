import { Router } from "express";
import { getMyTerminal } from "./terminal.controller";

const terminalRouter = Router();

terminalRouter.get("/me", getMyTerminal);

export default terminalRouter;
