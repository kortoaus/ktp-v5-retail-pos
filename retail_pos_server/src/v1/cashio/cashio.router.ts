import { Router } from "express";
import {
  createCashIOController,
  getCashIOsController,
} from "./cashio.controller";
import { scopeMiddleware, userMiddleware } from "../user/user.middleware";
import { withContext } from "../request-context";

const cashIORouter = Router();

cashIORouter.use(userMiddleware);
cashIORouter.use(scopeMiddleware("cashio"));
cashIORouter
  .route("/")
  .get(getCashIOsController)
  .post(withContext(["shift"]), createCashIOController);

export default cashIORouter;
