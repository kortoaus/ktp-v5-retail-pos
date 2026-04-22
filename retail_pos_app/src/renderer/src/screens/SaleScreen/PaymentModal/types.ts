// In-progress queue entry — UI state only. On Complete, each item maps to one
// SaleInvoicePayment row. Discriminated by `tender` so each variant carries
// exactly the metadata it needs.
//
//   CASH      — cashReceived tracks what the customer handed over; `amount` is
//               what gets applied to the invoice (≤ cashReceived). Per-entry so
//               multi-cash splits don't lose change accounting.
//   CREDIT    — `amount` is the EFTPOS-keyed value (already includes surcharge,
//               D-10). No entity refs.
//   GIFTCARD  — "CREDIT without surcharge" (D-24 revised). `amount` is the
//               value charged to the card. No entity refs.
//   VOUCHER   — `entityType` discriminates user (local Voucher.id) vs customer
//               (CRM id). `entityLabel` snapshots a human-readable label that
//               will be persisted to SaleInvoicePayment.entityLabel.
export type PaymentQueueItem =
  | { key: string; tender: "CASH"; amount: number; cashReceived: number }
  | { key: string; tender: "CREDIT"; amount: number }
  | { key: string; tender: "GIFTCARD"; amount: number }
  | {
      key: string;
      tender: "VOUCHER";
      amount: number;
      entityType: "user-voucher" | "customer-voucher";
      entityId: number;
      entityLabel: string;
    };

// Distributive Omit — preserves union narrowing across each variant.
// Plain `Omit<Union, K>` collapses to the common intersection only.
// `T extends T` triggers distribution.
type DistributiveOmit<T, K extends PropertyKey> = T extends T
  ? Omit<T, K>
  : never;

// Shape that callers (Keypad, Voucher picker, etc.) hand to onAdd. The parent
// modal generates the `key` so children stay variant-shape pure.
export type PaymentQueueInput = DistributiveOmit<PaymentQueueItem, "key">;
