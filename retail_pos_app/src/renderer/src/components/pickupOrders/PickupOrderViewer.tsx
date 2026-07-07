import { useCallback, useEffect, useRef, useState } from "react";
import { cn } from "../../libs/cn";
import {
  getPickupOrderByCrmId,
  getPickupOrderMemberPhone,
  syncPickupOrders,
  updatePickupOrderStatus,
} from "../../service/pickup-order.service";
import {
  countSelectedOptions,
  formatPickupMoney,
  formatPickupQty,
  formatPickupTime,
  statusLabel,
} from "./pickup-order-format";
import PickupOrderWorkLabelPreview from "./PickupOrderWorkLabelPreview";
import {
  POS_PICKUP_ORDER_STATUS_TARGETS,
  type PosPickupOrderStatus,
  type PickupOrderDetail,
  type PickupOrderLine,
  type PickupOrderSelectedOptionGroup,
  type PickupOrderStatus,
} from "./pickup-order-types";

type Props = {
  crmOrderId: number | null;
  onClose: () => void;
  onRefreshList: () => void;
};

export default function PickupOrderViewer({
  crmOrderId,
  onClose,
  onRefreshList,
}: Props) {
  const [order, setOrder] = useState<PickupOrderDetail | null>(null);
  const [selectedCrmLineId, setSelectedCrmLineId] = useState<number | null>(
    null,
  );
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [revealedPhone, setRevealedPhone] = useState("");
  const [phoneLoading, setPhoneLoading] = useState(false);
  const [phoneError, setPhoneError] = useState("");
  const [statusActionLoading, setStatusActionLoading] = useState(false);
  const [statusActionError, setStatusActionError] = useState("");
  const phoneRevealRequestGenRef = useRef(0);
  const statusActionRequestGenRef = useRef(0);
  const activeCrmOrderIdRef = useRef<number | null>(crmOrderId);
  activeCrmOrderIdRef.current = crmOrderId;

  const resetPhoneReveal = useCallback(() => {
    phoneRevealRequestGenRef.current += 1;
    setRevealedPhone("");
    setPhoneLoading(false);
    setPhoneError("");
  }, []);

  const applyOrderDetail = useCallback(
    (detail: PickupOrderDetail) => {
      resetPhoneReveal();
      setOrder(detail);
      setSelectedCrmLineId(detail.lines[0]?.crmLineId ?? null);
    },
    [resetPhoneReveal],
  );

  const loadOrder = useCallback(
    async (id: number, shouldApply: () => boolean = () => true) => {
      const res = await getPickupOrderByCrmId(id);
      if (!shouldApply()) return;
      if (res.ok && res.result) {
        applyOrderDetail(res.result);
        return;
      }
      throw new Error(res.msg || "Failed to load pickup order");
    },
    [applyOrderDetail],
  );

  useEffect(() => {
    statusActionRequestGenRef.current += 1;
    if (crmOrderId == null) {
      setOrder(null);
      setSelectedCrmLineId(null);
      setError("");
      setStatusActionError("");
      setStatusActionLoading(false);
      resetPhoneReveal();
      setLoading(false);
      return;
    }
    let active = true;
    setOrder(null);
    setSelectedCrmLineId(null);
    setError("");
    setStatusActionError("");
    resetPhoneReveal();
    setLoading(true);
    void (async () => {
      try {
        await loadOrder(crmOrderId, () => active);
      } catch (err) {
        if (!active) return;
        setError(
          err instanceof Error ? err.message : "Failed to load pickup order",
        );
      } finally {
        if (active) {
          setLoading(false);
        }
      }
    })();

    return () => {
      active = false;
    };
  }, [crmOrderId, loadOrder, resetPhoneReveal]);

  const changeStatus = async (status: PosPickupOrderStatus) => {
    if (crmOrderId == null || !order || statusActionLoading) return;
    const actionCrmOrderId = crmOrderId;
    const label = statusLabel(status);
    const firstConfirmed = window.confirm(
      `Change pickup order status to ${label}?`,
    );
    if (!firstConfirmed) return;
    const secondConfirmed = window.confirm(
      `Customer may receive a push notification for ${label}. Continue?`,
    );
    if (!secondConfirmed) return;

    const actionGen = statusActionRequestGenRef.current + 1;
    statusActionRequestGenRef.current = actionGen;
    const isCurrentAction = () =>
      statusActionRequestGenRef.current === actionGen &&
      activeCrmOrderIdRef.current === actionCrmOrderId;

    setStatusActionLoading(true);
    setStatusActionError("");
    try {
      const statusRes = await updatePickupOrderStatus(actionCrmOrderId, status);
      if (!isCurrentAction()) return;
      if (!statusRes.ok) {
        throw new Error(
          statusRes.msg || "Failed to update pickup order status",
        );
      }
      if (!statusRes.result) {
        throw new Error("Failed to update pickup order status");
      }

      applyOrderDetail(statusRes.result);

      const syncRes = await syncPickupOrders();
      if (!isCurrentAction()) return;
      if (!syncRes.ok) {
        throw new Error("Pickup order updated, but sync failed");
      }

      await loadOrder(actionCrmOrderId, isCurrentAction);
      if (!isCurrentAction()) return;
      onRefreshList();
    } catch (err) {
      if (!isCurrentAction()) return;
      setStatusActionError(
        err instanceof Error
          ? err.message
          : "Failed to update pickup order status",
      );
    } finally {
      if (isCurrentAction()) {
        setStatusActionLoading(false);
      }
    }
  };

  const close = () => {
    statusActionRequestGenRef.current += 1;
    onClose();
  };

  const revealPhone = async () => {
    if (crmOrderId == null || phoneLoading) return;
    const requestGen = phoneRevealRequestGenRef.current + 1;
    phoneRevealRequestGenRef.current = requestGen;
    setPhoneLoading(true);
    setPhoneError("");
    try {
      const res = await getPickupOrderMemberPhone(crmOrderId);
      if (phoneRevealRequestGenRef.current !== requestGen) return;
      if (res.ok && res.result) {
        setRevealedPhone(res.result.phone);
      } else {
        setPhoneError(res.msg || "Could not load phone");
      }
    } catch {
      if (phoneRevealRequestGenRef.current !== requestGen) return;
      setPhoneError("Could not load phone");
    } finally {
      if (phoneRevealRequestGenRef.current === requestGen) {
        setPhoneLoading(false);
      }
    }
  };

  const hidePhone = () => {
    setRevealedPhone("");
    setPhoneError("");
  };

  const selectedLine =
    order?.lines.find((line) => line.crmLineId === selectedCrmLineId) ??
    order?.lines[0] ??
    null;

  if (crmOrderId == null) return null;

  return (
    <div
      className="fixed inset-0 flex items-center justify-center bg-black/50 p-4"
      style={{ zIndex: 1500 }}
      onPointerDown={close}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-[1180px] flex-col overflow-hidden rounded-lg bg-white shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="flex h-12 shrink-0 items-center justify-between gap-3 border-b border-gray-200 px-4">
          <div className="flex min-w-0 items-center gap-2">
            <h2 className="truncate text-sm font-bold">
              {order ? order.documentId : "Pickup Order"}
            </h2>
            {order && <StatusBadge status={order.status} />}
          </div>
          <button
            type="button"
            onPointerDown={close}
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
          <div className="grid min-h-0 flex-1 grid-rows-[minmax(0,1fr)_78px] overflow-hidden">
            <section className="grid min-h-0 grid-cols-[360px_480px_minmax(300px,1fr)] grid-rows-[auto_minmax(0,1fr)] overflow-hidden bg-gray-50">
              <OrderInfoStrip
                order={order}
                revealedPhone={revealedPhone}
                phoneLoading={phoneLoading}
                phoneError={phoneError}
                onRevealPhone={revealPhone}
                onHidePhone={hidePhone}
              />

              <LinesPanel
                lines={order.lines}
                selectedCrmLineId={selectedLine?.crmLineId ?? null}
                onSelect={setSelectedCrmLineId}
              />

              <section className="col-start-2 row-start-2 flex min-h-0 flex-col items-center justify-center gap-3 overflow-hidden border-r border-gray-200 bg-gray-50 p-4">
                {selectedLine ? (
                  <PickupOrderWorkLabelPreview order={order} line={selectedLine} />
                ) : (
                  <div className="flex h-full items-center justify-center text-sm font-medium text-gray-400">
                    No pickup order lines
                  </div>
                )}
              </section>

              <LineInstructions line={selectedLine} />
            </section>

            <StatusActionBar
              documentId={order.documentId}
              currentStatus={order.status}
              loading={statusActionLoading}
              error={statusActionError}
              onChangeStatus={changeStatus}
            />
          </div>
        )}
      </div>
    </div>
  );
}

