// 드라이버 런시트 80mm 렌더 모델 — 순수 함수, 하드웨어/캔버스 무접촉 (오너 결정 2026-09-24:
// 배달 기사용 한 장. 고객 전체 전화번호는 오직 이 시트에만 — 박스 인보이스는 마스킹 유지).
// 캔버스/바이트는 libs/printer/driver-sheet-receipt.ts.
//
// 데이터 = GET /api/order/delivery-manifest?ids=…&include=contactPhone 1요청 (crm 이 주문별
// contactPhone 을 멤버 현재 전화로 복호화 — 탈퇴·익명화는 null). 위→아래:
// 머리 "DRIVER RUN — Thu 24 Sep · 9am–9pm" / "Printed 24/09/2026 4:10pm · 3 stops" →
// 배달일 섹션 → 정류장 → 꼬리말(개인정보 경고).
//
// 묶음·정렬 룰 (오너 2026-09-24): 주문 1건 = 정류장 1줄 (같은 주소여도 합치지 않는다).
// 정류장은 배달일(deliveryDate, crm 트리아지와 같은 ETA 날짜)별로 묶고, 같은 날 안에서
// postcode → suburb → address 안정 정렬. deliveryDate 없음 → runDate 로 묶는다.
// 배달일이 여럿(Out 버킷의 과기한 주문 등)이면 날짜 오름차순 섹션마다 머리
// "Thu 24 Sep · 9am–9pm" 를 찍고 정류장 번호는 섹션마다 1부터 다시 (restart) — 기사는
// 날짜 머리 아래 번호로 읽는다. 제목은 한 날짜면 "DRIVER RUN — {날짜·시간창}",
// 여럿이면 "DRIVER RUN — {n} delivery days". 한 날짜면 섹션 머리는 찍지 않는다(제목과 중복).
// 정류장 줄: 번호·주문번호·이름·전화(04xx xxx xxx)·주소 줄·메모·ID CHECK 18+·품목 수(라인 수)·□ Delivered.
// node --test 로 직접 실행 — 런타임 import 는 같은 폴더 순수 모듈만.

import {
  escposSafe,
  leftRight,
  wrapToWidth,
  ESC_LINE,
  type DeliveryWindow,
  type EscposLine,
} from "./order-invoice-render";
import { formatClock12, formatDayLabel, formatPrintedAt } from "./triage-format";
import type { DeliveryManifestOrder } from "../../service/order.service";

export const DRIVER_SHEET_FOOTER = "Keep this sheet private — contains customer contact details.";
export const NO_PHONE_TEXT = "No phone on file";

export type DriverStop = {
  stopNo: number;
  orderId: number;
  orderNo: string; // "#260924-313"
  name: string;
  phone: string; // "0412 345 678" | NO_PHONE_TEXT
  addressLines: string[]; // address1, address2, "Suburb NSW 2000"
  note: string | null;
  ageCheck: boolean;
  itemsLine: string; // "5 items · 3 lines"
};

export type DriverSheetSection = {
  date: string; // Sydney YYYY-MM-DD
  header: string | null; // "Thu 24 Sep · 9am–9pm" — 배달일이 여럿일 때만, 한 날짜면 null
  stops: DriverStop[]; // stopNo 는 섹션마다 1부터
};

export type DriverSheetModel = {
  title: string; // "DRIVER RUN — Thu 24 Sep · 9am–9pm" | "DRIVER RUN — 2 delivery days"
  printedLine: string; // "Printed 24/09/2026 4:10pm · 3 stops" (전체 정류장 수)
  sections: DriverSheetSection[]; // 배달일 오름차순
  footer: string;
};

export type DriverSheetInput = Pick<
  DeliveryManifestOrder,
  | "id"
  | "orderNo"
  | "memberName"
  | "shippingAddress1"
  | "shippingAddress2"
  | "shippingSuburb"
  | "shippingState"
  | "shippingPostcode"
  | "shippingNote"
  | "requiresAgeCheck"
  | "lines"
> & { contactPhone?: string | null; deliveryDate?: string | null };

export type BuildDriverSheetOptions = {
  runDate: string; // Sydney YYYY-MM-DD (버킷 today)
  deliveryWindow?: DeliveryWindow;
  printedAt: Date;
};

const clean = (v: string | null | undefined): string => v?.trim() ?? "";

// AU 모바일 표시 — 저장형(9자리 "4xxxxxxxx")·"04…"·"+614…"·"614…" → "0412 345 678".
// 모바일이 아니면 숫자 원형(비면 null). 평문은 이 표시 외 어디에도 남기지 않는다.
export function formatAuPhone(raw: string | null | undefined): string | null {
  const value = clean(raw);
  if (!value) return null;
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("61") && digits.length === 11) digits = `0${digits.slice(2)}`;
  else if (digits.length === 9 && digits.startsWith("4")) digits = `0${digits}`;
  if (digits.length === 10 && digits.startsWith("04")) {
    return `${digits.slice(0, 4)} ${digits.slice(4, 7)} ${digits.slice(7)}`;
  }
  if (digits.length === 10 && digits.startsWith("0")) {
    return `${digits.slice(0, 2)} ${digits.slice(2, 6)} ${digits.slice(6)}`;
  }
  return value;
}

// "Thu 24 Sep · 9am–9pm" (시간창 한쪽이라도 null 이면 날짜만) — 제목·섹션 머리 공용.
export function formatDriverDayLabel(date: string, window: DeliveryWindow = null): string {
  const day = formatDayLabel(date);
  if (!window || window.startMinutes == null || window.endMinutes == null) return day;
  return `${day} · ${formatClock12(window.startMinutes)}–${formatClock12(window.endMinutes)}`;
}

