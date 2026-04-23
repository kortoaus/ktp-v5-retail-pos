// SaleRefundDetailScreen — 원본 SALE invoice 를 받아 per-row refund qty 선택
// + per-tender 환불 금액 배분을 UI 로 받는 화면. Submit 은 아직 없음 (UIUX
// 단계). refund-plan.md §4 참조.
//
// 입력 방식 (row.type 별):
//  - WEIGHT             : Numpad (소수점, maxDp=3)
//  - NORMAL             : Numpad (정수만 — useDot=false)
//  - PREPACKED / WEIGHT_PREPACKED : all-or-nothing 토글 (qty ↔ cap)
//  - Tender amount      : MoneyNumpad
// 각각 해당 row/tender 의 display 버튼을 누르면 모달 open (또는 토글).

import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import {
  createRefundInvoice,
  getSaleInvoiceById,
  SaleInvoiceDetail,
  SaleInvoiceRowItem,
} from "../../service/sale.service";
import {
  computeInvoice,
  computeTenderCaps,
  hasCustomerVoucherPayment,
  rowRefundable,
  rowRefundAmount,
  type RefundSelection,
  type TenderCapEntry,
} from "../../libs/refund/compute";
import { buildRefundPayload } from "../../libs/refund/build-payload";
import { MONEY_DP, MONEY_SCALE, QTY_SCALE } from "../../libs/constants";
import MoneyNumpad from "../../components/Numpads/MoneyNumpad";
import Numpad from "../../components/Numpads/Numpad";
import LoadingOverlay from "../../components/LoadingOverlay";
import { kickDrawer } from "../../libs/printer/kick-drawer";
import { printSaleInvoiceReceipt } from "../../libs/printer/sale-invoice-receipt";
import { cn } from "../../libs/cn";

const fmt = (cents: number) =>
  `$${(Math.abs(cents) / MONEY_SCALE).toFixed(MONEY_DP)}`;
const fmtSigned = (cents: number) =>
  (cents < 0 ? "−" : "") +
  `$${(Math.abs(cents) / MONEY_SCALE).toFixed(MONEY_DP)}`;
// qty ×1000 → "2.5" (trailing zero trim, 정수면 "." 없이)
const fmtQty = (q: number) =>
  (q / QTY_SCALE).toFixed(3).replace(/\.?0+$/, "");
// qty ×1000 → numpad 초기값 문자열. 비어 있으면 "".
const qtyToInputStr = (q: number) =>
  q > 0 ? (q / QTY_SCALE).toString() : "";

type NumpadTarget =
  | { kind: "tender"; keyStr: string }
  | { kind: "rowQty"; rowId: number };

interface Props {
  // 명시적으로 넘어오면 그대로, 없으면 `/manager/refund/:invoiceId` 파라미터 사용.
  invoiceId?: number;
}

