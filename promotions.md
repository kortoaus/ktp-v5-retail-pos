# Promotions System — Design Reference

## Woolworths Australia — Complete Promotion Taxonomy

### Yellow Ticket (Short-term, weekly/fortnightly)

| Type | Mechanic | Example | POS Impact |
|---|---|---|---|
| **Specials** | % or $ off shelf price | "Half price", "40% off", "Save $2.50" | Simple per-item price override |
| **Multi-buy (Buy More Save More)** | N items for fixed total | "2 for $5", "3 for $10" | Cart-level: track qty across lines, split discount |
| **Multi-buy (Mix and Save)** | N items from a GROUP for fixed total | "Any 3 for $10" across a family | Cart-level: cross-item, same family |
| **Multi-buy (Save $X)** | Buy N, save flat amount | "Buy 2 save $3" | Cart-level: discount = flat $3 split across 2 |
| **Multi-buy (Save %)** | Buy N, save percentage | "Buy any 2 save 20%" | Cart-level: % off cheapest or all |
| **Multi-buy (N for N-1)** | Buy N pay for N-1 | "Buy 3 for 2", "Buy 4 pay for 3" | Cart-level: cheapest item free |
| **Fresh Specials** | Market price drop on seasonal produce | "Australian Grapes $3.90/kg" | Simple per-item price |
| **Online Only Specials** | Online-exclusive discount | "$2 off online" | Per-item, channel-specific |
| **Clearance** | Discontinued/near-expiry markdown | "Was $5, now $2" | Per-item price |
| **Seasonal Price** | Whole-season lower price | "Autumn Price $4.50" | Per-item price (long-lived) |

### Red Ticket (Long-term, months)

| Type | Mechanic | POS Impact |
|---|---|---|
| **Everyday Low Price** | Permanent best price, never goes on Special | Per-item base price (not a "promo") |
| **Lower Shelf Price** | Long-term reduction, may still go on Special | Per-item base price change |
| **Prices Dropped** | Was/now pricing | Per-item with "was" reference |

### Everyday Rewards Member-Only

| Type | Mechanic | POS Impact |
|---|---|---|
| **Member Price** | Exclusive lower price for scanned members | Per-item, handled by `prices[level]` |
| **Booster Offers** | Personalised bonus points (activate in app) | Loyalty backend, NOT POS-level |
| **Spend & Save** | "Spend $50 on category X, save $15" | Basket-level threshold trigger |
| **Points Multiplier** | "5x points this shop" | Loyalty backend |
| **Orange Friday** | 50% off member event | Per-item Special |

### Basket-Level / Cross-Promo

| Type | Mechanic | POS Impact |
|---|---|---|
| **BWS Spend & Save** | "Spend $100 on liquor, save $20" | Basket-level threshold |
| **First Order Discount** | "$30 off first online shop over $140" | Online-only, basket-level |
| **Fuel Discount** | "Spend $30+ save 4¢/L" | Loyalty backend, NOT POS-level |

---

## POS Implementation Tiers

### Tier 1 — Already Handled

Specials, Fresh Specials, Seasonal, Clearance, Everyday Low Price, Lower Shelf Price — all just **per-item price changes** (`promoPrice` / `prices[level]`). Member Price — **member level pricing** already works.

### Tier 2 — The Gap (Multi-buy / Mix & Match)

Industry-standard rule types from SwiftPOS (Australian POS system):

| Rule | Example | Mechanic |
|---|---|---|
| **Volume Discount** | Buy 2+ for $10.99 each | Same-item qty threshold, per-unit price |
| **Buy X Get X** | Buy 1 get 1 free (BOGOF) | Same-family, cheapest item free |
| **Buy X Get Y** | Buy 12 wines get 1 beer free | Cross-family trigger |
| **Buy X Money Get Y** | Spend $50 on wine, get cheese free | Dollar-threshold trigger |
| **Buy X Get Multiple Offer** | Buy 2 → 10% off, Buy 4 → 20% off | Tiered volume discount |
| **Buy X & Y for Z** | Coffee + Muffin = $6 | 2-family combo, fixed total |
| **Buy A, B & C for Z** | Burger + Drink + Fries = $12 | 3-family combo, fixed total |
| **Max Allowed in Sale** | Max 2 per customer | Limit, not discount |

**Key rule**: Discounts (except Volume) always apply to the **cheapest qualifying item**.

**Evaluation order** (from SwiftPOS):

1. Member Campaigns
2. Max Allowed X in Sale
3. Buy X Get X (highest qty trigger first)
4. Buy X Get Y (highest qty trigger first)
5. Volume Discount (only on products with no other rules applied)
6. Buy X Get Multiple

### Tier 3 — Loyalty Backend (Not POS Scope)

Points boosters, fuel discounts, spend & get points — all happen in loyalty backend, not at POS line level.

---

## Current Architecture Analysis

### Pricing Pipeline (salesStore.ts)

```
unit_price_original → unit_price_discounted (member/promo) → unit_price_adjusted (manual) → unit_price_effective
```

- All calculations are **per-line** (`recalculateLine` operates on a single line)
- `recalculateAllLines` exists for member changes (cart-wide recalc precedent)
- `adjustments[]` tracks what was modified: `PRICE_OVERRIDE | QTY_OVERRIDE | DISCOUNT_OVERRIDE`
- No cross-line awareness, no bundle grouping, no promo identity on lines

### Design Decision: Separate Discount Layer

Promotions will be calculated **separately from the line pricing pipeline** and applied as a discount layer. This avoids collision with member-level pricing and manual overrides.

```
Line pricing pipeline (unchanged):
  original → discounted (member/promo) → adjusted (manual) → effective

Promo discount (new, runs AFTER):
  evaluate cart lines → compute discount from effective prices → attach to lines
```

### Hook Points

| Location | Current | Promo Use |
|---|---|---|
| `adjustments[]` | `PRICE_OVERRIDE`, `QTY_OVERRIDE`, `DISCOUNT_OVERRIDE` | Extend with `BUNDLE_PROMO` |
| `unit_price_adjusted` | Manual price override (priority 0) | Potential conflict — needs priority chain |
| `recalculateAllLines()` | Runs on member change | Pattern for cart-wide promo evaluation |
| `addLine` / `removeLine` / `changeLineQty` | Individual line mutations | Post-mutation: re-evaluate all promos |

### Open Questions

- Where do promo rules come from — server-fetched config or hardcoded?
- Should the "free" item show as a separate line (qty=1 @ $0) or stay merged?
- Can a cashier override price on a promo'd item (manual override trumps promo)?
- Priority: manual override > promo adjustment > member discount > original?
- Merge strategy: abandon merge for promo-eligible items, or split lines when promo applies?

---

## Sources

- Woolworths official pricing: https://www.woolworths.com.au/shop/articles/value
- SwiftPOS Mix & Match: https://www.pos.com.au/Help-SP/MixandMatchOverview.html
- SwiftPOS Volume Discount Rule: https://www.pos.com.au/Help-SP/MnM-VolumeDiscountRule.html
- Everyday Rewards Member Price: https://www.everyday.com.au/rewards/how-it-works/member-price.html
- Woolworths SA multi-buy variants: https://www.woolworths.co.za/cat/Food/Promotions/Buy-2-Or-More-And-Save/_/N-1z13bde
