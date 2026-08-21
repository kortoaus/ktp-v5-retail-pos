// S3 리뷰 반영 — 라인 제거 리듀서 (순수). SalesStore.removeLine 의 로직 본체.
//
// 마지막 라인 제거로 카트가 비면 주문 마킹(externalOrderId/orderNo)도
// 해제한다 — 주문 로드 카트를 라인 삭제(수량 0 포함)로 비우는 것은 로드
// 포기 의미론이라, 빈 카트에 주문 배지가 남아 다음 판매에 주문이 잘못
// 연계되는 잔존을 막는다. 멤버는 유지 (Clear Cart 와 달리 라인만 비운 것).
//
// 이 모듈은 런타임 import 0 (import type 만) — colocated .mjs 테스트가
// node --experimental-strip-types 로 직접 로드한다 (pick-list-render 관례).
// 인덱스 재부여는 SalesStore.helper.reindexLines 와 동일 로직 — 그 모듈은
// 런타임 import 사슬(constants/pp-barcode) 때문에 여기서 쓰지 않는다.

import type { Cart } from "./SalesStore.helper";

// lineKey 미존재 시 null 반환 (호출측 no-op).
export function removeLineFromCart(cart: Cart, lineKey: string): Cart | null {
  const filtered = cart.lines.filter((l) => l.lineKey !== lineKey);
  if (filtered.length === cart.lines.length) return null;

  const lines = filtered.map((line, i) =>
    line.index === i ? line : { ...line, index: i },
  );

  if (lines.length === 0) {
    return { ...cart, lines, externalOrderId: null, orderNo: null };
  }
  return { ...cart, lines };
}