export default function SaleRefundDetailScreen({
  invoiceId: invoiceIdProp,
}: Props) {
  const navigate = useNavigate();
  const params = useParams();
  const invoiceId = invoiceIdProp ?? parseInt(params.invoiceId ?? "", 10);
  const [invoice, setInvoice] = useState<SaleInvoiceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  // Per-row 선택된 refund qty (원본 row.id → qty ×1000)
  const [selections, setSelections] = useState<RefundSelection>({});

  // Per-tender 입력 금액 (keyStr → cents)
  const [tenderAmounts, setTenderAmounts] = useState<Record<string, number>>(
    {},
  );

  // Numpad 상태
  const [numpadTarget, setNumpadTarget] = useState<NumpadTarget | null>(null);
  const [numpadValue, setNumpadValue] = useState<string>("");

  // Confirm dialog 단계 — null | review | final. Submit 은 final 이후.
  const [confirmStage, setConfirmStage] = useState<null | "review" | "final">(
    null,
  );
  const [submitting, setSubmitting] = useState(false);

  // ── Fetch ─────────────────────────────────────────────────
  useEffect(() => {
    if (!Number.isFinite(invoiceId)) {
      setError("Invalid invoice id");
      return;
    }
    setLoading(true);
    setError("");
    setInvoice(null);
    setSelections({});
    setTenderAmounts({});
    getSaleInvoiceById(invoiceId)
      .then((res) => {
        if (res.ok && res.result) setInvoice(res.result);
        else setError(res.msg || "Failed to load invoice");
      })
      .finally(() => setLoading(false));
  }, [invoiceId]);

  // ── Derived ──────────────────────────────────────────────
  const caps: TenderCapEntry[] = useMemo(
    () => (invoice ? computeTenderCaps(invoice) : []),
    [invoice],
  );

  // Cash-only mode — non-cash tender 입력이 전부 0 이고 cash 입력이 >0.
  const allCashMode = useMemo(() => {
    let cashSum = 0;
    let nonCashSum = 0;
    for (const c of caps) {
      const amt = tenderAmounts[c.keyStr] ?? 0;
      if (c.key.kind === "CASH") cashSum += amt;
      else nonCashSum += amt;
    }
    return cashSum > 0 && nonCashSum === 0;
  }, [caps, tenderAmounts]);

  const calc = useMemo(() => {
    if (!invoice)
      return {
        linesTotal: 0,
        creditSurchargeAmount: 0,
        lineTax: 0,
        surchargeTax: 0,
        subtotalBeforeRounding: 0,
        rounding: 0,
        total: 0,
        isCashOnlyCapable: false,
      };
    return computeInvoice(invoice, selections, { allCashMode });
  }, [invoice, selections, allCashMode]);

  const paid = useMemo(
    () => Object.values(tenderAmounts).reduce((s, n) => s + n, 0),
    [tenderAmounts],
  );
  const remaining = calc.total - paid;

  const anyRowSelected = useMemo(
    () => Object.values(selections).some((q) => q > 0),
    [selections],
  );

  // CRM customer-voucher 차단 (D-21). 현재 CRM online check 없음 → 전면 차단.
  const crmBlocked = invoice ? hasCustomerVoucherPayment(invoice) : false;

  const canComplete =
    !crmBlocked && anyRowSelected && calc.total > 0 && remaining === 0;

  // ── Row qty handlers ─────────────────────────────────────
  function setRowQty(row: SaleInvoiceRowItem, qty: number) {
    const cap = rowRefundable(row);
    const clamped = Math.max(0, Math.min(cap, qty));
    setSelections((prev) => ({ ...prev, [row.id]: clamped }));
  }

  function refundAllRow(row: SaleInvoiceRowItem) {
    setRowQty(row, rowRefundable(row));
  }

  function refundAllRows() {
    if (!invoice) return;
    const next: RefundSelection = {};
    for (const r of invoice.rows) next[r.id] = rowRefundable(r);
    setSelections(next);
  }

  function clearAll() {
    setSelections({});
    setTenderAmounts({});
  }

  // ── Numpad handlers ──────────────────────────────────────
  function openTenderNumpad(keyStr: string) {
    const cur = tenderAmounts[keyStr] ?? 0;
    setNumpadTarget({ kind: "tender", keyStr });
    setNumpadValue(cur > 0 ? String(cur) : "");
  }

  // Prepacked 은 numpad 안 열고 바로 토글 (0 ↔ cap). WEIGHT / NORMAL 만
  // 모달 open — NumpadModal 내부에서 useDot 을 row.type 으로 결정.
  function handleRowQtyTap(row: SaleInvoiceRowItem) {
    const cap = rowRefundable(row);
    if (cap === 0) return;
    if (row.type === "PREPACKED" || row.type === "WEIGHT_PREPACKED") {
      const cur = selections[row.id] ?? 0;
      setRowQty(row, cur === cap ? 0 : cap);
      return;
    }
    const cur = selections[row.id] ?? 0;
    setNumpadTarget({ kind: "rowQty", rowId: row.id });
    setNumpadValue(qtyToInputStr(cur));
  }

  function closeNumpad() {
    setNumpadTarget(null);
    setNumpadValue("");
  }

  function commitNumpad() {
    if (numpadTarget == null) return;
    if (numpadTarget.kind === "tender") {
      const cents = parseInt(numpadValue || "0", 10);
      const cap = caps.find((c) => c.keyStr === numpadTarget.keyStr);
      if (cap) {
        const clamped = Math.max(0, Math.min(cap.remaining, cents));
        setTenderAmounts((prev) => ({
          ...prev,
          [numpadTarget.keyStr]: clamped,
        }));
      }
    } else {
      const n = parseFloat(numpadValue || "0");
      const qty = Number.isFinite(n) ? Math.round(n * QTY_SCALE) : 0;
      const row = invoice?.rows.find((r) => r.id === numpadTarget.rowId);
      if (row) setRowQty(row, qty);
    }
    closeNumpad();
  }

  // ── Submit ───────────────────────────────────────────────
  async function doSubmit() {
    if (!invoice) return;
    setConfirmStage(null);
    setSubmitting(true);
    try {
      const payload = buildRefundPayload(
        invoice,
        selections,
        tenderAmounts,
        caps,
      );
      const res = await createRefundInvoice(payload);
      if (!res.ok || !res.result) {
        window.alert(res.msg ?? "Refund failed");
        return;
      }

      // Full detail for printing — 서버에서 canonical 재계산된 값으로 출력.
      let detail: SaleInvoiceDetail | null = null;
      const detailRes = await getSaleInvoiceById(res.result.id);
      if (detailRes.ok && detailRes.result) detail = detailRes.result;

      // Drawer kick — cash refund > 0 이면 먼저 열림.
      const cashRefund = payload.payments
        .filter((p) => p.type === "CASH")
        .reduce((s, p) => s + p.amount, 0);
      if (cashRefund > 0) {
        try {
          await kickDrawer();
        } catch (e) {
          console.error("kickDrawer failed:", e);
        }
      }

      // Receipt print (REFUND 분기는 printer 가 처리).
      if (detail) {
        try {
          await printSaleInvoiceReceipt(detail);
        } catch (e) {
          console.error("printSaleInvoiceReceipt failed:", e);
        }
      }

      navigate("/manager/refund");
    } catch (e) {
      console.error("refund submit failed:", e);
      window.alert("Refund failed — see console");
    } finally {
      setSubmitting(false);
    }
  }

  // Fill — 이 tender 를 refund 합계에 맞게 채움. CASH 이고 다른 non-cash tender
  // 가 없으면 round5 (PaymentModal CashInput EXACT 와 동일 원리 — D-30). 그 외
  // tender 는 정확 금액. Cap 으로 최종 clamp.
  function fillRemainingForTender(keyStr: string) {
    const cap = caps.find((c) => c.keyStr === keyStr);
    if (!cap) return;

    let otherCash = 0;
    let otherNonCash = 0;
    for (const c of caps) {
      if (c.keyStr === keyStr) continue;
      const a = tenderAmounts[c.keyStr] ?? 0;
      if (c.key.kind === "CASH") otherCash += a;
      else otherNonCash += a;
    }
    const thisIsCash = cap.key.kind === "CASH";
    const willBeCashOnly = thisIsCash && otherNonCash === 0;
    const hypothetical = willBeCashOnly
      ? Math.round(calc.subtotalBeforeRounding / 5) * 5
      : calc.subtotalBeforeRounding;
    const left = hypothetical - otherCash - otherNonCash;
    const target = Math.max(0, Math.min(cap.remaining, left));
    setTenderAmounts((prev) => ({ ...prev, [keyStr]: target }));
  }

  // ── Render ────────────────────────────────────────────────
  return (
    <div className="flex flex-col h-full bg-gray-50">
      {loading && <LoadingOverlay label="Loading invoice..." />}

      {/* Header */}
      <div className="h-14 px-4 flex items-center gap-4 border-b border-gray-200 bg-white">
        <button
          type="button"
          onPointerDown={() => navigate(-1)}
          className="px-4 py-2 rounded-lg bg-gray-100 active:bg-gray-200 text-sm font-medium"
        >
          ← Back
        </button>
        <h1 className="text-lg font-bold">Refund</h1>
        {invoice && (
          <div className="text-xs text-gray-500 flex items-center gap-4">
            <span className="font-mono">
              Original: {invoice.serial ?? `#${invoice.id}`}
            </span>
            <span>{new Date(invoice.createdAt).toLocaleString()}</span>
            <span>
              {invoice.terminalName} / {invoice.userName}
            </span>
            {invoice.memberName && <span>· {invoice.memberName}</span>}
          </div>
        )}
        <div className="flex-1" />
        {invoice && (
          <div className="flex items-center gap-2">
            <button
              type="button"
              onPointerDown={clearAll}
              className="h-9 px-3 rounded-lg bg-gray-200 text-xs font-medium active:bg-gray-300"
            >
              Clear
            </button>
            <button
              type="button"
              onPointerDown={refundAllRows}
              className="h-9 px-3 rounded-lg bg-amber-100 text-amber-800 text-xs font-bold active:bg-amber-200"
            >
              Refund All Rows
            </button>
          </div>
        )}
      </div>

      {error && !loading && (
        <div className="p-10 text-center text-red-500">{error}</div>
      )}

      {invoice && crmBlocked && (
        <div className="p-3 bg-rose-50 border-b border-rose-200 text-sm text-rose-800">
          <strong>Refund blocked.</strong> 이 invoice 는 CRM customer-voucher
          결제를 포함하고 있어 CRM online check 없이는 환불할 수 없습니다
          (D-21). 수기 기록 + 24h SLA 로 처리하세요.
        </div>
      )}

      {invoice && (
        <div className="flex-1 flex overflow-hidden">
          {/* Left — rows */}
          <div className="flex-1 overflow-auto p-4">
            <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
              Line Items
            </div>
            <div className="space-y-2">
              {invoice.rows.map((row) => (
                <RowCard
                  key={row.id}
                  row={row}
                  qty={selections[row.id] ?? 0}
                  refunds={invoice.refunds}
                  onEditQty={() => handleRowQtyTap(row)}
                  onRefundAll={() => refundAllRow(row)}
                />
              ))}
            </div>
          </div>

          {/* Right — tenders + summary */}
          <div className="w-[380px] flex-shrink-0 border-l border-gray-200 bg-white flex flex-col">
            <div className="p-4 overflow-auto flex-1">
              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-2">
                Tender Allocation
              </div>
              <div className="space-y-2">
                {caps.length === 0 ? (
                  <div className="text-sm text-gray-400 italic">
                    No tenders on original invoice
                  </div>
                ) : (
                  caps.map((c) => (
                    <TenderRow
                      key={c.keyStr}
                      cap={c}
                      amount={tenderAmounts[c.keyStr] ?? 0}
                      onEdit={() => openTenderNumpad(c.keyStr)}
                      onFill={() => fillRemainingForTender(c.keyStr)}
                      disabled={c.remaining === 0}
                    />
                  ))
                )}
              </div>

              <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mt-6 mb-2">
                Summary
              </div>
              <SummaryPane
                linesTotal={calc.linesTotal}
                creditSurchargeAmount={calc.creditSurchargeAmount}
                rounding={calc.rounding}
                total={calc.total}
                tax={calc.lineTax + calc.surchargeTax}
                paid={paid}
                remaining={remaining}
              />
            </div>

            <div className="p-4 border-t border-gray-200">
              <button
                type="button"
                disabled={!canComplete || submitting}
                onPointerDown={() => setConfirmStage("review")}
                className={cn(
                  "w-full h-14 rounded-lg text-base font-bold",
                  canComplete && !submitting
                    ? "bg-rose-600 text-white active:bg-rose-700"
                    : "bg-gray-200 text-gray-400",
                )}
              >
                {submitting ? "Processing..." : "COMPLETE REFUND"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Numpad modal */}
      {numpadTarget != null && invoice && (
        <NumpadModal
          target={numpadTarget}
          invoice={invoice}
          caps={caps}
          value={numpadValue}
          setValue={setNumpadValue}
          onConfirm={commitNumpad}
          onCancel={closeNumpad}
        />
      )}

      {/* Confirm — 2 단계. Review → Final */}
      {confirmStage === "review" && invoice && (
        <ReviewConfirmModal
          invoice={invoice}
          selections={selections}
          caps={caps}
          tenderAmounts={tenderAmounts}
          total={calc.total}
          onCancel={() => setConfirmStage(null)}
          onNext={() => setConfirmStage("final")}
        />
      )}
      {confirmStage === "final" && invoice && (
        <FinalConfirmModal
          total={calc.total}
          serial={invoice.serial ?? `#${invoice.id}`}
          onCancel={() => setConfirmStage("review")}
          onConfirm={doSubmit}
        />
      )}
    </div>
  );
}

// ── Row card ──────────────────────────────────────────────────
function RowCard({
  row,
  qty,
  refunds,
  onEditQty,
  onRefundAll,
}: {
  row: SaleInvoiceRowItem;
  qty: number;
  refunds: SaleInvoiceDetail["refunds"];
  onEditQty: () => void;
  onRefundAll: () => void;
}) {
  const cap = rowRefundable(row);
  const refundThisRow = rowRefundAmount(row, qty, refunds);
  const priceChanged = row.unit_price_effective !== row.unit_price_original;
  const exhausted = cap === 0;
  const isPrepacked =
    row.type === "PREPACKED" || row.type === "WEIGHT_PREPACKED";

  return (
    <div
      className={cn(
        "rounded-lg border bg-white p-3",
        exhausted ? "border-gray-200 opacity-60" : "border-gray-300",
        qty > 0 && "ring-2 ring-rose-400",
      )}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="font-medium text-sm truncate flex items-center gap-2">
            <span>
              {priceChanged ? "^" : ""}
              {row.taxable ? "#" : ""}
              {row.name_en}
            </span>
            <TypeBadge type={row.type} />
          </div>
          <div className="text-xs text-gray-500 mt-0.5 flex gap-3">
            <span>
              qty {fmtQty(row.qty)} {row.uom} @ {fmt(row.unit_price_effective)}
            </span>
            <span>total {fmt(row.total)}</span>
            {row.surcharge_share > 0 && (
              <span>+ surcharge {fmt(row.surcharge_share)}</span>
            )}
          </div>
          <div className="text-[11px] text-gray-400 mt-0.5">
            Refundable {fmtQty(cap)} / {fmtQty(row.qty)} {row.uom}
            {row.refunded_qty > 0 &&
              ` (already refunded ${fmtQty(row.refunded_qty)})`}
          </div>
        </div>

        {/* Right: qty button row + refund amount */}
        <div className="flex flex-col items-end gap-1.5 shrink-0">
          <div className="flex items-center gap-1.5">
            {/* prepacked 은 버튼 자체가 토글이라 All 링크 중복 — 숨김 */}
            {!isPrepacked && (
              <button
                type="button"
                disabled={exhausted}
                onPointerDown={onRefundAll}
                className={cn(
                  "h-11 px-3 rounded-lg text-xs font-bold",
                  exhausted
                    ? "bg-gray-100 text-gray-300"
                    : "bg-blue-100 text-blue-700 active:bg-blue-200",
                )}
              >
                All
                <br />
                {fmtQty(cap)}
              </button>
            )}
            <button
              type="button"
              disabled={exhausted}
              onPointerDown={onEditQty}
              className={cn(
                "min-w-[110px] h-11 px-3 rounded-lg font-mono text-base font-bold text-right",
                exhausted
                  ? "bg-gray-100 text-gray-300"
                  : qty > 0
                    ? "bg-rose-600 text-white active:bg-rose-700"
                    : "bg-gray-900 text-white active:bg-black",
              )}
            >
              {fmtQty(qty)} {row.uom}
            </button>
          </div>
          <span className="text-sm font-mono font-bold text-rose-600">
            {fmt(refundThisRow)}
          </span>
        </div>
      </div>
    </div>
  );
}

function TypeBadge({ type }: { type: SaleInvoiceRowItem["type"] }) {
  const label =
    type === "NORMAL"
      ? null
      : type === "WEIGHT"
        ? "WEIGHT"
        : type === "PREPACKED"
          ? "PACK"
          : "W-PACK";
  if (label == null) return null;
  return (
    <span className="text-[9px] font-bold bg-gray-200 text-gray-600 px-1.5 py-0.5 rounded tracking-wider">
      {label}
    </span>
  );
}

// ── Tender row ──────────────────────────────────────────────────
function TenderRow({
  cap,
  amount,
  onEdit,
  onFill,
  disabled,
}: {
  cap: TenderCapEntry;
  amount: number;
  onEdit: () => void;
  onFill: () => void;
  disabled: boolean;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border bg-gray-50 p-3",
        disabled ? "opacity-50" : "border-gray-200",
        amount > 0 && "ring-2 ring-rose-400 bg-white",
      )}
    >
      <div className="flex items-center justify-between gap-2">
        <div className="text-xs font-bold text-gray-700 truncate">
          {cap.label}
        </div>
        <div className="text-[11px] text-gray-400 shrink-0">
          cap {fmt(cap.remaining)}
          {cap.priorRefundAmount > 0 && (
            <span> (of {fmt(cap.originalAmount)})</span>
          )}
        </div>
      </div>
      <div className="flex items-center gap-2 mt-2">
        <button
          type="button"
          disabled={disabled}
          onPointerDown={onEdit}
          className={cn(
            "flex-1 h-10 rounded-lg border text-right px-3 font-mono text-sm",
            disabled
              ? "bg-gray-100 border-gray-200 text-gray-400"
              : "bg-white border-gray-300 active:bg-gray-50",
          )}
        >
          {fmt(amount)}
        </button>
        <button
          type="button"
          disabled={disabled}
          onPointerDown={onFill}
          className={cn(
            "h-10 px-2 rounded-lg text-[11px] font-bold",
            disabled
              ? "bg-gray-100 text-gray-300"
              : "bg-blue-100 text-blue-700 active:bg-blue-200",
          )}
        >
          Fill
        </button>
      </div>
    </div>
  );
}

