import { useEffect, useState } from "react";
import { cn } from "../../libs/cn";
import { getPickupOrderByCrmId } from "../../service/pickup-order.service";
import {
  countSelectedOptions,
  formatPickupMoney,
  formatPickupQty,
  formatPickupTime,
  statusLabel,
} from "./pickup-order-format";
import PickupOrderWorkLabelPreview from "./PickupOrderWorkLabelPreview";
import type {
  PickupOrderDetail,
  PickupOrderLine,
  PickupOrderSelectedOptionGroup,
  PickupOrderStatus,
} from "./pickup-order-types";

type Props = {
  crmOrderId: number | null;
  onClose: () => void;
};

export default function PickupOrderViewer({ crmOrderId, onClose }: Props) {
  const [order, setOrder] = useState<PickupOrderDetail | null>(null);
  const [selectedCrmLineId, setSelectedCrmLineId] = useState<number | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (crmOrderId == null) return;
    let active = true;
    setOrder(null);
    setSelectedCrmLineId(null);
    setError("");
    setLoading(true);
    getPickupOrderByCrmId(crmOrderId).then((res) => {
      if (!active) return;
      if (res.ok && res.result) {
        setOrder(res.result);
        setSelectedCrmLineId(res.result.lines[0]?.crmLineId ?? null);
      } else {
        setError(res.msg || "Failed to load pickup order");
      }
      setLoading(false);
    });

    return () => {
      active = false;
    };
  }, [crmOrderId]);

  const selectedLine =
    order?.lines.find((line) => line.crmLineId === selectedCrmLineId) ??
    order?.lines[0] ??
    null;

  if (crmOrderId == null) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/50 p-4"
      style={{ zIndex: 1500 }}
      onPointerDown={onClose}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex h-12 shrink-0 items-center justify-between border-b border-gray-200 px-4">
          <h2 className="text-sm font-bold">Pickup Order</h2>
          <button
            type="button"
            onPointerDown={onClose}
            className="flex size-10 items-center justify-center rounded-lg text-xl text-gray-500 active:bg-gray-200"
          >
            X
          </button>
        </div>

        {loading && (
          <div className="p-10 text-center font-mono text-sm text-gray-400">
            Loading...
          </div>
        )}

        {error && !loading && (
          <div className="p-10 text-center font-mono text-sm text-red-500">
            {error}
          </div>
        )}

        {order && !loading && !error && (
          <div className="grid min-h-0 flex-1 grid-cols-[minmax(320px,390px)_minmax(0,1fr)] overflow-hidden">
            <section className="min-h-0 overflow-auto border-r border-gray-200">
              <OrderSummary order={order} />
              <LineSelector
                lines={order.lines}
                selectedCrmLineId={selectedLine?.crmLineId ?? null}
                onSelect={setSelectedCrmLineId}
              />
            </section>

            <section className="min-h-0 overflow-auto bg-gray-50 p-4">
              {selectedLine ? (
                <div className="grid gap-4 xl:grid-cols-[auto_minmax(0,1fr)]">
                  <div className="flex justify-center">
                    <PickupOrderWorkLabelPreview
                      order={order}
                      line={selectedLine}
                    />
                  </div>
                  <LineDetail line={selectedLine} />
                </div>
              ) : (
                <div className="flex h-full items-center justify-center text-sm text-gray-400">
                  No pickup order lines
                </div>
              )}
            </section>
          </div>
        )}
      </div>
    </div>
  );
}

function OrderSummary({ order }: { order: PickupOrderDetail }) {
  return (
    <div className="border-b border-gray-200 p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate font-mono text-sm font-bold">
            {order.documentId}
          </div>
          <div className="mt-1 text-xs text-gray-500">
            CRM Order {order.crmOrderId}
          </div>
        </div>
        <StatusBadge status={order.status} />
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-xs">
        <SummaryField label="Pickup" value={formatPickupTime(order.pickupStartsAt)} />
        <SummaryField label="Created" value={formatPickupTime(order.crmCreatedAt)} />
        <SummaryField label="Member" value={order.memberName || "-"} />
        <SummaryField
          label="Phone"
          value={order.memberPhoneLast4 ? `*${order.memberPhoneLast4}` : "-"}
        />
        <SummaryField label="Member ID" value={order.memberId || "-"} />
        <SummaryField label="Level" value={String(order.memberLevel)} />
        <SummaryField
          label="Subtotal"
          value={formatPickupMoney(order.linesTotal)}
        />
        <SummaryField label="Total" value={formatPickupMoney(order.total)} />
      </div>
    </div>
  );
}

function SummaryField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="font-bold uppercase tracking-wide text-gray-400">
        {label}
      </div>
      <div className="mt-0.5 truncate font-medium text-gray-800">{value}</div>
    </div>
  );
}

