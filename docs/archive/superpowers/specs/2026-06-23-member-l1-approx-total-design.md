# Member Level 1 Approx Total Marketing Display

## Purpose

Show non-member shoppers how much the current cart would approximately cost if
they were a level 1 member. This is a marketing prompt only. It must not change
the cart, payment calculation, sale payload, receipt, points, voucher behavior,
or invoice totals.

## User Experience

When the active cart has no member attached, calculate a level 1 member version
of the current cart total and show it in two places:

- Payment modal: a small line above the Complete button.
  - Text: `Member total approx: $X.XX`
  - Show only when the level 1 total is lower than the current line total.
- Customer display: a larger, more visible marketing line near the cart total.
  - Primary text: `Member total approx: $X.XX`
  - Secondary text: `Join & save $Y.YY`
  - Show only when the level 1 total is lower than the current line total.

When a member is already attached, show nothing. Existing member pricing already
applies to the cart, so the comparison would be redundant.

## Calculation

Add a renderer-side pure helper for the marketing estimate. The helper receives
the current `SaleLineType[]` and calculates:

- current line total: sum of `line.total`
- level 1 line total: each line recalculated as if automatic price resolution
  used `memberLevel = 1`
- savings: `current line total - level 1 line total`

The level 1 recalculation must reuse the same pricing rules as the cart:

- `price.prices[0]` is public price.
- `price.prices[1]` is level 1 member price.
- `promoPrice.prices[0..1]` participates the same way as normal cart
  recalculation.
- The lowest valid automatic price below the original public price wins.
- Quantity scaling remains `QTY_SCALE`.
- Tax is not needed for the displayed estimate, but recalculating via existing
  line helpers is acceptable if it keeps behavior aligned.

Manual price overrides are preserved. For lines with `unit_price_adjusted !=
null` and no `ppMarkdown`, the estimate should not pretend level 1 pricing
beats the cashier override. This matches `recalculateCartLines`.

Prepacked markdown lines with `ppMarkdown` should re-apply the markdown on top
of the level 1 automatic base, matching existing member-change behavior.

## PaymentModal Boundary

Do not add this to `usePaymentCal`. That hook owns real settlement math:

- cash rounding
- credit surcharge
- staged and committed payments
- paid / remaining / change
- points calculation
- invoice total invariant

The marketing estimate is not a payment total. It should remain a separate
line-total estimate so it does not move with staged tender state, cash rounding,
or card surcharge.

## Customer Display Boundary

The customer display already receives cart state through `BroadcastChannel` and
stores it in the same Zustand sales store. No new IPC or broadcast payload is
needed.

The same pure helper should be used by both the payment modal and
`DocumentMonitor` / customer display area so the displayed numbers stay
consistent.

## Rendering Rules

Show the estimate only when all conditions are true:

- active cart has at least one line
- active cart has no member
- estimated level 1 total is greater than 0
- estimated level 1 total is lower than current line total

Do not show a zero-saving message.

## Files Expected To Change

- `retail_pos_app/src/renderer/src/libs/sale/member-level-estimate.ts`
  - new pure helper for current total, level 1 total, and savings
- `retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx`
  - small display above the Complete button
- `retail_pos_app/src/renderer/src/screens/SaleScreen/DocumentMonitor.tsx`
  - larger display for customer mode
  - compact display or no display for cashier mode, unless layout space is
    needed for the payment modal only

If a better existing location for cart-pricing helpers appears during
implementation, use that instead while keeping the helper renderer-only and
pure.

## Validation

Because the app has no configured test runner, validation should use:

- focused TypeScript build: `cd retail_pos_app && npm run build`
- manual UI check:
  - non-member cart with an item that has a level 1 price shows the estimate
  - member cart hides the estimate
  - non-member cart with no level 1 saving hides the estimate
  - PaymentModal totals and Complete button behavior remain unchanged
  - customer display shows the larger estimate

## Out Of Scope

- Saving the estimate to invoice rows or payments
- Changing sale totals, rounding, surcharge, points, vouchers, or payload shape
- Adding a new member signup flow
- Showing the estimate on receipts
- Server-side changes
