// POS 사용자 스코프 목록 — 정본. 앱 미러: retail_pos_app/src/renderer/src/types/models.ts
// SCOPES (두 패키지 빌드 독립 — 동기 수정할 것). scopeMiddleware 는 admin 이면 전부 통과.
//
// refund_ticket (2026-09-24 환불 티켓 스펙 Q4, 오너 확정): 온라인 주문 "Request refund"
// (사무실에 환불 요청 티켓만 올림). 기존 refund(매장 판매 환불)와 별개 — 요청을 올리는
// 사람이 계산원이 아닐 수 있어서 sale 전체 개방은 기각.
import { BadRequestException } from "../../libs/exceptions";

export const POS_USER_SCOPES = [
  "admin",
  "sale",
  "interface",
  "user",
  "hotkey",
  "refund",
  "refund_ticket",
  "cashio",
  "store",
  "shift",
] as const;

export type PosUserScope = (typeof POS_USER_SCOPES)[number];

// 저장 전 검증 — 문자열 배열, 알려진 스코프만, 중복 제거(입력 순서 유지).
export function normalizeUserScopes(input: unknown): PosUserScope[] {
  if (!Array.isArray(input)) {
    throw new BadRequestException("scope must be an array");
  }
  const out: PosUserScope[] = [];
  for (const raw of input) {
    if (
      typeof raw !== "string" ||
      !(POS_USER_SCOPES as readonly string[]).includes(raw)
    ) {
      throw new BadRequestException(`Unknown scope: ${String(raw)}`);
    }
    const scope = raw as PosUserScope;
    if (!out.includes(scope)) out.push(scope);
  }
  return out;
}
