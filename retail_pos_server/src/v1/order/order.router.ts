import { Router } from "express";
import { scopeMiddleware, userMiddleware } from "../user/user.middleware";
import { getOrdersController } from "./order.controller";

const orderRouter = Router();

orderRouter.get(
  "/",
  userMiddleware,
  scopeMiddleware("sale"),
  getOrdersController,
);

export default orderRouter;
