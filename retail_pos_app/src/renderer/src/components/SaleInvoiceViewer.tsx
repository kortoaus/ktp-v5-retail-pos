import { useEffect, useMemo, useState } from "react";
import {
  getSaleInvoiceById,
  SaleInvoiceDetail,
} from "../service/sale.service";
import { MONEY_DP, MONEY_SCALE, QTY_SCALE } from "../libs/constants";
import dayjsAU from "../libs/dayjsAU";
import { printSaleInvoiceReceipt } from "../libs/printer/sale-invoice-receipt";
import { canRepay } from "../libs/sale/can-repay";
import { useShift } from "../contexts/ShiftContext";
import PaymentModalForRepay from "./PaymentModalForRepay";

// 80mm thermal receipt 레이아웃. Direct-print 가능한 밀도/폭으로 구성.
// 한 줄 width ≈ 380px (thermal 48-char 기준), font-mono, dashed separator.
//
// Prefix 규칙 (row 이름 앞):
//   ^  price 변경됨 (override / markdown / member discount)
//   #  GST 적용 (taxable)
// 하단에 범례 포함.
//
// Type 별:
//   SALE    — 정상 영수증
//   REFUND  — "*** REFUND ***" header + originalInvoiceId 표시,
//             Payments 는 "Cash Refunded" / "Credit Refunded" 로 라벨 전환
//   SPEND   — "*** INTERNAL ***" header, Totals / Payments 생략
//             (unit price 0, payment 0 인 내부소비. row 만 나열.)

const fmt = (cents: number) =>
  `$${(Math.abs(cents) / MONEY_SCALE).toFixed(MONEY_DP)}`;
const fmtQty = (q: number) =>
  (q / QTY_SCALE).toFixed(3).replace(/\.?0+$/, "");

interface Props {
  invoiceId: number | null;
  onClose: () => void;
}

export default function SaleInvoiceViewer({ invoiceId, onClose }: Props) {
  const [invoice, setInvoice] = useState<SaleInvoiceDetail | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [printing, setPrinting] = useState(false);
  const [repayOpen, setRepayOpen] = useState(false);

  const { shift } = useShift();

  // 10분 타이머용 tick — invoice 가 repay 가능한 상태일 때만 작동 시키면 되지만
  // 간단히 항상 1초마다 갱신. 컴포넌트 mount 중일 때만.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  async function handlePrint() {
    if (!invoice || printing) return;
    setPrinting(true);
    try {
      // Viewer 에서 뽑으면 항상 "** COPY **" 표시 — 최초 영수증은 complete flow 에서 이미 출력.
      await printSaleInvoiceReceipt(invoice, true);
    } catch (e) {
      console.error("print failed:", e);
      window.alert("Failed to print");
    } finally {
      setPrinting(false);
    }
  }

  async function reloadInvoice() {
    if (invoiceId == null) return;
    const res = await getSaleInvoiceById(invoiceId);
    if (res.ok && res.result) setInvoice(res.result);
  }

  useEffect(() => {
    if (invoiceId == null) return;
    setInvoice(null);
    setError("");
    setLoading(true);
    getSaleInvoiceById(invoiceId).then((res) => {
      if (res.ok && res.result) setInvoice(res.result);
      else setError(res.msg || "Failed to load invoice");
      setLoading(false);
    });
  }, [invoiceId]);

  // Repay 적격 여부 — 조건 불만족 시 버튼 아예 숨김 (R4).
  const repayCheck = useMemo(() => {
    if (!invoice) return { ok: false as const };
    return canRepay(invoice, shift?.id, now);
  }, [invoice, shift?.id, now]);

  if (invoiceId == null) return null;

  return (
    <>
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: 1500 }}
      onPointerDown={onClose}
    >
      <div
        className="bg-white rounded-lg max-h-[90vh] overflow-auto shadow-2xl"
        onPointerDown={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 bg-white border-b border-gray-200 flex items-center justify-between px-3 h-12 z-10">
          <h2 className="font-bold text-sm">Invoice</h2>
          <div className="flex items-center gap-2">
            {repayCheck.ok && (
              <button
                type="button"
                onPointerDown={() => setRepayOpen(true)}
                className="h-9 px-3 rounded-lg bg-amber-500 text-white text-sm font-bold active:bg-amber-600"
              >
                Repay
              </button>
            )}
            <button
              type="button"
              disabled={!invoice || printing}
              onPointerDown={handlePrint}
              className="h-9 px-3 rounded-lg bg-blue-600 text-white text-sm font-bold active:bg-blue-700 disabled:opacity-40"
            >
              {printing ? "Printing..." : "Print Copy"}
            </button>
            <button
              type="button"
              onPointerDown={onClose}
              className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-500 active:bg-gray-200 text-xl"
            >
              ✕
            </button>
          </div>
        </div>
        {loading && (
          <div className="w-[380px] p-10 text-center text-gray-400 font-mono text-sm">
            Loading...
          </div>
        )}
        {error && !loading && (
          <div className="w-[380px] p-10 text-center text-red-500 font-mono text-sm">
            {error}
          </div>
        )}
        {invoice && <RefundStatusBar invoice={invoice} />}
        {invoice && <Receipt invoice={invoice} />}
      </div>
    </div>
    {/* Repay 모달은 viewer 의 backdrop 밖 (sibling) — backdrop onPointerDown 으로
        인한 pointerdown 버블링 전파 방지. 모달 자체도 fixed inset-0 이라 위치 동일. */}
    {invoice && repayOpen && repayCheck.ok && repayCheck.expiresAt != null && (
      <PaymentModalForRepay
        invoice={invoice}
        expiresAt={repayCheck.expiresAt}
        onClose={() => setRepayOpen(false)}
        onSuccess={() => {
          // 원본 invoice 에 refund 자식이 추가됨 → reload 로 "FULLY REFUNDED"
          // 배너 + Repay 버튼 자동 숨김.
          void reloadInvoice();
        }}
      />
    )}
    </>
  );
}

