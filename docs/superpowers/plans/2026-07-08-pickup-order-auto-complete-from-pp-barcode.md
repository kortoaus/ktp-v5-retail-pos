# Pickup Order Auto-Complete From PP Barcode Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Automatically mark READY pickup orders as COMPLETED after their PP pickup work labels are scanned into a normal POS SALE and the sale is successfully paid.

**Architecture:** The scale tablet and POS pickup-label helpers add CRM pickup order identity to the existing `00:` PP QR payload as optional field `"09"`. The POS parser stores that id as line metadata in Zustand cart lines, then the SALE payment success path snapshots the cart, derives distinct pickup order ids with `new Set(...)`, and calls the existing POS server status endpoint as a best-effort follow-up. The POS server keeps the existing status endpoint as the write path, allows `READY -> COMPLETED`, rejects premature completion, and treats `COMPLETED -> COMPLETED` as a local idempotent success.

**Tech Stack:** TypeScript strict mode, Electron React POS client, Zustand 5, Express 5, Prisma 7, PostgreSQL, Expo SDK 53 scale tablet, React Native, Node `node:test`.

---

## Scope

Approved design: `/Users/dev/ktpv5/ktpv5-pos-retail/docs/superpowers/specs/2026-07-08-pickup-order-auto-complete-from-pp-barcode-design.md`.

In scope:

- Scale app pickup work label PP QR payload includes `"09": order.crmOrderId`.
- POS app pickup work label helpers stay compatible and also include `"09"` when printing from POS-side pickup views.
- POS PP parser reads `"09"` into `pickupOrderId: number | null`.
- POS cart lines preserve `pickupOrderId` from scan time through payment.
- POS normal-line merge does not collapse lines from different pickup orders.
- POS SALE completion derives distinct ids with `new Set(...)` and auto-completes them after `createSale(payload)` succeeds.
- POS SPEND completion never completes pickup orders.
- Server status policy covers `READY -> COMPLETED`, idempotent `COMPLETED -> COMPLETED`, and rejected `PENDING/ORDER_CONFIRMED -> COMPLETED`.

Out of scope:

- Member filtering.
- Matching pickup orders by item barcode alone.
- Auto-completion on scan, label print, or READY transition.
- Discord notifications.

Repository rule: do not stage, commit, push, or send notifications unless the user explicitly asks. Commit steps below are review checkpoints only if the user later requests commits.

## Current Worktree Notes

Both involved repositories are dirty before this plan:

- `/Users/dev/ktpv5/ktpv5-pos-retail` has existing pickup-order server/client edits and untracked specs/plans.
- `/Users/dev/ktpv5/ktpv5-scale` has existing pickup-order, package, font, and docs edits.

Implementation workers must preserve user-owned changes. Read the current file contents before applying each task.

## File Structure

### Scale App: `/Users/dev/ktpv5/ktpv5-scale`

- Modify `libs/pickup-work-label/pp-payload.ts`
  - Add required `pickupOrderId` input and emit `"09"` only for finite positive integers.
- Modify `libs/pickup-work-label/model.ts`
  - Pass `order.crmOrderId` into the PP payload builder.
- Create `scripts/tests/pickup-work-label-pickup-order-id.test.ts`
  - Tests `"09"` on direct payload and model output.
- Modify `docs/PP_BARCODE_FIELD_INDEX.md`
  - Document field `"09"` as optional pickup order id metadata.

### Retail POS App: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app`

- Modify `src/renderer/src/libs/pickup-work-label/pp-payload.ts`
  - Mirror scale app payload builder compatibility.
- Modify `src/renderer/src/libs/pickup-work-label/model.ts`
  - Pass `order.crmOrderId`.
- Modify `scripts/tests/pickup-work-label-model.test.ts`
  - Update expected QR payloads to include `"09"`.
- Modify `src/renderer/src/libs/pp-barcode.ts`
  - Parse optional `"09"` into `pickupOrderId: number | null`.
- Create `scripts/tests/pp-barcode-pickup-order.test.ts`
  - Tests valid, missing, and invalid `"09"` parsing.
- Modify `src/renderer/src/types/sales.ts`
  - Add `pickupOrderId: number | null` to `SaleLineType`.
- Modify `src/renderer/src/store/SalesStore.helper.ts`
  - Add `pickupOrderId?: number | null` to `AddLineOptions`, copy it into new lines, and include pickup id in merge matching.
- Modify `src/renderer/src/store/SalesStore.ts`
  - Pass `options` to `findMergeTarget`.
- Create `scripts/tests/sales-store-pickup-order.test.ts`
  - Tests line metadata and merge behavior for same/different pickup order ids.
- Modify `src/renderer/src/screens/SaleScreen/index.tsx`
  - Pass `pp.pickupOrderId` into `addLine`.
- Create `src/renderer/src/libs/pickup-order/auto-complete.ts`
  - Owns distinct id derivation and best-effort completion helper.
- Create `scripts/tests/pickup-order-auto-complete.test.ts`
  - Tests `new Set` distinct ids and continue-on-failure completion behavior.
