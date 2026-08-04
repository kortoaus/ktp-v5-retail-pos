# Remove Pickup Order Feature (pos-retail) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove the pickup-order feature from both `retail_pos_server` (CRM sync worker, `/api/pickup-order/*`, cache tables, printed-history) and `retail_pos_app` (queue UI, work-label printing, cart/scan/payment hooks). The feature is unreleased and will be redesigned from scratch.

**Architecture:** Server side: delete the `pickup-order` and `printed-history` modules, their socket emitters and worker startup, and drop the three cache tables + `PrintedHistory` via one migration. App side: delete the pickup screens/libs/services, then surgically remove the three sale-flow touchpoints — cart line `pickupOrderId` (incl. merge key), PP barcode field `09`, and the PaymentModal auto-complete hook.

**Tech Stack:** Express 5 + Prisma 7 (client → `src/generated/prisma`), Electron 40 + React 19 + zustand, node:test (not wired to npm test).

## Global Constraints

- **KEEP the `"100100"` media size option everywhere** (owner decision 2026-08-04): `retail_pos_app/src/main/types.ts:18`, `src/preload/index.d.ts:19`, `src/renderer/src/hooks/useZplPrinters.ts:5`, and both `<select>`s in `InterfaceSettingsScreen.tsx` (~:1091, ~:1184). Stores keep their configured 100×100 printers; the redesigned feature will reuse them.
- Do NOT edit `AGENTS.md`, `retail_pos_app/AGENTS.md`, `TEST_CHECKLIST.md`, `docs/sale-domain.md`, `docs/outdated/*`.
- The two subprojects share no tooling — build/verify each with its own `npm run build`. Server tests: `rm -rf dist` first (stale compiled tests would still run).
- Repo is on `main`; commit per task, all from the repo root `/Users/dev-m1/ktpv5/ktpv5-pos-retail`.
- Renderer HTTP stays in `service/*.service.ts`; sale math homes (`SalesStore.helper.recalculateLine`, `usePaymentCal`, `build-payload`) must not change behavior for non-pickup lines.

---

### Task 1: Server — unwire worker, broadcaster, routes

**Files:**
- Modify: `retail_pos_server/src/index.ts` (imports :10-13, socket-connect emit :30, startups :43-44)
- Modify: `retail_pos_server/src/router.ts` (import :16, mount :35, plus the `printed-history` import/mount — locate with `rg -n 'printed-history' src/router.ts`)

- [ ] **Step 1: Edit `src/index.ts`** — remove:

```ts
import {
  emitPickupPendingCountToSocket,
  startPickupPendingCountBroadcaster,
} from "./v1/pickup-order/pickup-order.pending-count";
import { startPickupOrderSyncWorker } from "./v1/pickup-order/pickup-order.worker";
```
the line `void emitPickupPendingCountToSocket(socket);` inside the socket connection handler (keep the handler and the `cloud-sync-completed` machinery), and the two startup calls:
```ts
  startPickupOrderSyncWorker();
  startPickupPendingCountBroadcaster();
```

- [ ] **Step 2: Edit `src/router.ts`** — remove:

```ts
import pickupOrderRouter from "./v1/pickup-order/pickup-order.router";
```
```ts
router.use("/pickup-order", pickupOrderRouter);
```
and the analogous `printed-history` import + `router.use("/printed-history", …)` pair.

- [ ] **Step 3: Delete the modules**

```bash
git rm -r retail_pos_server/src/v1/pickup-order retail_pos_server/src/v1/printed-history
```

- [ ] **Step 4: Verify** — `cd retail_pos_server && rm -rf dist && npm run build`
Expected: compiles. Then `rg -l 'pickup|printed-history' src --glob '!generated' -i` → only `prisma`-related hits until Task 2.

- [ ] **Step 5: Commit**

```bash
git add -A && git commit -m "remove(server): pickup-order and printed-history modules, worker, socket emitters"
```

### Task 2: Server — drop cache tables (Prisma migration)

