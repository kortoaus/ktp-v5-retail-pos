// 자유 텍스트 템플릿 입력 검증 — **순수 함수, 의존성 없음**.
//
// `lines` 는 Prisma `Json` 이라 DB 가 아무것도 막아주지 않는다. 여기서 걸러진
// 값만 저장되므로, 이 파일이 사실상 그 컬럼의 스키마다. 서비스/컨트롤러와
// 분리해 둔 것은 리포 테스트 관례 때문 — 순수 함수만 `*.test.ts` 로 검증하고
// Postgres 는 건드리지 않는다(`store.service.test.ts` 와 같은 결).
//
// 줄 하나라도 기형이면 **요청 전체를 거절한다**. 부분 저장하면 나중에 인쇄
// 버튼 뒤에서 문구가 조용히 빠진 채 나오는데, 그건 저장 실패보다 나쁘다.

/** label-core `templates/free-text-6040` 의 같은 이름 타입과 1:1. 이 서버는
 *  라벨을 그리지 않으므로 정본을 import 하지 않고 형태만 복제한다. */
export type FreeTextSize = "S" | "M" | "L";
export type FreeTextWeight = "M" | "B" | "BK";

export type FreeTextLine = {
  text: string;
  size: FreeTextSize;
  weight: FreeTextWeight;
};

export type FreeTextTemplateInput = {
  /** trim 된 이름 — 덮어쓰기 판정 키이기도 하다. */
  name: string;
  lines: FreeTextLine[];
};

export type ValidationResult =
  | { ok: true; value: FreeTextTemplateInput }
  | { ok: false; msg: string };

/** 이름 길이 상한 — 목록 한 줄에 들어가야 하고, 이름은 식별용이지 문구가
 *  아니다. 문구 자체는 `lines` 로 간다. */
export const NAME_MAX = 100;

/** 한 템플릿의 줄 수 상한. 60×40 한 장에 대여섯 줄이 들어가니 100 줄이면
 *  이미 여러 장짜리 문서다 — 그 위는 실수로 본다. */
export const LINES_MAX = 100;

/** 한 줄의 글자 수 상한. 정본이 알아서 접고 넘치면 장을 나누므로 인쇄가
 *  깨지진 않지만, 무한정 받아 Json 컬럼을 부풀릴 이유가 없다. */
export const TEXT_MAX = 2000;

const SIZES: readonly FreeTextSize[] = ["S", "M", "L"];
const WEIGHTS: readonly FreeTextWeight[] = ["M", "B", "BK"];

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/**
 * `POST /api/free-text-template` 의 body 검증.
 *
 * 성공하면 **저장해도 되는 값만** 담아 돌려준다(이름은 trim, 줄은 세 필드만
 * 추려 재조립) — 호출부가 원본 body 를 그대로 쓰지 않게 하려는 것이다.
 * 실패 msg 는 그대로 `{ ok:false, msg }` 400 응답이 되므로 어느 줄이
 * 문제인지 번호를 넣는다.
 */
export function validateFreeTextTemplateInput(body: unknown): ValidationResult {
  if (!isRecord(body)) {
    return { ok: false, msg: "Invalid body" };
  }

  if (typeof body.name !== "string") {
    return { ok: false, msg: "name is required" };
  }
  const name = body.name.trim();
  if (name.length === 0) {
    return { ok: false, msg: "name is required" };
  }
  if (name.length > NAME_MAX) {
    return { ok: false, msg: `name must be ${NAME_MAX} characters or fewer` };
  }

  if (!Array.isArray(body.lines)) {
    return { ok: false, msg: "lines must be an array" };
  }
  if (body.lines.length > LINES_MAX) {
    return { ok: false, msg: `lines must have ${LINES_MAX} entries or fewer` };
  }

  const lines: FreeTextLine[] = [];
  for (let i = 0; i < body.lines.length; i += 1) {
    const raw: unknown = body.lines[i];
    const at = `lines[${i}]`;

    if (!isRecord(raw)) {
      return { ok: false, msg: `${at} must be an object` };
    }
    if (typeof raw.text !== "string") {
      return { ok: false, msg: `${at}.text must be a string` };
    }
    if (raw.text.length > TEXT_MAX) {
      return {
        ok: false,
        msg: `${at}.text must be ${TEXT_MAX} characters or fewer`,
      };
    }
    if (!SIZES.includes(raw.size as FreeTextSize)) {
      return { ok: false, msg: `${at}.size must be one of S, M, L` };
    }
    if (!WEIGHTS.includes(raw.weight as FreeTextWeight)) {
      return { ok: false, msg: `${at}.weight must be one of M, B, BK` };
    }

    lines.push({
      text: raw.text,
      size: raw.size as FreeTextSize,
      weight: raw.weight as FreeTextWeight,
    });
  }

  return { ok: true, value: { name, lines } };
}

/** 덮어쓰기 비교 키 — 앞뒤 공백·대소문자 무시("Chilled" ≡ " chilled ").
 *  `@unique` 는 정확 일치라 이 판정은 서비스의 `lower(name)` 조회가 한다. */
export function templateNameKey(name: string): string {
  return name.trim().toLocaleLowerCase();
}
