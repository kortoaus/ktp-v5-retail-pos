import { Router } from "express";
import { scopeMiddleware, userMiddleware } from "../user/user.middleware";
import {
  acceptOrderController,
  bulkDispatchOrdersController,
  bulkScheduleOrdersController,
  deliverOrderController,
  dispatchOrderController,
  scheduleOrderController,
  getOrderController,
  getOrdersController,
  pickingOrderController,
  printedOrderController,
  revealOrderMemberPhoneController,
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

// 딜리버리 일괄 전이 (2026-09-24 crm 스펙 §5.3) — 리터럴, /:id 계열보다 먼저.
orderRouter.post(
  "/schedule",
  userMiddleware,
  scopeMiddleware("sale"),
  bulkScheduleOrdersController,
);

orderRouter.post(
  "/dispatch",
  userMiddleware,
  scopeMiddleware("sale"),
  bulkDispatchOrdersController,
);

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
  bulkDispatchOrdersController,
  bulkScheduleOrdersController,
  deliverOrderController,
  dispatchOrderController,
  scheduleOrderController,
);

orderRouter.post(
  "/:id/ready",
  userMiddleware,
  scopeMiddleware("sale"),
  readyOrderController,
);

// S2 러너 피킹 확정 — ACCEPTED→READY 의 피킹 변형(crm 프록시).
orderRouter.post(
  "/:id/picking",
  userMiddleware,
  scopeMiddleware("sale"),
  pickingOrderController,
);

orderRouter.post(
  "/:id/reject",
  userMiddleware,
  scopeMiddleware("sale"),
  rejectOrderController,
);

// 딜리버리 단건 전이 — schedule = ACCEPTED→SCHEDULED + Stripe 캡처,
// dispatch = SCHEDULED→DISPATCHED, deliver = DISPATCHED→DELIVERED.
orderRouter.post(
  "/:id/schedule",
  userMiddleware,
  scopeMiddleware("sale"),
  scheduleOrderController,
);

orderRouter.post(
  "/:id/dispatch",
  userMiddleware,
  scopeMiddleware("sale"),
  dispatchOrderController,
);

orderRouter.post(
  "/:id/deliver",
  userMiddleware,
  scopeMiddleware("sale"),
  deliverOrderController,
);

orderRouter.post(
  "/:id/printed",
  userMiddleware,
  scopeMiddleware("sale"),
  printedOrderController,
);

orderRouter.post(
  "/:id/member-phone",
  userMiddleware,
  scopeMiddleware("sale"),
  revealOrderMemberPhoneController,
);

export default orderRouter;