**Files:**
- Modify: `retail_pos_server/prisma/schema.prisma` — delete models `PickupOrderCache` (:260-288), `PickupOrderLineCache` (:290-323), `PickupOrderSyncState` (:325-337), and `PrintedHistory` (:246-…; verify with `rg -n 'model PrintedHistory' prisma/schema.prisma` that no non-pickup code references it — Task 1 removed its only consumers)
- Create: `prisma/migrations/<timestamp>_remove_pickup_order_cache/migration.sql` (generated)

- [ ] **Step 1: Edit the schema** — remove the four model blocks. Nothing else references them (the FK `PickupOrderLineCache.crmOrderId → PickupOrderCache` is internal to the pair).

- [ ] **Step 2: Migrate + regenerate** (dev Postgres: `docker compose up -d` in this repo publishes on 5555)

```bash
cd retail_pos_server
npx prisma migrate dev --name remove_pickup_order_cache
npx prisma generate
```

Expected migration SQL: `DROP TABLE` × 4. Data loss accepted — cache-only data, feature unreleased.

- [ ] **Step 3: Verify + run remaining server tests**

```bash
rm -rf dist && npm run build
for f in dist/v1/**/*.test.js; do node --test "$f"; done
rg -i 'pickuporder|printedhistory' src/generated || true
```

Expected: build passes, remaining tests (sale points, doc counter, refund points, store label) pass, generated-client grep empty.

- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "remove(server): drop PickupOrder*Cache, PickupOrderSyncState, PrintedHistory tables"
```

### Task 3: App — delete pickup-exclusive files

**Files (all under `retail_pos_app/src/renderer/src/` unless noted):**
- Delete: `screens/PickupOrderSearchScreen.tsx`, `components/pickupOrders/` (PickupOrderSearchPanel, PickupOrderViewer, PickupOrderWorkLabelPreview, PickupPendingCountButton, pickup-order-types.ts, pickup-order-format.ts, pickup-order-status-policy.ts), `service/pickup-order.service.ts`, `service/printed-history.service.ts`, `libs/pickup-order/` (auto-complete.ts), `libs/pickup-work-label/` (model, output, render, print, pp-payload)
- Delete: `retail_pos_app/scripts/tests/{pickup-work-label-model,pickup-work-label-print,pickup-order-format,pickup-work-label-output,pickup-order-auto-complete,pp-barcode-pickup-order,sales-store-pickup-order}.test.ts`

- [ ] **Step 1: Delete**

```bash
git rm -r retail_pos_app/src/renderer/src/components/pickupOrders \
          retail_pos_app/src/renderer/src/libs/pickup-order \
          retail_pos_app/src/renderer/src/libs/pickup-work-label
git rm retail_pos_app/src/renderer/src/screens/PickupOrderSearchScreen.tsx \
       retail_pos_app/src/renderer/src/service/pickup-order.service.ts \
       retail_pos_app/src/renderer/src/service/printed-history.service.ts \
       retail_pos_app/scripts/tests/pickup-work-label-model.test.ts \
       retail_pos_app/scripts/tests/pickup-work-label-print.test.ts \
       retail_pos_app/scripts/tests/pickup-order-format.test.ts \
       retail_pos_app/scripts/tests/pickup-work-label-output.test.ts \
       retail_pos_app/scripts/tests/pickup-order-auto-complete.test.ts \
       retail_pos_app/scripts/tests/pp-barcode-pickup-order.test.ts \
       retail_pos_app/scripts/tests/sales-store-pickup-order.test.ts
