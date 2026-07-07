import { Router } from "express";
import {
  getPickupOrderByIdController,
  listPickupOrdersController,
  syncPickupOrdersController,
} from "./pickup-order.controller";
import { scopeMiddleware, userMiddleware } from "../user/user.middleware";

const pickupOrderRouter = Router();

pickupOrderRouter.get(
  "/",
  userMiddleware,
  scopeMiddleware("sale"),
  listPickupOrdersController,
);

pickupOrderRouter.post(
  "/sync",
  userMiddleware,
  scopeMiddleware("sale"),
  syncPickupOrdersController,
);

pickupOrderRouter.get(
  "/:id",
  userMiddleware,
  scopeMiddleware("sale"),
  getPickupOrderByIdController,
);

export default pickupOrderRouter;