- Modify `src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx`
  - Snapshot the cart used for sale payload, call auto-complete only after successful SALE creation, and leave SPEND untouched.
- Modify `src/renderer/src/service/pickup-order.service.ts`
  - Reuse existing `updatePickupOrderStatus`; no new endpoint.

### Retail POS Server: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server`

- Modify `src/v1/pickup-order/pickup-order.status-policy.ts`
  - Allow only `COMPLETED -> COMPLETED` as a self-transition.
- Modify `src/v1/pickup-order/pickup-order.status.ts`
  - Return cached order data for idempotent completed self-transition without calling CRM.
- Modify `src/v1/pickup-order/pickup-order.status.test.ts`
  - Add server transition and service tests.
- Leave `src/v1/pickup-order/pickup-order.controller.ts` endpoint shape unchanged.

## Task 1: Scale PP Payload Adds Pickup Order Id

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-scale/libs/pickup-work-label/pp-payload.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-scale/libs/pickup-work-label/model.ts`
- Create: `/Users/dev/ktpv5/ktpv5-scale/scripts/tests/pickup-work-label-pickup-order-id.test.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-scale/docs/PP_BARCODE_FIELD_INDEX.md`

- [ ] **Step 1: Write the failing scale payload test**

Create `/Users/dev/ktpv5/ktpv5-scale/scripts/tests/pickup-work-label-pickup-order-id.test.ts`:

```ts
import assert from "node:assert/strict";
import { pathToFileURL } from "node:url";
import { register } from "node:module";
import test from "node:test";

const root = pathToFileURL(`${process.cwd()}/`).href;

