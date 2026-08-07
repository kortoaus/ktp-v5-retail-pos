export const MEMBER_QR_PREFIX = "member%%%";

export interface ParsedMemberQr {
  memberId: string;
  level: number | null;
}

// member%%%<id>[%%%<level>[...]] — level 은 양의 정수만 인정, 그 외 null.
// 세그먼트 3 이상은 무시(전방 호환). level 은 오프라인 폴백 전용 — 온라인 조회값이 항상 우선.
// 주의: invoice-search-scan.ts 는 node 테스트 제약(확장자 임포트) 때문에 이 모듈을
// import 하지 않고 같은 split 규칙을 인라인으로 유지한다.
export function parseMemberQr(raw: string): ParsedMemberQr | null {
  if (!raw.startsWith(MEMBER_QR_PREFIX)) return null;
  const segments = raw.slice(MEMBER_QR_PREFIX.length).split("%%%");
  const memberId = segments[0];
  if (!memberId) return null;
  const levelRaw = segments[1];
  const level =
    levelRaw != null && /^[1-9]\d*$/.test(levelRaw) ? Number(levelRaw) : null;
  return { memberId, level };
}
