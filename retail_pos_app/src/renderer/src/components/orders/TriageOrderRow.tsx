// 트리아지 목록 행 (56px, 버킷 공통 고정 칼럼 — 트리아지 스펙 §6.1).
// Due · orderNo + C&C/DLV · 이름 …끝3 · (DLV) suburb postcode · N× 첫상품 +n · 총액 ·
// 상태 · ID 18+ · 이슈 칩(서버 issueText, 최대 2 + "+n") · 정보 배지 Refund requested.
// 좌측 색띠: 이슈 = 빨강, AUTO_VOID_SOON 만 = 앰버. 버킷 이탈 행은 흐리게 + 결과 태그,
// 새 행은 NEW. 클라 isOverdue 없음 (F3 — 판정은 서버 이슈만). onPointerDown 만 사용.

import { cn } from "../../libs/cn";
import type { OrderSummary } from "../../service/order.service";
import { FulfillmentBadge, StatusBadge } from "./order-badges";
import type { BulkItemResult } from "./delivery-bulk";
import {
  formatDueColumn,
  formatMoney,
  hasOpenRefundRequest,
  issueChipsForRow,
  lineSummaryText,
  rowStripTone,
} from "./triage-format";
import type { TriageRowState } from "./triage-merge";

export function RefundRequestedBadge() {
  return (
    <span className="shrink-0 text-[10px] font-bold px-2 py-1 rounded tracking-wide whitespace-nowrap bg-slate-200 text-slate-700">
      Refund requested
    </span>
  );
}

export function AgeCheckBadge() {
  return (
    <span className="shrink-0 text-[10px] font-bold px-1.5 py-1 rounded bg-red-100 text-red-700 whitespace-nowrap">
      ID 18+
    </span>
  );
}

export default function TriageOrderRow({
  row,
  today,
  selectable,
  selected,
  result,
  rowAction,
  onToggleSelect,
  onOpen,
}: {
  row: TriageRowState<OrderSummary>;
  today: string;
  selectable: boolean;
  selected: boolean;
  result?: BulkItemResult;
  // 행 버튼 (delivery.today 의 미확정 행 Schedule 등) — 없으면 미표시.
  rowAction?: { label: string; disabled: boolean; onPress: () => void } | null;
  onToggleSelect: (id: number) => void;
  onOpen: (id: number) => void;
}) {
  const { order, gone, goneLabel, isNew } = row;
  const tone = rowStripTone(order.triage);
  const { shown, more } = issueChipsForRow(order.triage);
  const isDelivery = order.fulfillment === "DELIVERY";

  return (
    <div
      onPointerDown={() => onOpen(order.id)}
      className={cn(
        "h-14 shrink-0 flex items-center gap-2 pr-3 text-[15px] border-b border-gray-200 border-l-4 border-l-transparent cursor-pointer active:bg-gray-100",
        tone === "red" && "border-l-red-500",
        tone === "amber" && "border-l-amber-500",
        isNew && !gone && "bg-blue-50",
        gone && "opacity-45",
      )}
    >
      {selectable ? (
        <span
          onPointerDown={(e) => {
            e.stopPropagation();
            onToggleSelect(order.id);
          }}
          className="w-12 h-14 shrink-0 flex items-center justify-center"
        >
          <span
            className={cn(
              "w-7 h-7 rounded border-2 flex items-center justify-center text-sm font-bold",
              selected ? "bg-blue-600 border-blue-600 text-white" : "border-gray-400 bg-white",
            )}
          >
            {selected ? "✓" : ""}
          </span>
        </span>
      ) : (
        <span className="w-2 shrink-0" />
      )}
      <span className="w-[88px] shrink-0 tabular-nums font-semibold">
        {formatDueColumn(order, today)}
      </span>
      <span className="w-[104px] shrink-0 font-mono text-sm">{order.orderNo}</span>
      <FulfillmentBadge fulfillment={order.fulfillment} />
      <span className="w-40 shrink-0 truncate">
        {order.memberName}
        <span className="text-gray-400 text-sm"> …{order.memberPhoneLast3}</span>
      </span>
      <span className="w-36 shrink-0 truncate text-sm text-gray-600">
        {isDelivery
          ? [order.shippingSuburb, order.shippingPostcode].filter(Boolean).join(" ")
          : ""}
      </span>
      <span className="flex-1 min-w-[80px] truncate text-gray-700">
        <span className="text-sm text-gray-400 mr-1">{order.lineCount}×</span>
        {lineSummaryText(order)}
      </span>
      <span className="w-20 shrink-0 text-right font-mono">{formatMoney(order.total)}</span>
      <StatusBadge status={order.status} />
      <span className="w-12 shrink-0 flex justify-center">
        {order.requiresAgeCheck ? <AgeCheckBadge /> : null}
      </span>
      <span className="w-[240px] shrink-0 flex items-center gap-1 overflow-hidden">
        {isNew && !gone && (
          <span className="shrink-0 text-[10px] font-bold px-1.5 py-1 rounded bg-blue-600 text-white">
            NEW
          </span>
        )}
        {gone && goneLabel && (
          <span className="shrink-0 text-[11px] font-bold px-2 py-1 rounded bg-gray-200 text-gray-700 whitespace-nowrap">
            {goneLabel}
          </span>
        )}
        {result &&
          (result.ok ? (
            <span className="shrink-0 text-[11px] font-bold px-2 py-1 rounded bg-emerald-100 text-emerald-800 whitespace-nowrap">
              {result.label}
            </span>
          ) : (
            <span className="min-w-0 truncate text-[11px] font-bold px-2 py-1 rounded bg-red-600 text-white">
              {result.message}
            </span>
          ))}
        {!gone &&
          shown.map((text) => (
            <span
              key={text}
              className={cn(
                "min-w-0 truncate text-[11px] font-bold px-2 py-1 rounded whitespace-nowrap",
                tone === "amber" ? "bg-amber-400 text-amber-950" : "bg-red-600 text-white",
              )}
            >
              {text}
            </span>
          ))}
        {!gone && more > 0 && (
          <span className="shrink-0 text-[11px] font-bold text-red-700">+{more}</span>
        )}
        {hasOpenRefundRequest(order.payment) && <RefundRequestedBadge />}
      </span>
      {rowAction && (
        <button
          type="button"
          disabled={rowAction.disabled}
          onPointerDown={(e) => {
            e.stopPropagation();
            if (!rowAction.disabled) rowAction.onPress();
          }}
          className="h-10 px-3 shrink-0 rounded-lg bg-blue-600 text-white text-sm font-bold disabled:opacity-40"
        >
          {rowAction.label}
        </button>
      )}
    </div>
  );
}