```

(`sales-store-pickup-order.test.ts` tests the cart-merge/pickupOrderId interaction removed in Task 4 — it dies with the feature.)

- [ ] **Step 2: Commit** (typecheck is deferred to Task 4 — the entangled call sites still reference these modules until then; committing mid-red is acceptable here because Task 4 lands in the same PR/push)

```bash
git add -A && git commit -m "remove(app): pickup order screens, services, work-label libs, tests"
```

### Task 4: App — surgical edits to shared sale-flow files

**Files (all under `retail_pos_app/src/renderer/src/`):**
- Modify: `App.tsx` (:28, :63-66), `screens/HomeScreen.tsx` (:85-91), `screens/SaleScreen/index.tsx` (import of `PickupPendingCountButton`, `openPendingPickupOrders` :320-327, top-bar render :355, scan-dispatch branch :276-278), `screens/SaleScreen/PaymentModal/index.tsx` (:32-35, :377-388), `store/SalesStore.helper.ts` (:25, :28-35, :111, :130, :139), `types/sales.ts` (:213-217), `libs/sale/invoice-row-to-line.ts` (:57), `libs/pp-barcode.ts` (:6, :17-27, :39)

**Interfaces:** After this task `SaleLineType` has NO `pickupOrderId`; `AddLineOptions` = `{qty?, measured_weight?, adjustedPrice?, ppMarkdown?}`; `PPBarcode` = `{barcode, prices, promoPrices, weight, discountType, discountAmount}`.

- [ ] **Step 1: `App.tsx`** — remove `import PickupOrderSearchScreen from "./screens/PickupOrderSearchScreen";` and the route:
```tsx
              <Route
                path="pickup-orders"
                element={<PickupOrderSearchScreen />}
              />
```

- [ ] **Step 2: `screens/HomeScreen.tsx`** — remove the whole nav tile whose `to="/manager/pickup-orders"` (the JSX element spanning ~:85-91 containing the text `Pickup Orders`).

- [ ] **Step 3: `screens/SaleScreen/index.tsx`** —
  - remove the `PickupPendingCountButton` import;
  - remove the function:
```ts
  function openPendingPickupOrders() {
    const params = new URLSearchParams({
      status: "PENDING",
      from: dayjsAU().startOf("day").toISOString(),
      sort: "pickupStartsAtAsc",
    });
    navigate(`/manager/pickup-orders?${params.toString()}`);
  }
```
  - remove `<PickupPendingCountButton onRefresh={openPendingPickupOrders} />` from the top bar (keep `SyncButton`, `SyncPostButton`, `CartSwitcher`);
  - in the PP-barcode scan handler remove:
```ts
    if (pp.pickupOrderId != null) {
      options.pickupOrderId = pp.pickupOrderId;
    }
```
  (keep the surrounding `options` markdown/weight logic and the final `addLine(data, …)` untouched).

- [ ] **Step 4: `screens/SaleScreen/PaymentModal/index.tsx`** — remove the import:
```ts
import {
  completePickupOrdersAfterSale,
  getDistinctPickupOrderIds,
} from "../../../libs/pickup-order/auto-complete";
```
and in the sale-success handler replace:
```ts
      const pickupOrderIds = getDistinctPickupOrderIds(saleCartSnapshot.lines);
      clearActiveCart();
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
with:
```ts
      clearActiveCart();
```
If `saleCartSnapshot` becomes unused after this edit, remove its declaration too (typecheck will tell you).

- [ ] **Step 5: `store/SalesStore.helper.ts`** —
  - in `AddLineOptions` remove `pickupOrderId?: number | null;`
  - delete the whole `normalizePickupOrderId` function (:28-35)
  - in `buildNewLine` remove the line `pickupOrderId: normalizePickupOrderId(options?.pickupOrderId),`
  - in `findMergeTarget` remove `const pickupOrderId = normalizePickupOrderId(options?.pickupOrderId);` and the predicate clause `l.pickupOrderId === pickupOrderId,` (keep the other four clauses; mind the trailing comma on the new last clause).

- [ ] **Step 6: `types/sales.ts`** — remove the field and its docblock:
```ts
  /**
   * CRM pickup order id carried by pickup work label PP barcode field "09".
   * Null for normal non-pickup scans and older PP labels.
   */
  pickupOrderId: number | null;
```

- [ ] **Step 7: `libs/sale/invoice-row-to-line.ts`** — remove the line `pickupOrderId: null,`.

