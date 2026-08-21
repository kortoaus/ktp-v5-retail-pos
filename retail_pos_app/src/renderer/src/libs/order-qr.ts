export const ORDER_QR_PREFIX = "order%%%";

export interface ParsedOrderQr {
  orderId: number;
}

// order%%%<id>[%%%...] — 픽업리스트 QR (슬라이스 C 인쇄분과 동일 포맷).
// id 는 양의 정수만 인정. 세그먼트 2 이상은 무시 (전방 호환 — member-qr 관례).
// 러너(pos-retail-android)의 order-qr 유틸과 같은 규칙의 독립 재구현 —
// 리포 간 import 금지 (형제 체크아웃 전제 없음).
export function parseOrderQr(raw: string): ParsedOrderQr | null {
  if (!raw.startsWith(ORDER_QR_PREFIX)) return null;
  const segments = raw.slice(ORDER_QR_PREFIX.length).split("%%%");
  const idRaw = segments[0];
  if (!idRaw || !/^[1-9]\d*$/.test(idRaw)) return null;
  return { orderId: Number(idRaw) };
}