// SALE invoice 전용 — refund 상태 표시. 부분 환불 / 전체 환불 여부 + refund
// children serial 리스트. 영수증 자체에는 안 들어감 (print 는 receipt 만).
function RefundStatusBar({ invoice }: { invoice: SaleInvoiceDetail }) {
  if (invoice.type !== "SALE") return null;
  // Defensive: repay-생성 SALE 이 같은 originalInvoiceId 를 공유 → 이 배너에
  // 끼면 "REFUNDED" 로 오인. 서버 필터가 있지만 타입 가드로 한 번 더.
  const refunds = (invoice.refunds ?? []).filter((r) => r.type === "REFUND");
  if (refunds.length === 0) return null;

  const totalQty = invoice.rows.reduce((s, r) => s + r.qty, 0);
  const refundedQty = invoice.rows.reduce((s, r) => s + r.refunded_qty, 0);
  const fullyRefunded = totalQty > 0 && refundedQty >= totalQty;
  const partially = refundedQty > 0 && !fullyRefunded;

  return (
    <div
      className={
        "w-[380px] px-4 py-2 border-b border-gray-200 " +
        (fullyRefunded ? "bg-rose-50" : "bg-amber-50")
      }
    >
      <div className="flex items-center justify-between">
        <span className="text-xs font-bold tracking-wider">
          {fullyRefunded
            ? "FULLY REFUNDED"
            : partially
              ? "PARTIALLY REFUNDED"
              : ""}
        </span>
        <span className="text-[10px] text-gray-500">
          {refunds.length} refund{refunds.length > 1 ? "s" : ""}
        </span>
      </div>
      <div className="mt-1 space-y-0.5">
        {refunds.map((r) => (
          <div
            key={r.id}
            className="flex justify-between text-[11px] text-gray-600 font-mono"
          >
            <span>{r.serial ?? `#${r.id}`}</span>
            <span>{new Date(r.createdAt).toLocaleString()}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function Receipt({ invoice }: { invoice: SaleInvoiceDetail }) {
  const isRefund = invoice.type === "REFUND";
  const isSpend = invoice.type === "SPEND";
  const date = dayjsAU(invoice.createdAt);
  const locality = [invoice.suburb, invoice.state, invoice.postcode]
    .filter(Boolean)
    .join(" ");

  // Tender 별 집계 (SPEND 은 비어있음).
  const byTender = invoice.payments.reduce<Record<string, number>>(
    (acc, p) => {
      acc[p.type] = (acc[p.type] ?? 0) + p.amount;
      return acc;
    },
    {},
  );
  const cashPaid = byTender.CASH ?? 0;
  const creditPaid = byTender.CREDIT ?? 0;
  const voucherPaid = byTender.VOUCHER ?? 0;
  const giftcardPaid = byTender.GIFTCARD ?? 0;

  // Voucher 상세 (entityLabel 별도 표기용).
  const voucherPayments = invoice.payments.filter((p) => p.type === "VOUCHER");

  const tax = invoice.lineTax + invoice.surchargeTax;

  // You Saved — per-row 절약액 합 (D-17, line-level 만 존재).
  const totalSaved = invoice.rows.reduce((s, r) => {
    if (r.unit_price_effective >= r.unit_price_original) return s;
    const original = Math.round((r.unit_price_original * r.qty) / QTY_SCALE);
    return s + (original - r.total);
  }, 0);

  const headerLabel = isRefund
    ? "*** REFUND ***"
    : isSpend
      ? "*** INTERNAL ***"
      : invoice.abn
        ? "TAX INVOICE"
        : "INVOICE";

  return (
    <div className="w-[380px] bg-white p-6 font-mono text-sm leading-relaxed text-black">
      {/* Header — store snapshot 중앙 정렬 */}
      <div className="text-center mb-4">
        <div className="text-lg font-bold">{invoice.companyName}</div>
        {invoice.address1 && <div>{invoice.address1}</div>}
        {invoice.address2 && <div>{invoice.address2}</div>}
        {locality && <div>{locality}</div>}
        <div className="mt-1">{headerLabel}</div>
        {!isRefund && !isSpend && invoice.abn && <div>ABN {invoice.abn}</div>}
        {invoice.phone && <div>Ph: {invoice.phone}</div>}
      </div>

      <Dashed />

      {/* Meta */}
      <div className="text-xs space-y-0.5">
        <div className="flex justify-between">
          <span>
            {isRefund ? "Refund Invoice" : isSpend ? "Spend Doc" : "Invoice"}
          </span>
          <span>{invoice.serial ?? `#${invoice.id}`}</span>
        </div>
        {isRefund && invoice.originalInvoiceId != null && (
          <div className="flex justify-between">
            <span>Original Invoice</span>
            <span>#{invoice.originalInvoiceId}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Date</span>
          <span>{date.format("ddd, DD MMM YYYY hh:mm A")}</span>
        </div>
        <div className="flex justify-between">
          <span>Terminal</span>
          <span>{invoice.terminalName ?? "—"}</span>
        </div>
        <div className="flex justify-between">
          <span>Cashier</span>
          <span>{invoice.userName ?? "—"}</span>
        </div>
        {invoice.memberName && (
          <div className="flex justify-between">
            <span>Member</span>
            <span>
              {invoice.memberName}
              {invoice.memberLevel != null && ` (L${invoice.memberLevel})`}
            </span>
          </div>
        )}
      </div>

      <Dashed />

      {/* Rows */}
      <div className="space-y-2">
        {invoice.rows.map((r) => {
          const priceChanged =
            r.unit_price_effective !== r.unit_price_original;
          const prefix = (priceChanged ? "^" : "") + (r.taxable ? "#" : "");

          let qtyStr: string;
          if (r.measured_weight && r.measured_weight > 0) {
            qtyStr = `${fmtQty(r.measured_weight)}${r.uom} @ ${fmt(r.unit_price_effective)}/${r.uom}`;
          } else {
            qtyStr = `${fmtQty(r.qty)} @ ${fmt(r.unit_price_effective)}`;
          }

          let totalStr = fmt(r.total);
          if (priceChanged) {
            qtyStr += ` (was ${fmt(r.unit_price_original)})`;
            const original = Math.round(
              (r.unit_price_original * r.qty) / QTY_SCALE,
            );
            const saved = original - r.total;
            if (saved > 0) totalStr = `(!${fmt(saved)}) ` + totalStr;
          }

          return (
            <div key={r.id}>
              <div>
                {prefix}
                {r.name_en}
              </div>
              <div className="flex justify-between text-xs text-gray-600 pl-2">
                <span>{qtyStr}</span>
                <span>{isSpend ? "—" : totalStr}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Totals / Payments / Tax — SPEND 은 전부 생략 */}
      {!isSpend && (
        <>
          <Dashed />

          <div className="space-y-1">
            <div className="flex justify-between">
              <span>{invoice.rows.length} SUBTOTAL</span>
              <span>{fmt(invoice.linesTotal)}</span>
            </div>
            {invoice.creditSurchargeAmount > 0 && (
              <div className="flex justify-between">
                <span>Card Surcharge</span>
                <span>+{fmt(invoice.creditSurchargeAmount)}</span>
              </div>
            )}
            {invoice.rounding !== 0 && (
              <div className="flex justify-between">
                <span>Rounding</span>
                <span>
                  {invoice.rounding > 0 ? "+" : "-"}
                  {fmt(invoice.rounding)}
                </span>
              </div>
            )}
          </div>

          <Dashed />

          <div className="flex justify-between text-lg font-bold">
            <span>{isRefund ? "REFUND TOTAL" : "TOTAL"}</span>
            <span>{fmt(invoice.total)}</span>
          </div>

          <Dashed />

          <div className="space-y-1">
            {cashPaid > 0 &&
              (isRefund ? (
                <div className="flex justify-between">
                  <span>Cash Refunded</span>
                  <span>{fmt(cashPaid)}</span>
                </div>
              ) : (
                <>
                  <div className="flex justify-between">
                    <span>Cash Received</span>
                    <span>{fmt(cashPaid + invoice.cashChange)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span>Cash Paid</span>
                    <span>{fmt(cashPaid)}</span>
                  </div>
                </>
              ))}
            {!isRefund && invoice.cashChange > 0 && (
              <div className="flex justify-between">
                <span>Change</span>
                <span>{fmt(invoice.cashChange)}</span>
              </div>
            )}
            {creditPaid > 0 && (
              <div className="flex justify-between">
                <span>{isRefund ? "Credit Refunded" : "Credit Paid"}</span>
                <span>{fmt(creditPaid)}</span>
              </div>
            )}
            {voucherPaid > 0 && (
              <div className="flex justify-between">
                <span>{isRefund ? "Voucher Refunded" : "Voucher Paid"}</span>
                <span>{fmt(voucherPaid)}</span>
              </div>
            )}
            {giftcardPaid > 0 && (
              <div className="flex justify-between">
                <span>
                  {isRefund ? "Gift Card Refunded" : "Gift Card Paid"}
                </span>
                <span>{fmt(giftcardPaid)}</span>
              </div>
            )}
          </div>

          <Dashed />

          <div className="space-y-1">
            <div className="flex justify-between">
              <span>GST Included</span>
              <span>{fmt(tax)}</span>
            </div>
            {totalSaved > 0 && (
              <div className="flex justify-between">
                <span>You Saved</span>
                <span>{fmt(totalSaved)}</span>
              </div>
            )}
          </div>

          {voucherPayments.length > 0 && (
            <>
              <Dashed />
              <div className="text-xs text-gray-500 mb-1">
                {isRefund ? "Vouchers Refunded" : "Vouchers Used"}
              </div>
              <div className="space-y-0.5 text-xs">
                {voucherPayments.map((p) => (
                  <div key={p.id} className="flex justify-between gap-2">
                    <span className="truncate">
                      {p.entityLabel ?? "Voucher"}
                    </span>
                    <span className="shrink-0">{fmt(p.amount)}</span>
                  </div>
                ))}
              </div>
            </>
          )}

          <Dashed />

          <div className="text-xs text-gray-500">
            ^ = price changed &nbsp; # = GST applicable &nbsp; ! = Saved
          </div>
        </>
      )}

      <div className="text-center mt-3 text-gray-500">
        {isSpend
          ? "Internal consumption — no payment"
          : isRefund
            ? "Refund processed"
            : "Thank you!"}
      </div>
    </div>
  );
}

function Dashed() {
  return <hr className="border-dashed border-gray-400 my-3" />;
}