- [ ] **Step 8: `libs/pp-barcode.ts`** — remove `pickupOrderId: number | null;` from `PPBarcode`, the whole `readPositiveInteger` helper (:17-27, its only caller is the next line), and `pickupOrderId: readPositiveInteger(json["09"]),` from `parsePPBarcode`. Keep `buildPPBarcodeString` and `calcMarkdownPrice` untouched.

- [ ] **Step 9: Typecheck + remaining tests + grep gate**

```bash
cd retail_pos_app
npx tsc --noEmit -p tsconfig.web.json && npm run build
for f in scripts/tests/*.test.ts; do node --experimental-strip-types "$f"; done
rg -in 'pickup' src | rg -v '100100'
```

Expected: typecheck/build pass; remaining tests pass; the final grep returns **nothing** (any `100100`-related label copy that happens to contain the word "pickup" in `InterfaceSettingsScreen.tsx` may stay — the option itself is retained by owner decision; note it in the commit message if so).

- [ ] **Step 10: Commit**

```bash
git add -A && git commit -m "remove(app): pickupOrderId from cart/scan/payment flow, PP field 09"
```

### Task 5: Documentation sweep

**Files:**
- Delete: the 10 pickup plan docs in `docs/superpowers/plans/` (`2026-07-07-pickup-label-preview-canvas.md`, `2026-07-07-pickup-order-client-implementation.md`, `2026-07-07-pickup-order-phone-reveal.md`, `2026-07-07-pickup-order-status-actions.md`, `2026-07-07-pickup-order-sync-implementation.md`, `2026-07-08-pickup-order-auto-complete-from-pp-barcode.md`, `2026-07-08-pickup-order-detail-view.md`, `2026-07-08-pickup-order-label-print.md`, `2026-07-08-pickup-order-status-print-history.md`, `2026-07-08-pickup-pending-count-broadcast.md`) and their 10 matching design docs in `docs/superpowers/specs/`
- Modify: `CLAUDE.md` (root — pickup mentions at :9, :16, :60, :70, :117, :121, :134-135, :235, :238, :246: project-role list, CRM edge list, architecture diagram, offline lists, timer notes, further-reading notes), `retail_pos_server/CLAUDE.md` (:12, :41, :74, :95, :128, :160-161, :172, :180-184), `retail_pos_app/CLAUDE.md` (:96, :118, :183-185, :196), `README.md` (:84 app route table, :106 server route table)

- [ ] **Step 1: Delete the 20 design docs** (`git rm docs/superpowers/plans/2026-07-0{7,8}-pickup-*.md docs/superpowers/specs/2026-07-0{7,8}-pickup-*.md` — verify the glob catches exactly 20 with `git rm -n` first)
- [ ] **Step 2: Update the three `CLAUDE.md` files and `README.md`** — remove pickup rows/phrases; in root `CLAUDE.md` also delete the pickup exception sentence in Further Reading's `sale-domain.md` entry (D-38 "no cron" is fully true again) and the `pickup-order:new`/pending-count notes in Gotchas.
- [ ] **Step 3: Final gate** — `rg -il 'pickup' --glob '!node_modules' --glob '!dist' --glob '!out' --glob '!*generated*' .` → expected: only this plan file, historical `prisma/migrations/*`, and (if label copy retained) `InterfaceSettingsScreen.tsx`.
- [ ] **Step 4: Commit**

```bash
git add -A && git commit -m "docs: sweep pickup-order references after removal"
```

### Deployment note (not a task)

Owner deploys store servers directly. Order: update every store's `retail_pos_server` (git pull + build + `npx prisma migrate deploy` + `npx prisma generate` + `pm2 restart retail-pos-server`) **before or together with** the crm-server deploy, so no store box is left polling a removed CRM endpoint every 60 s. Till app ships via `./scripts/release-pos.sh` (terminals update at next boot); scale terminals via EAS (see the scale plan).
