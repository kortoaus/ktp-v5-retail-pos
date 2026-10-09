import db from "../../libs/db";

// ══════════════════════════════════════════════════════════════════════════════
// T-25 (platform; T-14 V-11) — short CRM reconciliation block for a shift's
// settlement (close screen + printed Z-report), from the T-15 ledger.
//
//   redeemed      REDEEM rows LINKED to this shift's invoices (count, cents)
//   refundIssued  REFUND_ISSUE rows LINKED to this shift's invoices (count, cents)
//   voided        REDEEM / REFUND_ISSUE rows VOIDED, created during the shift
//   unresolved    REDEEM / REFUND_ISSUE rows still open (INTENT / UNRESOLVED /
//                 UNRESOLVED_MANUAL / CONFIRMED without invoice), created
//                 during the shift
//
// Voided and unresolved rows have no invoice, and the ledger keeps no terminal,
// so those two are store-wide counts for the shift's time window (labelled so).
// Never throws: an unreadable ledger answers null and the settlement prints
// without the block.
// ══════════════════════════════════════════════════════════════════════════════

export interface CustomerVoucherShiftReconciliation {
  redeemed: { count: number; amount: number };
  refundIssued: { count: number; amount: number };
  voided: number;
  unresolved: number;
}

type LedgerRow = {
  kind: string;
  status: string;
  amount: number;
  invoiceId: number | null;
};

export interface ShiftSummaryDb {
  saleInvoice: { findMany(args: unknown): Promise<Array<{ id: number }>> };
  customerVoucherOperation: { findMany(args: unknown): Promise<LedgerRow[]> };
}

const PRIMARY = ["REDEEM", "REFUND_ISSUE"];
const OPEN = ["INTENT", "UNRESOLVED", "UNRESOLVED_MANUAL"];

export function summarizeShiftLedger(
  linked: LedgerRow[],
  windowRows: LedgerRow[],
): CustomerVoucherShiftReconciliation {
  const out: CustomerVoucherShiftReconciliation = {
    redeemed: { count: 0, amount: 0 },
    refundIssued: { count: 0, amount: 0 },
    voided: 0,
    unresolved: 0,
  };
  for (const row of linked) {
    if (row.status !== "LINKED") continue;
    const bucket = row.kind === "REDEEM" ? out.redeemed : row.kind === "REFUND_ISSUE" ? out.refundIssued : null;
    if (!bucket) continue;
    bucket.count += 1;
    bucket.amount += row.amount;
  }
  for (const row of windowRows) {
    if (!PRIMARY.includes(row.kind)) continue;
    if (row.status === "VOIDED") out.voided += 1;
    else if (OPEN.includes(row.status) || (row.status === "CONFIRMED" && row.invoiceId == null))
      out.unresolved += 1;
  }
  return out;
}

export async function customerVoucherShiftReconciliation(
  shift: { id: number; openedAt: Date; closedAt: Date | null },
  client: ShiftSummaryDb = db as unknown as ShiftSummaryDb,
  now: () => Date = () => new Date(),
): Promise<CustomerVoucherShiftReconciliation | null> {
  try {
    const invoices = await client.saleInvoice.findMany({
      where: { shiftId: shift.id },
      select: { id: true },
    });
    const invoiceIds = invoices.map((inv) => inv.id);
    const linked =
      invoiceIds.length === 0
        ? []
        : await client.customerVoucherOperation.findMany({
            where: { kind: { in: PRIMARY }, status: "LINKED", invoiceId: { in: invoiceIds } },
            select: { kind: true, status: true, amount: true, invoiceId: true },
          });
    const windowRows = await client.customerVoucherOperation.findMany({
      where: {
        kind: { in: PRIMARY },
        createdAt: { gte: shift.openedAt, lte: shift.closedAt ?? now() },
        status: { in: ["VOIDED", "CONFIRMED", ...OPEN] },
      },
      select: { kind: true, status: true, amount: true, invoiceId: true },
    });
    return summarizeShiftLedger(linked, windowRows);
  } catch (e) {
    console.error("[customer-voucher] shift reconciliation summary failed", e);
    return null;
  }
}