function OrderInfoStrip({
  order,
  revealedPhone,
  phoneLoading,
  phoneError,
  onRevealPhone,
  onHidePhone,
}: {
  order: PickupOrderDetail;
  revealedPhone: string;
  phoneLoading: boolean;
  phoneError: string;
  onRevealPhone: () => void;
  onHidePhone: () => void;
}) {
  return (
    <section className="col-span-2 row-start-1 grid auto-rows-[72px] grid-cols-[repeat(auto-fit,minmax(150px,1fr))] gap-2 border-b border-r border-gray-200 bg-white p-3">
      <OrderStripField label="Pickup" value={formatPickupTime(order.pickupStartsAt)} />
      <OrderStripField label="Created" value={formatPickupTime(order.crmCreatedAt)} />
      <OrderStripField label="Member" value={order.memberName || "-"} />
      <PhoneToggleField
        last4={order.memberPhoneLast4}
        revealedPhone={revealedPhone}
        phoneLoading={phoneLoading}
        phoneError={phoneError}
        onRevealPhone={onRevealPhone}
        onHidePhone={onHidePhone}
      />
      <OrderStripField label="Subtotal" value={formatPickupMoney(order.linesTotal)} />
      <OrderStripField label="Total" value={formatPickupMoney(order.total)} />
    </section>
  );
}

