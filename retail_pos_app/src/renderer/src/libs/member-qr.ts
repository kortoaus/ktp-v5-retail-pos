export const MEMBER_QR_PREFIX = "member%%%";

export interface ParsedMemberQr {
  memberId: string;
  level: number | null;
  // D-27 — CRM/api-server company id of the member's brand (fourth segment).
  // Gates the offline attach; null on old app builds (3-segment QR).
  companyId: number | null;
}

const POSITIVE_INT = /^[1-9]\d*$/;

// member%%%<id>[%%%<level>[%%%<companyId>[...]]] — level·companyId 는 양의 정수만 인정, 그 외 null.
// 네 번째 이후 세그먼트는 무시(전방 호환). level·companyId 는 오프라인 폴백 전용 — 온라인 조회값이 항상 우선
// (D-27: companyId 가 매장 회사와 같을 때만 오프라인 첨부).
// 주의: invoice-search-scan.ts 는 node 테스트 제약(확장자 임포트) 때문에 이 모듈을
// import 하지 않고 같은 split 규칙을 인라인으로 유지한다.
export function parseMemberQr(raw: string): ParsedMemberQr | null {
  if (!raw.startsWith(MEMBER_QR_PREFIX)) return null;
  const segments = raw.slice(MEMBER_QR_PREFIX.length).split("%%%");
  const memberId = segments[0];
  if (!memberId) return null;
  return {
    memberId,
    level: positiveIntOrNull(segments[1]),
    companyId: positiveIntOrNull(segments[2]),
  };
}

function positiveIntOrNull(raw: string | undefined): number | null {
  return raw != null && POSITIVE_INT.test(raw) ? Number(raw) : null;
}