// ── Numpad modal ───────────────────────────────────────────────
// tender → MoneyNumpad (cents string), rowQty → Numpad (decimal).
function NumpadModal({
  target,
  invoice,
  caps,
  value,
  setValue,
  onConfirm,
  onCancel,
}: {
  target: NumpadTarget;
  invoice: SaleInvoiceDetail;
  caps: TenderCapEntry[];
  value: string;
  setValue: (v: string) => void;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  let label = "";
  let capHint = "";
  let useDot = true;

  if (target.kind === "tender") {
    const c = caps.find((cc) => cc.keyStr === target.keyStr);
    label = c?.label ?? "Tender";
    capHint = c ? `Cap ${fmt(c.remaining)}` : "";
  } else {
    const row = invoice.rows.find((r) => r.id === target.rowId);
    if (row) {
      label = row.name_en;
      capHint = `Max ${fmtQty(rowRefundable(row))} ${row.uom}`;
      // NORMAL 은 정수만, WEIGHT 는 소수 허용. PREPACKED 은 이 경로 안 옴 (토글).
      useDot = row.type === "WEIGHT";
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/40 flex items-center justify-center"
      style={{ zIndex: 1000 }}
      onPointerDown={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl p-6 min-w-sm"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="text-xs font-bold text-gray-400 mb-1 uppercase tracking-wider">
          {label}
        </div>
        <div className="text-[11px] text-gray-400 mb-2">{capHint}</div>
        {target.kind === "tender" ? (
          <MoneyNumpad val={value} setVal={setValue} />
        ) : (
          <Numpad val={value} setVal={setValue} useDot={useDot} maxDp={3} />
        )}
        <div className="flex gap-2 mt-3">
          <button
            type="button"
            onPointerDown={onCancel}
            className="flex-1 h-10 rounded-lg bg-gray-200 text-sm font-bold active:bg-gray-300"
          >
            Cancel
          </button>
          <button
            type="button"
            onPointerDown={onConfirm}
            className="flex-1 h-10 rounded-lg bg-blue-600 text-white text-sm font-bold active:bg-blue-700"
          >
            Set
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Summary pane (right bottom) ─────────────────────────────────
function SummaryPane({
  linesTotal,
  creditSurchargeAmount,
  rounding,
  total,
  tax,
  paid,
  remaining,
}: {
  linesTotal: number;
  creditSurchargeAmount: number;
  rounding: number;
  total: number;
  tax: number;
  paid: number;
  remaining: number;
}) {
  return (
    <div className="space-y-1 font-mono text-sm">
      <Line label="Subtotal" value={fmt(linesTotal)} />
      {creditSurchargeAmount > 0 && (
        <Line label="Card Surcharge" value={fmt(creditSurchargeAmount)} />
      )}
      {rounding !== 0 && <Line label="Rounding" value={fmtSigned(rounding)} />}
      <hr className="border-dashed border-gray-300 my-2" />
      <div className="flex justify-between text-lg font-bold">
        <span>REFUND TOTAL</span>
        <span>{fmt(total)}</span>
      </div>
      <Line label="GST Included" value={fmt(tax)} className="text-gray-500" />
      <hr className="border-dashed border-gray-300 my-2" />
      <Line label="Paid" value={fmt(paid)} />
      <div
        className={cn(
          "flex justify-between font-bold",
          remaining === 0 && total > 0
            ? "text-emerald-600"
            : remaining > 0
              ? "text-rose-600"
              : "text-amber-600",
        )}
      >
        <span>Remaining</span>
        <span>{fmtSigned(remaining)}</span>
      </div>
    </div>
  );
}

function Line({
  label,
  value,
  className,
}: {
  label: string;
  value: string;
  className?: string;
}) {
  return (
    <div className={cn("flex justify-between", className)}>
      <span>{label}</span>
      <span>{value}</span>
    </div>
  );
}

// ── Review confirm modal (1/2) — refund 내역 한 번 훑기 ────────────────
function ReviewConfirmModal({
  invoice,
  selections,
  caps,
  tenderAmounts,
  total,
  onCancel,
  onNext,
}: {
  invoice: SaleInvoiceDetail;
  selections: RefundSelection;
  caps: TenderCapEntry[];
  tenderAmounts: Record<string, number>;
  total: number;
  onCancel: () => void;
  onNext: () => void;
}) {
  const selectedRows = invoice.rows.filter(
    (r) => (selections[r.id] ?? 0) > 0,
  );

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: 1200 }}
      onPointerDown={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl p-6 w-[440px] max-h-[85vh] overflow-auto"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-1">Review Refund</h2>
        <div className="text-xs text-gray-500 mb-4">
          Original: {invoice.serial ?? `#${invoice.id}`}
        </div>

        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">
          Items ({selectedRows.length})
        </div>
        <div className="space-y-1 mb-4 text-sm">
          {selectedRows.map((r) => {
            const q = selections[r.id] ?? 0;
            const amt = rowRefundAmount(r, q, invoice.refunds);
            return (
              <div key={r.id} className="flex justify-between gap-2">
                <span className="truncate flex-1">
                  {r.name_en}
                  <span className="text-gray-400 text-xs ml-2">
                    {fmtQty(q)} {r.uom}
                  </span>
                </span>
                <span className="font-mono shrink-0">{fmt(amt)}</span>
              </div>
            );
          })}
        </div>

        <div className="text-xs font-bold text-gray-400 uppercase tracking-wider mb-1">
          Tenders
        </div>
        <div className="space-y-1 mb-4 text-sm">
          {caps
            .filter((c) => (tenderAmounts[c.keyStr] ?? 0) > 0)
            .map((c) => (
              <div key={c.keyStr} className="flex justify-between">
                <span>{c.label}</span>
                <span className="font-mono">
                  {fmt(tenderAmounts[c.keyStr] ?? 0)}
                </span>
              </div>
            ))}
        </div>

        <hr className="border-dashed border-gray-300 my-3" />
        <div className="flex justify-between text-lg font-bold mb-4">
          <span>REFUND TOTAL</span>
          <span>{fmt(total)}</span>
        </div>

        <div className="flex gap-2">
          <button
            type="button"
            onPointerDown={onCancel}
            className="flex-1 h-11 rounded-lg bg-gray-200 text-sm font-bold active:bg-gray-300"
          >
            Cancel
          </button>
          <button
            type="button"
            onPointerDown={onNext}
            className="flex-1 h-11 rounded-lg bg-blue-600 text-white text-sm font-bold active:bg-blue-700"
          >
            Looks Good →
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Final confirm modal (2/2) — 되돌릴 수 없음 경고 후 실제 submit ─────
function FinalConfirmModal({
  total,
  serial,
  onCancel,
  onConfirm,
}: {
  total: number;
  serial: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: 1300 }}
      onPointerDown={onCancel}
    >
      <div
        className="bg-white rounded-2xl shadow-2xl p-6 w-[400px]"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold mb-2 text-rose-700">
          ⚠ Confirm Refund
        </h2>
        <p className="text-sm text-gray-700 mb-2">
          <span className="font-bold">{fmt(total)}</span> will be refunded from
          invoice <span className="font-mono">{serial}</span>.
        </p>
        <p className="text-xs text-gray-500 mb-5">
          This creates a REFUND invoice and cannot be undone from the POS.
          EFTPOS / gift card entries must be keyed in manually on the terminal.
        </p>

        <div className="flex gap-2">
          <button
            type="button"
            onPointerDown={onCancel}
            className="flex-1 h-11 rounded-lg bg-gray-200 text-sm font-bold active:bg-gray-300"
          >
            ← Back
          </button>
          <button
            type="button"
            onPointerDown={onConfirm}
            className="flex-1 h-11 rounded-lg bg-rose-600 text-white text-sm font-bold active:bg-rose-700"
          >
            REFUND NOW
          </button>
        </div>
      </div>
    </div>
  );
}