function OrderStripField({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-lg border border-gray-200 bg-white px-3 py-2">
      <div className="truncate text-[11px] font-black uppercase tracking-wide text-gray-400">
        {label}
      </div>
      <div className="mt-1 truncate text-base font-black text-gray-900">
        {value}
      </div>
    </div>
  );
}

function PhoneToggleField({
  last4,
  revealedPhone,
  phoneLoading,
  phoneError,
  onRevealPhone,
  onHidePhone,
}: {
  last4: string | null;
  revealedPhone: string;
  phoneLoading: boolean;
  phoneError: string;
  onRevealPhone: () => void;
  onHidePhone: () => void;
}) {
  const value = phoneLoading
    ? "Loading..."
    : revealedPhone || phoneError || (last4 ? `**** ${last4}` : "-");
  const action = revealedPhone ? onHidePhone : onRevealPhone;
  const actionLabel = revealedPhone ? "Hide phone" : "Show phone";

  return (
    <button
      type="button"
      onPointerDown={action}
      disabled={phoneLoading}
      aria-label={actionLabel}
      title={actionLabel}
      className={cn(
        "min-w-0 rounded-lg border-2 bg-white px-3 py-2 text-left",
        "disabled:cursor-not-allowed disabled:opacity-70",
        phoneError
          ? "border-red-200 text-red-600 active:bg-red-50"
          : "border-blue-200 text-blue-700 active:bg-blue-50",
      )}
    >
      <div className="truncate text-[11px] font-black uppercase tracking-wide text-gray-400">
        Phone
      </div>
      <div className="mt-1 truncate font-mono text-base font-black">
        {value}
      </div>
    </button>
  );
}

function StatusActionBar({
  documentId,
  currentStatus,
  loading,
  error,
  onChangeStatus,
}: {
  documentId: string;
  currentStatus: PickupOrderStatus;
  loading: boolean;
  error: string;
  onChangeStatus: (status: PosPickupOrderStatus) => void;
}) {
  return (
    <footer className="grid grid-cols-[minmax(0,1fr)_repeat(5,minmax(118px,150px))] items-center gap-2 border-t border-gray-200 bg-white px-4 py-2">
      <div className="min-w-0">
        <div className="truncate text-[11px] font-black uppercase tracking-wide text-gray-400">
          Set status for {documentId}
        </div>
        <div className="mt-1 truncate text-sm font-black text-gray-900">
          Current: {statusLabel(currentStatus)}
        </div>
        {error && (
          <div className="mt-1 truncate text-xs font-bold text-red-600">
            {error}
          </div>
        )}
      </div>

      {POS_PICKUP_ORDER_STATUS_TARGETS.map((status) => {
        const isCurrent = status === currentStatus;
        const isCancel = status === "CANCELLED_BY_STORE";
        return (
          <button
            key={status}
            type="button"
            onPointerDown={() => onChangeStatus(status)}
            disabled={loading || isCurrent}
            className={cn(
              "h-14 min-w-0 rounded-lg border-2 px-2 text-[12px] font-black uppercase leading-tight",
              "active:bg-blue-50 disabled:cursor-not-allowed",
              isCurrent
                ? "border-gray-300 bg-gray-50 text-gray-400"
                : isCancel
                  ? "border-red-200 bg-white text-red-600 active:bg-red-50"
                  : "border-blue-200 bg-white text-blue-700",
              loading && !isCurrent && "opacity-50",
            )}
          >
            {statusLabel(status)}
          </button>
        );
      })}
    </footer>
  );
}

