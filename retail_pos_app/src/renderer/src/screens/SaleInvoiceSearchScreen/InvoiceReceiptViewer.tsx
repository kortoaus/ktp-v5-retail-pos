import { SaleInvoice } from "../../types/models";
import dayjsAU from "../../libs/dayjsAU";

const fmt = (n: number) => `$${Math.abs(n).toFixed(2)}`;

export default function InvoiceReceiptViewer({
  invoice,
}: {
  invoice: SaleInvoice;
}) {
  const isRefund = invoice.type === "refund";
  const date = dayjsAU(invoice.issuedAt);
  const locality = [invoice.suburb, invoice.state, invoice.postcode]
    .filter(Boolean)
    .join(" ");

  let totalCents = Math.round(invoice.total * 100);
  for (const p of invoice.payments) {
    if (p.type === "credit") {
      totalCents += Math.round(p.surcharge * 100);
    }
  }

  return (
    <div className="max-w-[380px] mx-auto bg-white p-6 font-mono text-sm leading-relaxed">
      <div className="text-center mb-4">
        <div className="text-lg font-bold">{invoice.companyName}</div>
        {invoice.address1 && <div>{invoice.address1}</div>}
        {invoice.address2 && <div>{invoice.address2}</div>}
        {locality && <div>{locality}</div>}
        <div className="mt-1">
          {isRefund
            ? "*** REFUND ***"
            : invoice.abn
              ? `TAX INVOICE - ABN ${invoice.abn}`
              : "TAX INVOICE"}
        </div>
        {!isRefund && invoice.abn && <div>ABN {invoice.abn}</div>}
        {invoice.phone && <div>Ph: {invoice.phone}</div>}
      </div>

      <hr className="border-dashed border-gray-400 my-3" />

      <div className="text-xs space-y-0.5">
        {invoice.serialNumber && (
          <div className="flex justify-between">
            <span>{isRefund ? "Refund Invoice" : "Invoice"}</span>
            <span>{invoice.serialNumber}</span>
          </div>
        )}
        {isRefund && invoice.original_invoice_serialNumber && (
          <div className="flex justify-between">
            <span>Original Invoice</span>
            <span>{invoice.original_invoice_serialNumber}</span>
          </div>
        )}
        <div className="flex justify-between">
          <span>Date</span>
          <span>{date.format("ddd, DD MMM YYYY hh:mm A")}</span>
        </div>
        <div className="flex justify-between">
          <span>Terminal</span>
          <span>{invoice.terminal.name}</span>
        </div>
        {invoice.memberLevel != null && invoice.memberLevel > 0 && (
          <div className="flex justify-between">
            <span>Member</span>
            <span>Level {invoice.memberLevel}</span>
          </div>
        )}
      </div>

      <hr className="border-dashed border-gray-400 my-3" />

      <div className="space-y-2">
        {invoice.rows.map((r) => {
          const priceChanged =
            r.unit_price_effective !== r.unit_price_original;
          const prefix =
            (priceChanged ? "^" : "") + (r.taxable ? "#" : "");
          let qtyStr: string;
          if (r.type === "weight-prepacked") {
            qtyStr = `1 @ ${fmt(r.total)}`;
          } else if (r.measured_weight !== null) {
            qtyStr = `${r.measured_weight}${r.uom} @ ${fmt(r.unit_price_effective)}/${r.uom}`;
          } else {
            qtyStr = `${r.qty} @ ${fmt(r.unit_price_effective)}`;
          }
          if (priceChanged) {
            qtyStr += ` (${fmt(r.unit_price_original)})`;
          }
          return (
            <div key={r.id}>
              <div>
                {prefix}
                {r.name_en}
              </div>
              <div className="flex justify-between text-xs text-gray-600 pl-2">
                <span>{qtyStr}</span>
                <span>{fmt(r.total)}</span>
              </div>
            </div>
          );
        })}
      </div>

      <hr className="border-dashed border-gray-400 my-3" />

      <div className="space-y-1">
        <div className="flex justify-between">
          <span>{invoice.rows.length} SUBTOTAL</span>
          <span>{fmt(invoice.subtotal)}</span>
        </div>
        {invoice.documentDiscountAmount > 0 && (
          <div className="flex justify-between text-red-600">
            <span>Discount</span>
            <span>-{fmt(invoice.documentDiscountAmount)}</span>
          </div>
        )}
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

      <hr className="border-dashed border-gray-400 my-3" />

      <div className="flex justify-between text-lg font-bold">
        <span>{isRefund ? "REFUND TOTAL" : "TOTAL"}</span>
        <span>{fmt(totalCents / 100)}</span>
      </div>

      <hr className="border-dashed border-gray-400 my-3" />

      <div className="space-y-1">
        {invoice.cashPaid > 0 && (
          isRefund ? (
            <div className="flex justify-between">
              <span>Cash Refunded</span>
              <span>{fmt(invoice.cashPaid)}</span>
            </div>
          ) : (
            <>
              <div className="flex justify-between">
                <span>Cash Received</span>
                <span>{fmt(invoice.cashPaid + invoice.cashChange)}</span>
              </div>
              <div className="flex justify-between">
                <span>Cash Paid</span>
                <span>{fmt(invoice.cashPaid)}</span>
              </div>
            </>
          )
        )}
        {!isRefund && invoice.cashChange > 0 && (
          <div className="flex justify-between">
            <span>Change</span>
            <span>{fmt(invoice.cashChange)}</span>
          </div>
        )}
        {invoice.creditPaid > 0 && (
          <div className="flex justify-between">
            <span>{isRefund ? "Credit Refunded" : "Credit Paid"}</span>
            <span>{fmt(isRefund ? invoice.creditPaid : invoice.creditPaid + invoice.creditSurchargeAmount)}</span>
          </div>
        )}
      </div>

      <hr className="border-dashed border-gray-400 my-3" />

      <div className="space-y-1">
        <div className="flex justify-between">
          <span>GST Included</span>
          <span>{fmt(invoice.taxAmount)}</span>
        </div>
        {invoice.totalDiscountAmount > 0 && (
          <div className="flex justify-between text-green-600">
            <span>You Saved</span>
            <span>{fmt(invoice.totalDiscountAmount)}</span>
          </div>
        )}
      </div>

      <hr className="border-dashed border-gray-400 my-3" />

      <div className="text-xs text-gray-500">
        ^ = price changed &nbsp; # = GST applicable
      </div>
      <div className="text-center mt-3 text-gray-400">{isRefund ? "Refund processed" : "Thank you!"}</div>
    </div>
  );
}