import { Router } from "express";
import {
  createRefundController,
  createRepayController,
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

// POST /api/sale/refund — REFUND invoice 생성. Body: RefundCreatePayload.
// 서버가 drift-absorbing 수식 + tender cap + CRM 차단 검증 전부 canonical 수행.
// sale.refund.service.ts 헤더 주석 참조.
saleRouter.post(
  "/refund",
  userMiddleware,
  scopeMiddleware("refund"),
  createRefundController,
);

// POST /api/sale/repay — 원본 전량 환불 + 원본 rows 로 새 SALE 을 한 tx 에
// 원자적으로 생성. Body: RepayPayload. 조건 (서버 재검증):
//   - orig.type=SALE, refunds.length=0, orig.shiftId=current, <10분,
//     customer-voucher 없음 (D-21)
// 응답: { refund, newSale } — 영수증 두 장 + drawer kick 은 client 에서.
saleRouter.post(
  "/repay",
  userMiddleware,
  scopeMiddleware("refund"),
  createRepayController,
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
