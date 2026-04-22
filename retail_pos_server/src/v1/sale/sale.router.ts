import { Router } from "express";
import {
  createSaleController,
  createSpendController,
  getLatestInvoiceController,
  getSaleInvoiceByIdController,
  getSaleInvoicesController,
} from "./sale.controller";
import { scopeMiddleware, userMiddleware } from "../user/user.middleware";

const saleRouter = Router();

// POST /api/sale — 새 SALE invoice 생성.
//   1. voucher 검증 → 2. 금액 검증 → 3. 저장 → 4. TODO: cloud sync push
saleRouter.post(
  "/",
  userMiddleware,
  scopeMiddleware("sale"),
  createSaleController,
);

// POST /api/sale/spend — 내부 소비 (kitchen / cafe). 금액 0, payments 없음.
// rows 의 가격/adjustments 는 서버가 강제 정규화 (D-14~16).
saleRouter.post(
  "/spend",
  userMiddleware,
  scopeMiddleware("sale"),
  createSpendController,
);

// GET /api/sale — 리스트 조회 (keyword / 날짜 / 금액 / member / type 필터).
// 쿼리 파라미터:
//   page, limit
//   keyword      — 공백 분리 AND; serial/companyName/memberName/row 검색
//   from, to     — createdAt ISO 범위
//   memberId
//   minTotal     — cents (dollars * 100)
//   maxTotal     — cents
//   type         — SALE | REFUND | SPEND
saleRouter.get(
  "/",
  userMiddleware,
  scopeMiddleware("sale"),
  getSaleInvoicesController,
);

// GET /api/sale/latest — 현재 terminal 의 가장 최근 invoice. "Print Latest"
// 버튼용. 없으면 result: null. 반드시 `/:id` 전에 라우팅 (순서 매치).
saleRouter.get(
  "/latest",
  userMiddleware,
  scopeMiddleware("sale"),
  getLatestInvoiceController,
);

// GET /api/sale/:id — 단일 invoice 조회 (reprint / refund 진입점).
saleRouter.get(
  "/:id",
  userMiddleware,
  scopeMiddleware("sale"),
  getSaleInvoiceByIdController,
);

export default saleRouter;
