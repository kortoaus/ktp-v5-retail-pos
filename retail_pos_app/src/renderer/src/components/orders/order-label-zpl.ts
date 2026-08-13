// 제작 라벨 ZPL 빌더 — 100×100mm @203dpi(812×812 dots), 순수 문자열 함수
// (슬라이스 C). 주문서+작업지시서+상품라벨 3역할: 상품명(en 크게) → 옵션
// 브레이크다운(작업지시 본문) → QTY → 하단 소형 orderNo+수령기한 → 바코드
// 플레이스홀더 박스 2개("ORDER QR" / "PP QR" — 자리만, 실데이터는 E/후속).
//
// 한글 인코딩 선택(기록): 기존 ZPL 텍스트 파이프라인(LabelBuilder.buildZPL,
// main/ipc/label.ts)은 ^A0 기본 폰트에 인코딩 지정(^CI) 없이 문자열을 그대로
// 보낸다 — ZPL 텍스트 경로는 한글 미지원(한글은 SLCS euc-kr 또는 픽업 v1 의
// 캔버스 raster ^GFA 그래픽 경로에서만 지원돼 왔다). 이 빌더는 순수 문자열
// 이라 raster 를 쓸 수 없으므로 **English-primary** 로 하고, name_ko 줄은
// 전체가 인쇄가능 ASCII 일 때만 넣는다(실질적으로 생략).

import type { OrderLine } from "../../service/order.service";

// 라벨이 실제로 쓰는 주문 컨텍스트만. dueDisplay 는 호출부가
// pick-list-render.formatOrderDueDisplay(detail.dueAt) 로 만들어 넘긴다 —
// 이 모듈은 콜로케이트 .test.mjs 로 node 직접 실행되는 순수 모듈이라
// 런타임 import 0 을 유지한다(label-7090-v2/layout.ts 관례).
export type OrderLabelContext = {
  orderNo: string;
  dueDisplay: string; // 서버 계산 dueAt 의 표시 문자열 (재계산 금지)
};

// 100×100mm @203dpi ≈ 812×812 dots.
const W = 812;
const H = 812;
const PAD = 24;

// 바닥 플레이스홀더 박스 2개 (좌: ORDER QR, 우: PP QR).
const BOX = 220;
const BOX_Y = H - PAD - BOX; // 568
const BOX_LEFT_X = PAD;
const BOX_RIGHT_X = W - PAD - BOX;

const NAME_FONT = 54;
const NAME_LH = 62;
const NAME_WRAP = 24;
const NAME_MAX_LINES = 2;
const KO_FONT = 34;
const KO_LH = 42;
const OPTION_FONT = 32;
const OPTION_LH = 38;
const OPTION_WRAP = 42;
const QTY_FONT = 68;
const FOOTER_FONT = 24;