function LineSelector({
  lines,
  selectedCrmLineId,
  onSelect,
}: {
  lines: PickupOrderLine[];
  selectedCrmLineId: number | null;
  onSelect: (crmLineId: number) => void;
}) {
  return (
    <div className="p-3">
      <div className="mb-2 px-1 text-xs font-bold uppercase tracking-wide text-gray-400">
        Lines
      </div>
      {lines.length === 1 ? (
        <LineSummaryRow line={lines[0]} />
      ) : (
        <div className="space-y-2">
          {lines.map((line) => (
            <button
              key={line.crmLineId}
              type="button"
              onPointerDown={() => onSelect(line.crmLineId)}
              className={cn(
                "block w-full rounded-lg border p-3 text-left active:bg-blue-50",
                selectedCrmLineId === line.crmLineId
                  ? "border-blue-500 bg-blue-50"
                  : "border-gray-200 bg-white",
              )}
            >
              <LineRowContent line={line} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function LineSummaryRow({ line }: { line: PickupOrderLine }) {
  return (
    <div className="rounded-lg border border-gray-200 bg-white p-3">
      <LineRowContent line={line} />
    </div>
  );
}

function LineRowContent({ line }: { line: PickupOrderLine }) {
  const optionCount = countSelectedOptions(line.selectedOptionsSnapshot);
  const primaryName = line.name_ko || line.name_en || line.code || line.barcode;

  return (
    <div className="min-w-0">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-bold">{primaryName}</div>
          <div className="truncate text-xs text-gray-500">
            {line.name_en || line.barcode}
          </div>
        </div>
        <div className="shrink-0 text-right font-mono text-xs font-bold">
          {formatPickupQty(line.qty, line.uom)}
        </div>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-1">
        <span className="font-mono text-xs text-gray-500">
          Line {line.index}
        </span>
        {line.note && <Cue label="NOTE" className="bg-amber-100 text-amber-700" />}
        {optionCount > 0 && (
          <Cue
            label={`OPTIONS ${optionCount}`}
            className="bg-indigo-100 text-indigo-700"
          />
        )}
      </div>
    </div>
  );
}

function Cue({ label, className }: { label: string; className: string }) {
  return (
    <span className={cn("rounded px-1.5 py-0.5 text-[10px] font-bold", className)}>
      {label}
    </span>
  );
}

function LineDetail({ line }: { line: PickupOrderLine }) {
  return (
    <div className="min-w-0 rounded-lg border border-gray-200 bg-white p-4">
      <div className="flex items-start justify-between gap-3 border-b border-gray-200 pb-3">
        <div className="min-w-0">
          <div className="truncate text-lg font-black">
            {line.name_ko || line.name_en || line.barcode}
          </div>
          <div className="mt-1 truncate text-sm text-gray-500">
            {line.name_en || line.code || line.barcode}
          </div>
        </div>
        <div className="shrink-0 text-right">
          <div className="font-mono text-sm font-bold">
            {formatPickupQty(line.qty, line.uom)}
          </div>
          <div className="mt-1 font-mono text-xs text-gray-500">
            Line {line.index}
          </div>
        </div>
      </div>

      <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <DetailField label="Barcode" value={line.barcode || "-"} mono />
        <DetailField label="Code" value={line.code || "-"} mono />
        <DetailField label="Member level" value={String(line.memberLevel)} />
        <DetailField label="Line total" value={formatPickupMoney(line.total)} mono />
        <DetailField
          label="Option total"
          value={formatPickupMoney(line.optionTotal)}
          mono
        />
      </div>

      <OptionGroups groups={line.selectedOptionsSnapshot} />

      <div className="mt-4">
        <div className="text-xs font-bold uppercase tracking-wide text-gray-400">
          Customer note
        </div>
        <div className="mt-1 min-h-16 whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-800">
          {line.note || "No customer note"}
        </div>
      </div>
    </div>
  );
}

function DetailField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="min-w-0">
      <div className="text-xs font-bold uppercase tracking-wide text-gray-400">
        {label}
      </div>
      <div
        className={cn(
          "mt-0.5 break-words font-medium text-gray-800",
          mono && "font-mono",
        )}
      >
        {value}
      </div>
    </div>
  );
}

function OptionGroups({
  groups,
}: {
  groups: PickupOrderSelectedOptionGroup[];
}) {
  return (
    <div className="mt-4">
      <div className="text-xs font-bold uppercase tracking-wide text-gray-400">
        Selected options
      </div>
      {groups.length === 0 ? (
        <div className="mt-1 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm text-gray-500">
          No selected options
        </div>
      ) : (
        <div className="mt-2 space-y-3">
          {groups.map((group) => (
            <OptionGroup key={group.optionGroupId} group={group} />
          ))}
        </div>
      )}
    </div>
  );
}

function OptionGroup({ group }: { group: PickupOrderSelectedOptionGroup }) {
  const groupLabel = group.name_ko || group.name_en || group.key;

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-2">
        <div className="min-w-0 break-words text-sm font-bold">
          {groupLabel}
        </div>
        <span className="shrink-0 rounded bg-gray-100 px-2 py-1 text-[10px] font-bold text-gray-500">
          {group.type}
        </span>
      </div>
      <div className="mt-2 space-y-1">
        {group.selectedOptions.map((option) => {
          const optionLabel = option.name_ko || option.name_en || option.key;
          return (
            <div
              key={option.key}
              className="grid grid-cols-[minmax(0,1fr)_auto_auto] gap-2 text-sm"
            >
              <span className="min-w-0 break-words">{optionLabel}</span>
              <span className="font-mono text-gray-500">
                {formatPickupQty(option.qty, "")}
              </span>
              <span className="font-mono text-gray-700">
                {formatPickupMoney(option.priceDelta)}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function StatusBadge({ status }: { status: PickupOrderStatus }) {
  return (
    <span
      className={cn(
        "whitespace-nowrap rounded px-2 py-1 text-[10px] font-bold tracking-wider",
        statusClass(status),
      )}
    >
      {statusLabel(status)}
    </span>
  );
}

function statusClass(status: PickupOrderStatus): string {
  switch (status) {
    case "PENDING":
      return "bg-gray-100 text-gray-700";
    case "ORDER_CONFIRMED":
      return "bg-blue-100 text-blue-700";
    case "READY":
      return "bg-emerald-100 text-emerald-700";
    case "COMPLETED":
      return "bg-slate-100 text-slate-700";
    case "CANCELLED_BY_STORE":
    case "CANCELLED_BY_CUSTOMER":
      return "bg-red-100 text-red-700";
  }
}