// "DRIVER RUN — Thu 24 Sep · 9am–9pm".
export function formatDriverRunTitle(runDate: string, window: DeliveryWindow = null): string {
  return `DRIVER RUN — ${formatDriverDayLabel(runDate, window)}`;
}

// 배달일별 묶음 (날짜 오름차순), 섹션 안은 sortStops. 빈/없는 deliveryDate → runDate.
export function groupStopsByDate<T extends DriverSheetInput>(
  orders: T[],
  runDate: string,
): { date: string; orders: T[] }[] {
  const byDate = new Map<string, T[]>();
  for (const order of orders) {
    const date = clean(order.deliveryDate) || runDate;
    const bucket = byDate.get(date);
    if (bucket) bucket.push(order);
    else byDate.set(date, [order]);
  }
  return [...byDate.keys()]
    .sort()
    .map((date) => ({ date, orders: sortStops(byDate.get(date)!) }));
}

// postcode → suburb → address1 → address2, 빈 값은 뒤로. 동률은 입력 순서 유지(안정).
export function sortStops<T extends DriverSheetInput>(orders: T[]): T[] {
  const key = (o: T) => [
    clean(o.shippingPostcode),
    clean(o.shippingSuburb).toLowerCase(),
    clean(o.shippingAddress1).toLowerCase(),
    clean(o.shippingAddress2).toLowerCase(),
  ];
  return orders
    .map((order, index) => ({ order, index, k: key(order) }))
    .sort((a, b) => {
      for (let i = 0; i < a.k.length; i += 1) {
        const x = a.k[i];
        const y = b.k[i];
        if (x === y) continue;
        if (!x) return 1;
        if (!y) return -1;
        return x < y ? -1 : 1;
      }
      return a.index - b.index;
    })
    .map((entry) => entry.order);
}

export function formatItemsLine(lines: DriverSheetInput["lines"]): string {
  const items = lines.reduce((s, l) => s + l.qty, 0);
  return `${items} item${items === 1 ? "" : "s"} · ${lines.length} line${lines.length === 1 ? "" : "s"}`;
}

export function buildDriverSheetModel(
  orders: DriverSheetInput[],
  options: BuildDriverSheetOptions,
): DriverSheetModel {
  const toStop = (o: DriverSheetInput, i: number): DriverStop => {
    const locality = [o.shippingSuburb, o.shippingState, o.shippingPostcode]
      .map(clean)
      .filter(Boolean)
      .join(" ");
    const note = clean(o.shippingNote);
    return {
      stopNo: i + 1,
      orderId: o.id,
      orderNo: `#${o.orderNo}`,
      name: clean(o.memberName) || "—",
      phone: formatAuPhone(o.contactPhone) ?? NO_PHONE_TEXT,
      addressLines: [clean(o.shippingAddress1), clean(o.shippingAddress2), locality].filter(Boolean),
      note: note || null,
      ageCheck: o.requiresAgeCheck === true,
      itemsLine: formatItemsLine(o.lines),
    };
  };
  const window = options.deliveryWindow ?? null;
  const groups = groupStopsByDate(orders, options.runDate);
  const multi = groups.length > 1;
  const sections = groups.map(
    (g): DriverSheetSection => ({
      date: g.date,
      header: multi ? formatDriverDayLabel(g.date, window) : null,
      stops: g.orders.map(toStop), // 번호는 섹션마다 1부터 (restart)
    }),
  );
  const n = orders.length;
  return {
    title: multi
      ? `DRIVER RUN — ${groups.length} delivery days`
      : formatDriverRunTitle(groups[0]?.date ?? options.runDate, window),
    printedLine: `Printed ${formatPrintedAt(options.printedAt)} · ${n} stop${n === 1 ? "" : "s"}`,
    sections,
    footer: DRIVER_SHEET_FOOTER,
  };
}

// --- ESC/POS 텍스트 레이아웃 (42칸, 폰트 A) ---

export function buildDriverSheetEscposLines(model: DriverSheetModel): EscposLine[] {
  const L: EscposLine[] = [];
  const divider = (ch = "-"): void => {
    L.push({ text: ch.repeat(ESC_LINE) });
  };
  const wrapped = (text: string, extra: Partial<EscposLine> = {}, indent = ""): void => {
    for (const t of wrapToWidth(escposSafe(text), ESC_LINE - indent.length)) {
      L.push({ text: `${indent}${t}`, ...extra });
    }
  };

  wrapped(model.title, { align: "center", bold: true, tall: true });
  wrapped(model.printedLine, { align: "center" });
  divider("=");
  for (const section of model.sections) {
    // 배달일이 여럿일 때만 섹션 머리 (정류장 번호는 섹션마다 1부터).
    if (section.header) {
      wrapped(section.header, { align: "center", bold: true, tall: true });
      divider("=");
    }
    for (const stop of section.stops) {
      L.push({ text: leftRight(`STOP ${stop.stopNo}`, stop.orderNo), bold: true, tall: true });
      wrapped(stop.name, { bold: true });
      L.push({ text: `Ph ${stop.phone}`, bold: true });
      for (const a of stop.addressLines) wrapped(a);
      if (stop.note) wrapped(`Note: ${stop.note}`, {}, "");
      if (stop.ageCheck) L.push({ text: " ID CHECK 18+ ", bold: true, invert: true });
      L.push({ text: leftRight(escposSafe(stop.itemsLine), "[ ] Delivered") });
      divider();
    }
  }
  wrapped(model.footer, { align: "center", bold: true });
  return L;
}
