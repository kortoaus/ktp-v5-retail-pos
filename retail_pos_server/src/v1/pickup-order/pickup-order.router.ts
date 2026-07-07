import { Router } from "express";
import {
  getPickupOrderByIdController,
  getPickupOrderMemberPhoneController,
  listPickupOrdersController,
  syncPickupOrdersController,
  updatePickupOrderStatusController,
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

pickupOrderRouter.post(
  "/:id/status",
  userMiddleware,
  scopeMiddleware("sale"),
  updatePickupOrderStatusController,
);

pickupOrderRouter.get(
  "/:id/member-phone",
  userMiddleware,
  scopeMiddleware("sale"),
  getPickupOrderMemberPhoneController,
);

pickupOrderRouter.get(
  "/:id",
  userMiddleware,
  scopeMiddleware("sale"),
  getPickupOrderByIdController,
);

export default pickupOrderRouter;
