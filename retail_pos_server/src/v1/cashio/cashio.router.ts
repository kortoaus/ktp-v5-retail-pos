import { Router } from "express";
import {
  createCashIOController,
  getCashIOsController,
} from "./cashio.controller";
import { scopeMiddleware, userMiddleware } from "../user/user.middleware";

const cashIORouter = Router();

cashIORouter.use(userMiddleware);
cashIORouter.use(scopeMiddleware("cashio"));
cashIORouter.route("/").get(getCashIOsController).post(createCashIOController);

export default cashIORouter;