// ZPL 제어문자(^ ~ \)와 비-ASCII 를 제거 — ^FD 데이터 안전화.
export function sanitizeZplText(text: string): string {
  return text
    .replace(/[\^~\\]/g, " ")
    .replace(/[^\x20-\x7e]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function isPrintableAscii(text: string): boolean {
  return /^[\x20-\x7e]*$/.test(text);
}

function wrapChars(text: string, max: number): string[] {
  if (text.length <= max) return [text];
  const lines: string[] = [];
  let rest = text;
  while (rest.length > max) {
    let breakAt = rest.lastIndexOf(" ", max);
    if (breakAt <= 0) breakAt = max;
    lines.push(rest.slice(0, breakAt));
    rest = rest.slice(breakAt).trimStart();
  }
  if (rest.length > 0) lines.push(rest);
  return lines;
}

function zplText(x: number, y: number, size: number, data: string): string {
  return `^FO${x},${y}^A0N,${size},${size}^FD${data}^FS`;
}

// 옵션 한 줄: `groupName: optionName x<qty>` (그룹명 비면 옵션명만).
export function formatOrderLabelOptionLine(option: {
  groupName_en: string;
  optionName_en: string;
  qty: number;
}): string {
  const group = option.groupName_en.trim();
  const name = option.optionName_en.trim();
  const body = group ? `${group}: ${name}` : name;
  return `${body} x${option.qty}`;
}

export function buildOrderLabelZpl(
  detail: OrderLabelContext,
  line: OrderLine,
): string {
  let zpl = `^XA^PW${W}^LL${H}`;
  let y = PAD;

  // ── 상품명 en (크게) — ko 는 ASCII 일 때만 (파일 헤더의 인코딩 선택 참고)
  const nameEn = sanitizeZplText(line.name_en) || `#${line.sourceItemId}`;
  const nameLines = wrapChars(nameEn, NAME_WRAP).slice(0, NAME_MAX_LINES);
  for (const nameLine of nameLines) {
    zpl += zplText(PAD, y, NAME_FONT, nameLine);
    y += NAME_LH;
  }
  const nameKo = line.name_ko.trim();
  if (nameKo && isPrintableAscii(nameKo)) {
    zpl += zplText(PAD, y, KO_FONT, sanitizeZplText(nameKo));
    y += KO_LH;
  }

  // ── 구분선
  y += 4;
  zpl += `^FO${PAD},${y}^GB${W - PAD * 2},3,3^FS`;
  y += 14;

  // ── 옵션 브레이크다운 (작업지시 본문) — QTY 영역 전까지만, 넘치면 +N more
  const qtyY = BOX_Y - 16 - QTY_FONT; // 484
  const optionLines = line.options.flatMap((option) =>
    wrapChars(sanitizeZplText(formatOrderLabelOptionLine(option)), OPTION_WRAP),
  );
  const maxOptionLines = Math.max(
    1,
    Math.floor((qtyY - 12 - y) / OPTION_LH),
  );
  const shown =
    optionLines.length > maxOptionLines
      ? [
          ...optionLines.slice(0, maxOptionLines - 1),
          `+${optionLines.length - (maxOptionLines - 1)} more`,
        ]
      : optionLines;
  for (const optionLine of shown) {
    zpl += zplText(PAD, y, OPTION_FONT, optionLine);
    y += OPTION_LH;
  }

  // ── QTY (크게)
  zpl += zplText(PAD, qtyY, QTY_FONT, `QTY ${line.qty}`);

  // ── 바코드 플레이스홀더 박스 2개 — 자리만, 실데이터 없음(스펙).
  //    실 바코드 명령(^BC/^BE/^BX/^BQ 등) 금지.
  zpl += `^FO${BOX_LEFT_X},${BOX_Y}^GB${BOX},${BOX},3^FS`;
  zpl += `^FO${BOX_LEFT_X},${BOX_Y + BOX / 2 - 14}^FB${BOX},1,0,C,0^A0N,28,28^FDORDER QR^FS`;
  zpl += `^FO${BOX_RIGHT_X},${BOX_Y}^GB${BOX},${BOX},3^FS`;
  zpl += `^FO${BOX_RIGHT_X},${BOX_Y + BOX / 2 - 14}^FB${BOX},1,0,C,0^A0N,28,28^FDPP QR^FS`;

  // ── 하단 소형: orderNo + 수령 기한 (박스 사이 중앙)
  const footerX = BOX_LEFT_X + BOX + 12;
  const footerW = BOX_RIGHT_X - footerX - 12;
  const footerY = BOX_Y + BOX / 2 - 34;
  zpl += `^FO${footerX},${footerY}^FB${footerW},1,0,C,0^A0N,${FOOTER_FONT},${FOOTER_FONT}^FD${sanitizeZplText(detail.orderNo)}^FS`;
  // due 없음 표시("—")는 비-ASCII 라 sanitize 로 사라짐 → "-" 로 대체.
  const dueSanitized = sanitizeZplText(detail.dueDisplay);
  const dueLine = dueSanitized ? `Due ${dueSanitized}` : "Due -";
  zpl += `^FO${footerX},${footerY + 32}^FB${footerW},2,4,C,0^A0N,${FOOTER_FONT},${FOOTER_FONT}^FD${dueLine}^FS`;

  zpl += "^XZ";
  return zpl;
}