register(
  `data:text/javascript,${encodeURIComponent(`
    const root = ${JSON.stringify(root)};
    export async function resolve(specifier, context, nextResolve) {
      if (specifier.startsWith("@/")) {
        const mapped = new URL(specifier.slice(2), root).href;
        try {
          return await nextResolve(mapped, context);
        } catch (error) {
          if (error && error.code === "ERR_MODULE_NOT_FOUND") {
            return nextResolve(\`\${mapped}.ts\`, context);
          }
          throw error;
        }
      }
      const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
      const lastSegment = specifier.split("/").at(-1) ?? "";
      const hasExtension = /\\.[a-zA-Z0-9]+$/.test(lastSegment);
      if (isRelative && !hasExtension) {
        try {
          return await nextResolve(specifier, context);
        } catch (error) {
          if (error && error.code === "ERR_MODULE_NOT_FOUND") {
            return nextResolve(\`\${specifier}.ts\`, context);
          }
          throw error;
        }
      }
      return nextResolve(specifier, context);
    }
  `)}`,
);

const { buildPickupWorkLabelQrPayload } = await import(
  "../../libs/pickup-work-label/pp-payload.ts"
);
const { buildPickupWorkLabelModel } = await import(
  "../../libs/pickup-work-label/model.ts"
);

const line = {
  crmLineId: 4102,
  index: 0,
  itemId: 501,
  name_en: "Salmon Bowl",
  name_ko: "연어 덮밥",
  barcode: "9330001112223",
  code: "SLM-BOWL",
  uom: "ea",
  prices: [1299, 1199],
  promoPrices: { prices: [1099] },
  memberLevel: 1,
  optionTotal: 350,
  qty: 1000,
  total: 1649,
  note: null,
  selectedOptionsSnapshot: [],
};

const order = {
  crmOrderId: 260708869,
  documentId: "PU-260708-0869",
  status: "ORDER_CONFIRMED",
  memberId: "member-1",
  memberName: "Mina Kim",
  memberLevel: 1,
  memberPhoneLast4: "4321",
  pickupStartsAt: "2026-07-08T09:30:00.000+10:00",
  linesTotal: 1649,
  total: 1649,
  crmCreatedAt: "2026-07-08T08:30:00.000+10:00",
  crmUpdatedAt: "2026-07-08T08:45:00.000+10:00",
  syncedAt: "2026-07-08T08:45:10.000+10:00",
  lines: [line],
};

test("scale pickup work label PP payload includes pickup order id as field 09", () => {
  const payload = buildPickupWorkLabelQrPayload({
    barcode: "9330001112223",
    prices: [1299, 1199],
    promoPrices: { prices: [1099] },
    optionTotal: 350,
    pickupOrderId: 260708869,
  });

  assert.deepEqual(JSON.parse(payload.slice("00:".length)), {
    "00": 2,
    "01": "9330001112223",
    "02": [1649, 1549],
    "03": [1449],
    "09": 260708869,
  });
});

test("scale pickup work label model passes order crmOrderId into QR field 09", () => {
  const model = buildPickupWorkLabelModel(order, line);
  assert.equal(JSON.parse(model.qrPayload.slice("00:".length))["09"], 260708869);
});
```

- [ ] **Step 2: Run the scale test to verify failure**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-scale
node --experimental-strip-types scripts/tests/pickup-work-label-pickup-order-id.test.ts
```

Expected: FAIL because `pickupOrderId` is not accepted and field `"09"` is missing.

- [ ] **Step 3: Add pickupOrderId to the scale payload builder**

Modify `/Users/dev/ktpv5/ktpv5-scale/libs/pickup-work-label/pp-payload.ts`:

```ts
export type PickupWorkLabelQrPayloadInput = {
  barcode: string;
  prices: number[];
  promoPrices: unknown;
  optionTotal: number;
  pickupOrderId: number;
};
```

Add this helper near `addOptionTotal`:

```ts
function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0 && Number.isFinite(value);
}
```

Update the function signature and payload body:

```ts
export function buildPickupWorkLabelQrPayload({
  barcode,
  prices,
  promoPrices,
  optionTotal,
  pickupOrderId,
}: PickupWorkLabelQrPayloadInput): string {
  const payload: Record<string, unknown> = {
    "00": PP_PAYLOAD_VERSION,
    "01": barcode,
    "02": addOptionTotal(prices, optionTotal),
    "03": addOptionTotal(normalizePromoPrices(promoPrices), optionTotal),
  };

  if (isPositiveInteger(pickupOrderId)) {
    payload["09"] = pickupOrderId;
  }

  return `${PP_PREFIX}${JSON.stringify(payload)}`;
}
```

- [ ] **Step 4: Pass the order id from the scale label model**

Modify the `buildPickupWorkLabelQrPayload` call in `/Users/dev/ktpv5/ktpv5-scale/libs/pickup-work-label/model.ts`:

```ts
    qrPayload: buildPickupWorkLabelQrPayload({
      barcode: itemBarcode,
      prices: line.prices,
      promoPrices: line.promoPrices,
      optionTotal: line.optionTotal,
      pickupOrderId: order.crmOrderId,
    }),
```

- [ ] **Step 5: Document field 09 in the scale PP barcode index**

Add this row to `/Users/dev/ktpv5/ktpv5-scale/docs/PP_BARCODE_FIELD_INDEX.md`:

```md
| `"09"` | Pickup order id | `number` | Pickup work labels only | CRM pickup order id copied from the pickup order. POS uses this to complete READY pickup orders after successful SALE payment. |
```

Update the compatibility note:

```md
- POS reads `"09"` when present as optional pickup-order metadata; missing or invalid values must behave like a normal PP barcode.
```

- [ ] **Step 6: Verify scale payload changes**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-scale
node --experimental-strip-types scripts/tests/pickup-work-label-pickup-order-id.test.ts
npx tsc --noEmit --pretty false
```

Expected: the targeted test and TypeScript check pass.

- [ ] **Step 7: Review checkpoint**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-scale
git diff -- libs/pickup-work-label/pp-payload.ts libs/pickup-work-label/model.ts docs/PP_BARCODE_FIELD_INDEX.md scripts/tests/pickup-work-label-pickup-order-id.test.ts
```

Expected: only pickup work label payload metadata and docs changed; normal scale label PP fields `"01"` through `"08"` are unchanged.

## Task 2: POS Pickup Work Label Helpers Stay Compatible

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pickup-work-label/pp-payload.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pickup-work-label/model.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/scripts/tests/pickup-work-label-model.test.ts`

- [ ] **Step 1: Update the POS pickup label test expectations first**

In `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/scripts/tests/pickup-work-label-model.test.ts`, update the direct builder call in `buildPickupWorkLabelQrPayload builds a v2 PP barcode without quantity`:

```ts
  const payload = buildPickupWorkLabelQrPayload({
    barcode: "9330001112223",
    prices: [1299, 1199],
    promoPrices: { prices: [1099, "bad", 999] },
    optionTotal: 350,
    pickupOrderId: 9001,
  });
```

Update each expected parsed QR payload for `baseOrder` to include field `"09"`:

```ts
  assert.deepEqual(parsed, {
    "00": 2,
    "01": "9330001112223",
    "02": [1649, 1549],
    "03": [1449, 1349],
    "09": 9001,
  });
```

For fallback order assertions, expect `"09": 9001` because the fallback order still uses `baseOrder.crmOrderId`.

- [ ] **Step 2: Run POS pickup label test to verify failure**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
node --experimental-strip-types scripts/tests/pickup-work-label-model.test.ts
```

Expected: FAIL because the POS helper does not accept `pickupOrderId` and does not emit `"09"`.

- [ ] **Step 3: Mirror the scale payload builder change in POS**

Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pickup-work-label/pp-payload.ts` exactly like the scale version:

```ts
export type PickupWorkLabelQrPayloadInput = {
  barcode: string;
  prices: number[];
  promoPrices: unknown;
  optionTotal: number;
  pickupOrderId: number;
};

function isPositiveInteger(value: number): boolean {
  return Number.isInteger(value) && value > 0 && Number.isFinite(value);
}

export function buildPickupWorkLabelQrPayload({
  barcode,
  prices,
  promoPrices,
  optionTotal,
  pickupOrderId,
}: PickupWorkLabelQrPayloadInput): string {
  const payload: Record<string, unknown> = {
    "00": PP_PAYLOAD_VERSION,
    "01": barcode,
    "02": addOptionTotal(prices, optionTotal),
    "03": addOptionTotal(normalizePromoPrices(promoPrices), optionTotal),
  };

  if (isPositiveInteger(pickupOrderId)) {
    payload["09"] = pickupOrderId;
  }

  return `${PP_PREFIX}${JSON.stringify(payload)}`;
}
```

- [ ] **Step 4: Pass order.crmOrderId from POS pickup label model**

Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pickup-work-label/model.ts`:

```ts
    qrPayload: buildPickupWorkLabelQrPayload({
      barcode: itemBarcode,
      prices: line.prices,
      promoPrices: line.promoPrices,
      optionTotal: line.optionTotal,
      pickupOrderId: order.crmOrderId,
    }),
```

- [ ] **Step 5: Verify POS pickup helper compatibility**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
node --experimental-strip-types scripts/tests/pickup-work-label-model.test.ts
```

Expected: PASS.

## Task 3: POS PP Barcode Parser Reads Field 09

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pp-barcode.ts`
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/scripts/tests/pp-barcode-pickup-order.test.ts`

- [ ] **Step 1: Write the failing parser test**

Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/scripts/tests/pp-barcode-pickup-order.test.ts`:

```ts
import assert from "node:assert/strict";
import test from "node:test";

const { parsePPBarcode } = await import("../../src/renderer/src/libs/pp-barcode.ts");

test("parsePPBarcode reads positive integer pickup order id from field 09", () => {
  const parsed = parsePPBarcode(
    '00:{"00":2,"01":"9330001112223","02":[1299],"03":[],"09":260708869}',
  );

  assert.equal(parsed?.barcode, "9330001112223");
  assert.equal(parsed?.pickupOrderId, 260708869);
});

test("parsePPBarcode treats missing or invalid pickup order id as null", () => {
  const cases = [
    '00:{"01":"9330001112223","02":[],"03":[]}',
    '00:{"01":"9330001112223","02":[],"03":[],"09":0}',
    '00:{"01":"9330001112223","02":[],"03":[],"09":-1}',
    '00:{"01":"9330001112223","02":[],"03":[],"09":1.2}',
    '00:{"01":"9330001112223","02":[],"03":[],"09":"260708869"}',
    '00:{"01":"9330001112223","02":[],"03":[],"09":null}',
  ];

  for (const raw of cases) {
    assert.equal(parsePPBarcode(raw)?.pickupOrderId, null, raw);
  }
});
```

- [ ] **Step 2: Run parser test to verify failure**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
node --experimental-strip-types scripts/tests/pp-barcode-pickup-order.test.ts
```

Expected: FAIL because `pickupOrderId` is missing from `PPBarcode`.

- [ ] **Step 3: Implement parser support**

Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pp-barcode.ts`.

Add the field to `PPBarcode`:

```ts
export interface PPBarcode {
  barcode: string;
  prices: number[];
  promoPrices: number[];
  weight: number | null;
  discountType: "pct" | "amt" | null;
  discountAmount: number;
  pickupOrderId: number | null;
}
```

Add this helper near `isPPBarcode`:

```ts
function readPositiveInteger(value: unknown): number | null {
  if (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0
  ) {
    return value;
  }
  return null;
}
```

Add the field in the return object:

```ts
      pickupOrderId: readPositiveInteger(json["09"]),
```

Keep missing or invalid `"09"` as `null`; do not reject the whole PP barcode.

- [ ] **Step 4: Verify parser test**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
node --experimental-strip-types scripts/tests/pp-barcode-pickup-order.test.ts
```

Expected: PASS.

## Task 4: POS Cart Lines Preserve Pickup Order Metadata

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/types/sales.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/store/SalesStore.helper.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/store/SalesStore.ts`
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/scripts/tests/sales-store-pickup-order.test.ts`

- [ ] **Step 1: Write the failing sales-store helper tests**

Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/scripts/tests/sales-store-pickup-order.test.ts`:

```ts
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
      const lastSegment = specifier.split("/").at(-1) ?? "";
      const hasExtension = /\\.[a-zA-Z0-9]+$/.test(lastSegment);
      if (isRelative && !hasExtension) {
        try {
          return await nextResolve(specifier, context);
        } catch (error) {
          if (error && error.code === "ERR_MODULE_NOT_FOUND") {
            return nextResolve(\`\${specifier}.ts\`, context);
          }
          throw error;
        }
      }
      return nextResolve(specifier, context);
    }
  `)}`,
);

const { buildNewLine, findMergeTarget } = await import(
  "../../src/renderer/src/store/SalesStore.helper.ts"
);

const item = {
  type: "normal",
  itemId: 501,
  name_en: "Salmon Bowl",
  name_ko: "연어 덮밥",
  price: { prices: [1299] },
  promoPrice: null,
  taxable: true,
  isPointExcluded: false,
  uom: "ea",
  barcode: "9330001112223",
};

test("buildNewLine stores pickupOrderId from AddLineOptions", () => {
  const line = buildNewLine(item, 0, 0, { pickupOrderId: 260708869 });
  assert.equal(line.pickupOrderId, 260708869);
});

test("buildNewLine defaults pickupOrderId to null", () => {
  const line = buildNewLine(item, 0, 0);
  assert.equal(line.pickupOrderId, null);
});

test("findMergeTarget merges only matching pickup order identity", () => {
  const orderA = buildNewLine(item, 0, 0, { pickupOrderId: 260708869 });
  const normal = buildNewLine(item, 0, 1);

  assert.equal(
    findMergeTarget([orderA, normal], item, 0, { pickupOrderId: 260708869 }),
    0,
  );
  assert.equal(
    findMergeTarget([orderA, normal], item, 0, { pickupOrderId: 260708870 }),
    -1,
  );
  assert.equal(findMergeTarget([orderA, normal], item, 0, undefined), 1);
});
```

- [ ] **Step 2: Run helper tests to verify failure**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
node --experimental-strip-types scripts/tests/sales-store-pickup-order.test.ts
```

Expected: FAIL because `pickupOrderId` is not in line/options and `findMergeTarget` does not accept options.

- [ ] **Step 3: Add line metadata type**

Modify `SaleLineType` in `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/types/sales.ts` near other metadata fields:

```ts
  /**
   * CRM pickup order id carried by pickup work label PP barcode field "09".
   * Null for normal non-pickup scans and older PP labels.
   */
  pickupOrderId: number | null;
```

- [ ] **Step 4: Extend AddLineOptions and buildNewLine**

Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/store/SalesStore.helper.ts`.

Update `AddLineOptions`:

```ts
export interface AddLineOptions {
  qty?: number;
  measured_weight?: number;
  adjustedPrice?: number;
  ppMarkdown?: PPMarkdown | null;
  pickupOrderId?: number | null;
}
```

Add this helper:

```ts
function normalizePickupOrderId(value: number | null | undefined): number | null {
  return typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0
    ? value
    : null;
}
```

Set the new line field inside `buildNewLine`:

```ts
    pickupOrderId: normalizePickupOrderId(options?.pickupOrderId),
```

- [ ] **Step 5: Make normal-line merge pickup-order aware**

Change `findMergeTarget` signature:

```ts
export function findMergeTarget(
  lines: SaleLineType[],
  item: SaleLineItem,
  memberLevel: number,
  options?: AddLineOptions,
): number {
  const unit_price_original = resolveOriginalPrice(item);
  const unit_price_discounted = resolveDiscountedPrice(item, memberLevel);
  const pickupOrderId = normalizePickupOrderId(options?.pickupOrderId);

  return lines.findIndex(
    (l) =>
      l.type === "normal" &&
      l.itemId === item.itemId &&
      l.unit_price_adjusted === null &&
      l.unit_price_discounted === unit_price_discounted &&
      l.unit_price_original === unit_price_original &&
      l.pickupOrderId === pickupOrderId,
  );
}
```

Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/store/SalesStore.ts`:

```ts
      const mergeIdx = findMergeTarget(lines, item, memberLevel, options);
```

- [ ] **Step 6: Verify cart metadata tests**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
node --experimental-strip-types scripts/tests/sales-store-pickup-order.test.ts
```

Expected: PASS.

## Task 5: POS Scan Handling Sends Pickup Order Id Into Cart

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/screens/SaleScreen/index.tsx`

- [ ] **Step 1: Add pickupOrderId to PP add-line options**

Inside `addLinePP`, after `const options: AddLineOptions = {};`, add:

```ts
    if (pp.pickupOrderId != null) {
      options.pickupOrderId = pp.pickupOrderId;
    }
```

Keep the existing markdown and weight branches unchanged.

- [ ] **Step 2: Ensure metadata-only options are passed**

Keep the final `addLine` call as an object-key check so a metadata-only pickup label still passes options:

```ts
    addLine(data, Object.keys(options).length > 0 ? options : undefined);
```

Expected behavior:

- Older PP labels with no `"09"` keep behaving as normal PP labels.
- Pickup labels with only item/prices/order id create cart lines with `pickupOrderId`.
- Two pickup orders with the same item and price do not merge into one line because Task 4 made merge matching pickup-order aware.

- [ ] **Step 3: Verify POS app TypeScript catches integration issues**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Expected: build succeeds after Tasks 2 through 5.

## Task 6: POS SALE Completion Auto-Completes Distinct Pickup Orders

**Files:**
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pickup-order/auto-complete.ts`
- Create: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/scripts/tests/pickup-order-auto-complete.test.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx`

- [ ] **Step 1: Write helper tests for distinct ids and continue-on-failure**

Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/scripts/tests/pickup-order-auto-complete.test.ts`:

```ts
import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
      const lastSegment = specifier.split("/").at(-1) ?? "";
      const hasExtension = /\\.[a-zA-Z0-9]+$/.test(lastSegment);
      if (isRelative && !hasExtension) {
        try {
          return await nextResolve(specifier, context);
        } catch (error) {
          if (error && error.code === "ERR_MODULE_NOT_FOUND") {
            return nextResolve(\`\${specifier}.ts\`, context);
          }
          throw error;
        }
      }
      return nextResolve(specifier, context);
    }
  `)}`,
);

const { completePickupOrdersAfterSale, getDistinctPickupOrderIds } =
  await import("../../src/renderer/src/libs/pickup-order/auto-complete.ts");

test("getDistinctPickupOrderIds derives unique finite ids with new Set order", () => {
  const ids = getDistinctPickupOrderIds([
    { pickupOrderId: 260708869 },
    { pickupOrderId: null },
    { pickupOrderId: 260708869 },
    { pickupOrderId: 260708870 },
    { pickupOrderId: Number.NaN },
  ]);

  assert.deepEqual(ids, [260708869, 260708870]);
});

test("completePickupOrdersAfterSale continues after failures", async () => {
  const calls: Array<{ id: number; status: string }> = [];
  const failures = await completePickupOrdersAfterSale(
    [260708869, 260708870, 260708871],
    async (id, status) => {
      calls.push({ id, status });
      return id === 260708870
        ? { ok: false, msg: "not ready", result: null }
        : { ok: true, msg: "ok", result: {} };
    },
  );

  assert.deepEqual(calls, [
    { id: 260708869, status: "COMPLETED" },
    { id: 260708870, status: "COMPLETED" },
    { id: 260708871, status: "COMPLETED" },
  ]);
  assert.deepEqual(failures, [{ id: 260708870, message: "not ready" }]);
});
```

- [ ] **Step 2: Run helper test to verify failure**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
node --experimental-strip-types scripts/tests/pickup-order-auto-complete.test.ts
```

Expected: FAIL because the helper file does not exist.

- [ ] **Step 3: Implement the auto-complete helper**

Create `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/libs/pickup-order/auto-complete.ts`:

```ts
import { updatePickupOrderStatus } from "../../service/pickup-order.service";
import type { PosPickupOrderStatus } from "../../components/pickupOrders/pickup-order-types";

type PickupOrderLineMetadata = {
  pickupOrderId?: number | null;
};

export type PickupOrderCompletionFailure = {
  id: number;
  message: string;
};

type PickupOrderStatusUpdater = (
  id: number,
  status: PosPickupOrderStatus,
) => Promise<{ ok: boolean; msg?: string | null; result?: unknown }>;

function isFinitePositiveInteger(value: unknown): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    Number.isInteger(value) &&
    value > 0
  );
}

export function getDistinctPickupOrderIds(
  lines: readonly PickupOrderLineMetadata[],
): number[] {
  return Array.from(
    new Set(
      lines
        .map((line) => line.pickupOrderId)
        .filter(isFinitePositiveInteger),
    ),
  );
}

export async function completePickupOrdersAfterSale(
  pickupOrderIds: readonly number[],
  updateStatus: PickupOrderStatusUpdater = updatePickupOrderStatus,
): Promise<PickupOrderCompletionFailure[]> {
  const failures: PickupOrderCompletionFailure[] = [];

  for (const id of pickupOrderIds) {
    try {
      const res = await updateStatus(id, "COMPLETED");
      if (!res.ok) {
        failures.push({ id, message: res.msg || "status update failed" });
      }
    } catch (error) {
      failures.push({
        id,
        message: error instanceof Error ? error.message : "status update failed",
      });
    }
  }

  return failures;
}
```

- [ ] **Step 4: Wire helper into PaymentModal SALE success only**

Modify imports in `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app/src/renderer/src/screens/SaleScreen/PaymentModal/index.tsx`:

```ts
import {
  completePickupOrdersAfterSale,
  getDistinctPickupOrderIds,
} from "../../../libs/pickup-order/auto-complete";
```

Inside `handleCompleteSale`, after `const cart = carts[activeCartIndex];`, add a snapshot and use it for payload:

```ts
    const saleCartSnapshot = {
      ...cart,
      lines: cart.lines.map((line) => ({ ...line })),
    };
```

Change the payload builder input:

```ts
      cart: saleCartSnapshot,
```

After successful `createSale(payload)` and before or immediately after `clearActiveCart()`, derive ids from the snapshot:

```ts
      const pickupOrderIds = getDistinctPickupOrderIds(saleCartSnapshot.lines);
```

After `clearActiveCart();`, start the best-effort follow-up without blocking drawer/receipt flow:

```ts
      if (pickupOrderIds.length > 0) {
        void completePickupOrdersAfterSale(pickupOrderIds).then((failures) => {
          if (failures.length === 0) return;
          window.alert(
            `Sale completed, but pickup completion failed for: ${failures
              .map((failure) => failure.id)
              .join(", ")}`,
          );
        });
      }
```

Do not add this helper call to `handleSpend`.

- [ ] **Step 5: Verify helper and POS build**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
node --experimental-strip-types scripts/tests/pickup-order-auto-complete.test.ts
npm run build
```

Expected: helper tests and app build pass.

## Task 7: Server Status Rules And Idempotent Completion

**Files:**
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.status-policy.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.status.ts`
- Modify: `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.status.test.ts`

- [ ] **Step 1: Write failing server status tests**

Append these tests to `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.status.test.ts`:

```ts
test("pickup POS status policy allows ready completion and idempotent completed completion", () => {
  assert.equal(canTransitionPickupOrderStatus("READY", "COMPLETED"), true);
  assert.equal(canTransitionPickupOrderStatus("COMPLETED", "COMPLETED"), true);
});

test("pickup POS status policy rejects premature completion", () => {
  assert.equal(canTransitionPickupOrderStatus("PENDING", "COMPLETED"), false);
  assert.equal(
    canTransitionPickupOrderStatus("ORDER_CONFIRMED", "COMPLETED"),
    false,
  );
  assert.equal(
    canTransitionPickupOrderStatus("CANCELLED_BY_STORE", "COMPLETED"),
    false,
  );
  assert.equal(
    canTransitionPickupOrderStatus("CANCELLED_BY_CUSTOMER", "COMPLETED"),
    false,
  );
});

test("updatePickupOrderStatusFromPos completes READY pickup orders through CRM", async () => {
  const calls: unknown[] = [];
  const upserts: unknown[] = [];

  await updatePickupOrderStatusFromPos(
    {
      orderId: 42,
      body: { status: "COMPLETED" },
      user: { id: 12, name: "Alice", scope: ["sale"] },
    },
    {
      getLocalPickupOrderStatus: async () => "READY",
      updateCrmStatus: async (orderId, payload) => {
        calls.push({ orderId, payload });
        return { ...pickupOrderWire, status: "COMPLETED" };
      },
      upsertLocalPickupOrder: async (items) => {
        upserts.push(items);
      },
    },
  );

  assert.deepEqual(calls, [
    {
      orderId: 42,
      payload: {
        status: "COMPLETED",
        actorId: "12",
        actorName: "Alice",
      },
    },
  ]);
  assert.deepEqual(upserts, [[{ ...pickupOrderWire, status: "COMPLETED" }]]);
});

test("updatePickupOrderStatusFromPos treats COMPLETED to COMPLETED as local idempotent success", async () => {
  const calls: unknown[] = [];
  const upserts: unknown[] = [];
  const result = await updatePickupOrderStatusFromPos(
    {
      orderId: 42,
      body: { status: "COMPLETED" },
      user: { id: 12, name: "Alice", scope: ["sale"] },
    },
    {
      getLocalPickupOrderStatus: async () => "COMPLETED",
      getLocalPickupOrder: async () => ({ ...pickupOrderWire, status: "COMPLETED" }),
      updateCrmStatus: async (orderId, payload) => {
        calls.push({ orderId, payload });
        return { ...pickupOrderWire, status: "COMPLETED" };
      },
      upsertLocalPickupOrder: async (items) => {
        upserts.push(items);
      },
    },
  );

  assert.equal(result.status, "COMPLETED");
  assert.deepEqual(calls, []);
  assert.deepEqual(upserts, []);
});

test("updatePickupOrderStatusFromPos rejects PENDING and ORDER_CONFIRMED to COMPLETED", async () => {
  for (const fromStatus of ["PENDING", "ORDER_CONFIRMED"] as const) {
    await assert.rejects(
      () =>
        updatePickupOrderStatusFromPos(
          {
            orderId: 42,
            body: { status: "COMPLETED" },
            user: { id: 12, name: "Alice", scope: ["sale"] },
          },
          {
            getLocalPickupOrderStatus: async () => fromStatus,
            updateCrmStatus: async () => ({ ...pickupOrderWire, status: "COMPLETED" }),
            upsertLocalPickupOrder: async () => undefined,
          },
        ),
      (error) =>
        error instanceof BadRequestException &&
        error.message === `Cannot change pickup order from ${fromStatus} to COMPLETED`,
    );
  }
});
```

- [ ] **Step 2: Run server status tests to verify failure**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build
node --test dist/v1/pickup-order/pickup-order.status.test.js
```

Expected: FAIL because `COMPLETED -> COMPLETED` is rejected and `getLocalPickupOrder` dependency does not exist.

- [ ] **Step 3: Allow only the completed self-transition**

Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.status-policy.ts`:

```ts
  COMPLETED: ["COMPLETED"],
```

Leave `PENDING` and `ORDER_CONFIRMED` unchanged so they still cannot transition directly to `COMPLETED`.

- [ ] **Step 4: Add cached order mapping for idempotent success**

Modify `/Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server/src/v1/pickup-order/pickup-order.status.ts`.

Update `Deps`:

```ts
type Deps = {
  updateCrmStatus?: typeof updateCrmPickupOrderStatus;
  upsertLocalPickupOrder?: (items: CrmPickupOrderWire[]) => Promise<unknown>;
  getLocalPickupOrderStatus?: (orderId: number) => Promise<PickupOrderStatus>;
  getLocalPickupOrder?: (orderId: number) => Promise<CrmPickupOrderWire>;
};
```

Add this helper near `getCachedPickupOrderStatus`:

```ts
async function getCachedPickupOrderWire(
  orderId: number,
): Promise<CrmPickupOrderWire> {
  const row = await db.pickupOrderCache.findUnique({
    where: { crmOrderId: orderId },
    include: { lines: { orderBy: { index: "asc" } } },
  });
  if (!row) {
    throw new NotFoundException("Pickup order not found");
  }

  return {
    id: row.crmOrderId,
    companyId: row.companyId,
    documentId: row.documentId,
    status: row.status as PickupOrderStatus,
    memberId: row.memberId,
    memberName: row.memberName,
    memberLevel: row.memberLevel,
    memberPhoneLast4: row.memberPhoneLast4,
    pickupStartsAt: row.pickupStartsAt.toISOString(),
    linesTotal: row.linesTotal,
    total: row.total,
    createdAt: row.crmCreatedAt.toISOString(),
    updatedAt: row.crmUpdatedAt.toISOString(),
    lines: row.lines.map((line) => ({
      id: line.crmLineId,
      orderId: line.crmOrderId,
      index: line.index,
      itemId: line.itemId,
      name_en: line.name_en,
      name_ko: line.name_ko,
      barcode: line.barcode,
      code: line.code,
      uom: line.uom,
      prices: line.prices,
      promoPrices: line.promoPrices,
      memberLevel: line.memberLevel,
      optionTotal: line.optionTotal,
      qty: line.qty,
      total: line.total,
      note: line.note,
      selectedOptionsSnapshot: line.selectedOptionsSnapshot,
      createdAt: line.crmCreatedAt.toISOString(),
      updatedAt: line.crmUpdatedAt.toISOString(),
    })),
  };
}
```

In `updatePickupOrderStatusFromPos`, after manager assertion and before calling CRM:

```ts
  if (currentStatus === parsed.status) {
    const getLocalPickupOrder =
      deps.getLocalPickupOrder ?? getCachedPickupOrderWire;
    return getLocalPickupOrder(input.orderId);
  }
```

Because policy only allows `COMPLETED -> COMPLETED` as a same-status transition, this local return is limited to idempotent completed completion.

- [ ] **Step 5: Verify server status tests**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build
node --test dist/v1/pickup-order/pickup-order.status.test.js
```

Expected: build succeeds and status tests pass.

## Task 8: End-to-End Verification

**Files:**
- No new code files. This task verifies the complete cross-repo flow.

- [ ] **Step 1: Run POS server build and status tests**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build
node --test dist/v1/pickup-order/pickup-order.status.test.js
```

Expected: PASS.

- [ ] **Step 2: Run POS app targeted tests**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
node --experimental-strip-types scripts/tests/pickup-work-label-model.test.ts
node --experimental-strip-types scripts/tests/pp-barcode-pickup-order.test.ts
node --experimental-strip-types scripts/tests/sales-store-pickup-order.test.ts
node --experimental-strip-types scripts/tests/pickup-order-auto-complete.test.ts
```

Expected: all targeted tests pass.

- [ ] **Step 3: Run POS app build**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Expected: build succeeds.

- [ ] **Step 4: Run scale targeted test and checks**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-scale
node --experimental-strip-types scripts/tests/pickup-work-label-pickup-order-id.test.ts
npx tsc --noEmit --pretty false
npm run lint
```

Expected: targeted test, TypeScript, and lint pass.

- [ ] **Step 5: Run whitespace checks in both repos**

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail
git diff --check
```

Run:

```bash
cd /Users/dev/ktpv5/ktpv5-scale
git diff --check
```

Expected: no whitespace errors.

- [ ] **Step 6: Manual smoke test with a real or representative PP payload**

Use a scanned payload shaped like:

```text
00:{"00":2,"01":"9330001112223","02":[1299],"03":[],"09":260708869}
```

Expected behavior:

- POS scanner resolves item barcode `"01"`.
- Cart line stores `pickupOrderId: 260708869`.
- Completing a SALE calls `POST /api/pickup-order/260708869/status` with `{ "status": "COMPLETED" }` after `createSale` succeeds.
- Completing a SPEND does not call the pickup status endpoint.
- If the order is READY, server returns success and local cache updates from CRM response.
- If the order is already COMPLETED, server returns success without CRM write.
- If the order is PENDING or ORDER_CONFIRMED, server rejects and POS shows a compact alert listing the failed id while keeping the sale completed.

## Self-Review

Spec coverage:

- Scale app adds `"09": pickupOrderId` on pickup work labels in Task 1.
- POS pickup work label helpers remain compatible in Task 2.
- POS parser reads `"09"` as `pickupOrderId: number | null` with finite positive integer validation in Task 3.
- Zustand cart line metadata and merge safety are handled in Task 4.
- Sale screen PP scan propagation is handled in Task 5.
- Payment completion distinct id derivation with `new Set(...)` and best-effort completion after successful SALE creation are handled in Task 6.
- SPEND is excluded because Task 6 modifies only `handleCompleteSale`, not `handleSpend`.
- Server status rules are handled in Task 7.
- Member filtering is absent from all tasks.
- Discord notifications are absent from all tasks.

Placeholder scan:

- Each test and implementation step includes concrete file paths, commands, and expected results.
- The plan avoids deferred placeholders and unspecified edge-case instructions.

Type consistency:

- The same property name `pickupOrderId` is used in `PPBarcode`, `AddLineOptions`, `SaleLineType`, and auto-complete helpers.
- Server tests use `getLocalPickupOrder`, matching the dependency added in Task 7.
