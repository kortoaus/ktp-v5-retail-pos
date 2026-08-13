import { Router } from "express";
import { scopeMiddleware, userMiddleware } from "../user/user.middleware";
import {
  acceptOrderController,
  getOrderController,
  getOrdersController,
  readyOrderController,
  rejectOrderController,
} from "./order.controller";

const orderRouter = Router();

orderRouter.get(
  "/",
  userMiddleware,
  scopeMiddleware("sale"),
  getOrdersController,
);

// 리터럴 라우트가 생기면 반드시 /:id 보다 먼저 등록할 것
// (sale.router.ts 의 /latest 관례 — Express 라우트 순서는 load-bearing).
orderRouter.get(
  "/:id",
  userMiddleware,
  scopeMiddleware("sale"),
  getOrderController,
);

orderRouter.post(
  "/:id/accept",
  userMiddleware,
  scopeMiddleware("sale"),
  acceptOrderController,
);

orderRouter.post(
  "/:id/ready",
  userMiddleware,
  scopeMiddleware("sale"),
  readyOrderController,
);

orderRouter.post(
  "/:id/reject",
  userMiddleware,
  scopeMiddleware("sale"),
  rejectOrderController,
);

export default orderRouter;
