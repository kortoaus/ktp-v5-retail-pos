# Retail POS Architecture Evaluation

> Evaluated: 2026-03-24
> Scope: Full-stack (Electron app + Express server + PostgreSQL)
> Benchmark: Enterprise-grade POS (Woolworths-level)

## Verdict: Incremental Migration, Not Rewrite

The codebase is structurally sound. The core problem is **business logic placement** — the client is the source of truth when the server should be. This is fixable incrementally without sacrificing the battle-tested edge-case handling already in place.

---

## 1. What's Good

| Area | Assessment |
|---|---|
| Module boundaries | Clean separation — sale, shift, user, hotkey, CRM, cashio, cloud, printer |
| Server patterns | Consistent controller → service → db flow across all modules |
| Type safety | Strict TypeScript throughout, Decimal for all money math |
| State management | Zustand store well-organized, helpers properly extracted |
| Electron architecture | Correct — renderer is pure web app, serial only via IPC |
| Inter-window comms | BroadcastChannel pattern is appropriate |
| Hardware integration | Serial (scale, scanner, receipt printer, label printer) all working |
| Cloud sync | Eventual consistency pattern (sync after transaction) is correct |

## 2. The Root Problem: Server = Dumb Store

**Every critical calculation happens client-side. The server stores whatever the client sends.**

### Client-Side Calculations (should be server-authoritative)

| Calculation | Location | Risk |
|---|---|---|
| Price resolution (effective price) | `salesStore.helpers.ts` | Client bug = permanent bad data |
| Promotion application | `applyPromotions()` in helpers | No server validation of discount amounts |
| GST calculation | `usePaymentCalc.ts` | Tax reporting could be wrong |
| 5c rounding | `usePaymentCalc.ts` | Inconsistent rounding = audit issues |
| Credit surcharge | `usePaymentCalc.ts` | Rate mismatch possible |
| Per-line tax allocation (largest remainder) | `calTaxAmountByLineExact()` | Most complex calc, zero server verification |
| Shift settlement | Server computes → client receives → client sends back | Unnecessary round-trip, potential mismatch |

### Server Validation in `createSaleInvoiceService`

```
✓ rows array not empty
✓ payments array not empty
✓ total = sum(payment.amount + payment.surcharge)    ← only recalculation
✗ row.total = unit_price_effective × qty              ← NOT checked
✗ subtotal = Σ(row.total)                             ← NOT checked
✗ tax amount correctness                              ← NOT checked
✗ discount amount validity                            ← NOT checked
✗ DTO schema validation                               ← req.body passed raw
```

README confirms: "Re-enable server-side payment validation" is a known TODO.

## 3. Discount/Refund Gap (Immediate Issue)

### Current Flow

```
Sale: Cart lines (full price) + SaleStoreDiscount[] (document-level)
  → PaymentModal packages both into API payload
  → Server stores SaleInvoiceRow[] at full price
  → Server stores SaleInvoiceDiscount[] separately

Refund: Fetches RefundableInvoice with rows at full price
  → User selects rows/quantities
  → refundTotal = Σ(selectedRow.total)                 ← FULL PRICE
  → documentDiscountAmount = 0                         ← hardcoded
  → totalDiscountAmount = 0                            ← hardcoded
```

### Problem

When a sale has a promotion discount (e.g., "Buy 3 save $5"), the discount is stored ONLY at document level. Individual rows are at full price. Refund overstates the amount.

```
Example:
  Sale: 3 × $10 = $30, promotion -$5, paid $25
  Refund 1 item: row.total = $10
  Should be: $10 - ($5 × $10/$30) = $8.33
```

### Fix Required

Add `discount_amount` field to `SaleInvoiceRow` — the line's allocated share of all document-level discounts. Calculate at sale time, store permanently.

## 4. DB Schema Assessment

### Sound

- Table structure correct (Invoice → Row/Payment/Discount relationships)
- Money types appropriate (Decimal(18,2) for amounts, Decimal(18,3) for quantities)
- Indexing present on key lookup paths
- Cloud sync fields consistent (`synced`/`syncedAt`)

### Issues

| Issue | Severity | Location |
|---|---|---|
| Missing `discount_amount` on `SaleInvoiceRow` | High | `schema.prisma:458` |
| `remaining_qty/total/tax` commented out | Medium | `schema.prisma:488-490` — tried and abandoned |
| Shift money as `Int` (cents) vs Invoice as `Decimal` | Low | `TerminalShift` vs `SaleInvoice` |
| Typo: `startedCach` → `startedCash` | Low | `TerminalShift` |
| Company hardcoded to `id: 1` | Low | `terminal.middleware.ts` — fine for single-store |
| No DTO/schema validation | Medium | All controllers pass `req.body` raw |

### Not Broken

- No need for table restructuring
- Relationships are correct
- No normalization issues
- Snapshot pattern for invoice data (company info copied at sale time) is correct for POS

## 5. Code Quality Specifics

### Auth/Security

- Token format: `userId%%%timestamp` — not signed, no expiration check
- Acceptable for internal LAN POS, not for internet-facing
- Scope-based authorization works correctly (admin bypasses all)

### Error Handling

- Consistent exception hierarchy (HttpException → BadRequest/NotFound/Unauthorized/Internal)
- Cloud sync failures don't block transactions (correct)
- Client-side: `window.alert` for errors — appropriate for POS terminal

### Patterns That Work

- `numberifySaleInvoice` / `numberifyRow` for Prisma Decimal → JS number conversion
- Refundable invoice construction with remaining qty/amount tracking
- Payment cap enforcement (cash/credit/voucher caps from original payment methods)
- Voucher balance management inside transactions

## 6. What Would Break at Woolworths Scale

| Requirement | Current State | Gap |
|---|---|---|
| Server-authoritative calculations | Client calculates everything | Critical |
| Input validation | None (raw req.body) | High |
| Audit logging | None | High |
| Offline resilience | None — fails if server unreachable | High |
| Multi-store support | Hardcoded company ID 1 | Medium |
| Concurrent transaction safety | Prisma transactions (adequate) | Low |
| Proper auth | LAN-only token (adequate for scope) | Low for internal |
| Test coverage | None visible | Medium |
| Monitoring/alerting | None | Medium |

## 7. Recommended Migration Path

### Phase 1 — Immediate (discount/refund fix)

- Add `discount_amount` to `SaleInvoiceRow` (DB + types + DTOs)
- Allocate document-level discounts to lines at sale time
- Update refund flow to use `total - discount_amount`
- Scope: ~15 files across client + server

### Phase 2 — Server Authority

- Move price/tax/discount calculation to server
- Server re-computes all derived values from row data
- Client keeps calculations for UI display only
- Add Zod schema validation on all DTOs
- Server computes and stores shift settlement directly
- Scope: Major — touches all sale/refund/shift flows

### Phase 3 — Cleanup & Hardening

- Unify Int/Decimal inconsistency in shifts
- Fix `startedCach` typo (migration)
- Add integration tests for sale → refund → shift close cycle
- Add offline queue for when server is unreachable

### What NOT to Rewrite

- Hardware integration (serial, printers, scale) — battle-tested
- Barcode parsing (GTIN, PLU, EAN, prepacked price extraction)
- Receipt rendering (ESC/POS canvas)
- Korean keyboard composition
- Cloud sync
- Voucher payment system

These represent months of edge-case handling that would be lost in a rewrite.

---

## Summary

The architecture is a **single-store POS that works**. The "spaghetti" feeling comes from one structural issue: the client is the authority for business calculations. Fix this (Phase 2), and the codebase becomes enterprise-grade. The DB schema, module structure, and patterns are all sound foundations to build on.