function LinesPanel({
  lines,
  selectedCrmLineId,
  onSelect,
}: {
  lines: PickupOrderLine[];
  selectedCrmLineId: number | null;
  onSelect: (crmLineId: number) => void;
}) {
  return (
    <aside className="col-start-1 row-start-2 grid min-h-0 grid-rows-[auto_minmax(0,1fr)] overflow-hidden border-r border-gray-200 bg-white">
      <div className="border-b border-gray-100 px-4 py-3 text-xs font-black uppercase tracking-wide text-gray-400">
        Lines
      </div>
      <div className="min-h-0 overflow-y-auto p-3 pb-16">
        {lines.length === 0 ? (
          <div className="flex h-full items-center justify-center text-sm font-medium text-gray-400">
            No pickup order lines
          </div>
        ) : (
          <div className="space-y-2">
            {lines.map((line) => (
              <button
                key={line.crmLineId}
                type="button"
                onPointerDown={() => onSelect(line.crmLineId)}
                className={cn(
                  "block min-h-24 w-full rounded-lg border-2 p-3 text-left active:bg-blue-50",
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
    </aside>
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
            label={`${optionCount} OPTIONS`}
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

function LineInstructions({ line }: { line: PickupOrderLine | null }) {
  return (
    <aside className="col-start-3 row-span-2 row-start-1 grid min-h-0 grid-rows-[auto_minmax(0,1fr)] bg-white">
      <div className="border-b border-gray-200 px-4 py-4">
        <div className="text-xl font-black text-gray-900">
          Line instructions
        </div>
        <div className="mt-1 text-sm font-semibold text-gray-500">
          Options and customer note
        </div>
      </div>

      <div className="min-h-0 overflow-y-auto p-4">
        {line ? (
          <>
            <InstructionOptionGroups groups={line.selectedOptionsSnapshot} />
            <InstructionCustomerNote note={line.note} />
          </>
        ) : (
          <div className="flex h-full items-center justify-center text-sm font-medium text-gray-400">
            No pickup order lines
          </div>
        )}
      </div>
    </aside>
  );
}

function InstructionOptionGroups({
  groups,
}: {
  groups: PickupOrderSelectedOptionGroup[];
}) {
  return (
    <section className="rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs font-black uppercase tracking-wide text-gray-400">
        Selected options
      </div>
      {groups.length === 0 ? (
        <div className="mt-3 rounded-lg border border-gray-200 bg-gray-50 p-3 text-sm font-medium text-gray-500">
          No selected options
        </div>
      ) : (
        <div className="mt-3 space-y-3">
          {groups.map((group) => (
            <InstructionOptionGroup key={group.optionGroupId} group={group} />
          ))}
        </div>
      )}
    </section>
  );
}

function InstructionOptionGroup({
  group,
}: {
  group: PickupOrderSelectedOptionGroup;
}) {
  const groupLabel = group.name_en || group.key;

  return (
    <div className="rounded-lg border border-gray-200 p-3">
      <div className="flex items-center justify-between gap-3">
        <div className="min-w-0 break-words text-base font-black text-gray-900">
          {groupLabel}
        </div>
        <span className="shrink-0 rounded bg-gray-100 px-2 py-1 text-[10px] font-black uppercase text-gray-500">
          {group.type}
        </span>
      </div>
      <div className="mt-2 divide-y divide-gray-100">
        {group.selectedOptions.map((option, index) => {
          const optionLabel = option.name_en || option.key;
          return (
            <div
              key={`${option.key}-${index}`}
              className="grid min-h-12 grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-3 py-2 text-base font-bold"
            >
              <span className="min-w-0 break-words text-gray-900">
                {optionLabel}
              </span>
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

function InstructionCustomerNote({ note }: { note: string | null }) {
  return (
    <section className="mt-4 rounded-lg border border-gray-200 bg-white p-4">
      <div className="text-xs font-black uppercase tracking-wide text-gray-400">
        Customer note
      </div>
      <div className="mt-3 min-h-24 whitespace-pre-wrap rounded-lg border border-gray-200 bg-gray-50 p-3 text-base font-semibold text-gray-800">
        {note || "No customer note"}
      </div>
    </section>
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
