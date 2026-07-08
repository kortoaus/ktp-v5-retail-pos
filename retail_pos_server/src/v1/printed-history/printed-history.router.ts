import { Router } from "express";
import { scopeMiddleware, userMiddleware } from "../user/user.middleware";
import {
  listPrintedHistorySummariesController,
  markPrintedHistoryController,
} from "./printed-history.controller";

const printedHistoryRouter = Router();

printedHistoryRouter.get(
  "/",
  userMiddleware,
  scopeMiddleware("sale"),
  listPrintedHistorySummariesController,
);

printedHistoryRouter.post(
  "/",
  userMiddleware,
  scopeMiddleware("sale"),
  markPrintedHistoryController,
);

export default printedHistoryRouter;
