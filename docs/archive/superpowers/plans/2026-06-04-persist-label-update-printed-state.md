# Persist Label Update Printed State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Persist label-update sheet `Printed` state in the local POS server database so one successful print marks the sheet as printed for every terminal on that store POS server.

**Architecture:** Add a POS-local `PrintedItemSheet` table keyed by cloud `sheetId`, expose two focused local API routes under the existing cloud item-sheet proxy area, then replace renderer localStorage-backed printed state with server-backed state. Keep the visible badge flow unchanged by continuing to pass a `Set<number>` into `SearchItemSheetList`.

**Tech Stack:** Express 5, Prisma 7 generated client in `retail_pos_server/src/generated/prisma`, PostgreSQL, React 19, TypeScript 5, axios singleton `apiService`, Tailwind CSS.

**Execution Status:** Implemented on 2026-06-04. `npx prisma db push`, `npx prisma generate`, `npm run build` in `retail_pos_server`, and `npm run build` in `retail_pos_app` completed successfully. A read-only database check confirmed the local `PrintedItemSheet` table exists. A follow-up migration file was added at `retail_pos_server/prisma/migrations/20260604050000_add_printed_item_sheet/migration.sql`; because the local table had already been created by `db push`, the local database was marked with `npx prisma migrate resolve --applied 20260604050000_add_printed_item_sheet`. Manual multi-terminal print QA remains a deployment-floor check.

---

## File Structure

- Modify: `retail_pos_server/prisma/schema.prisma`
  - Add the POS-local `PrintedItemSheet` model.
  - No relation to a local item-sheet table because label-update sheets are proxied from the cloud.

- Create: `retail_pos_server/src/v1/cloud/cloud.item-sheet.printed.service.ts`
  - Owns DB reads/writes for printed label-update sheet ids.
  - Provides `getPrintedLabelUpdateSheetIdsService()` and `markLabelUpdateSheetPrintedService()`.

- Modify: `retail_pos_server/src/v1/cloud/cloud.item-sheet.controller.ts`
  - Add controllers for `GET /printed` and `POST /:id/printed`.
  - Keep existing cloud proxy controllers unchanged.

- Modify: `retail_pos_server/src/v1/cloud/cloud.router.ts`
  - Register printed-state routes before `/:id` so `printed` is not parsed as an id.

- Modify: `retail_pos_app/src/renderer/src/service/cloud.service.ts`
  - Add renderer API helpers for reading and marking printed sheet ids.

- Modify: `retail_pos_app/src/renderer/src/components/priceTags/PrintItemPriceTagSheet.tsx`
  - Load printed ids from server.
  - Mark printed through server after successful printing.
  - Keep a conservative one-time localStorage migration from the old terminal-specific key.

- Unchanged: `retail_pos_app/src/renderer/src/components/priceTags/SearchItemSheetList.tsx`
  - It already accepts `printedSheetIds?: Set<number>` and renders the badge.

No cloud API, web client, Electron main/preload, IPC, label-template, or printer transport files should change.

---

### Task 1: Add POS-Local Prisma Model

**Files:**
- Modify: `retail_pos_server/prisma/schema.prisma`

- [ ] **Step 1: Add the Prisma model**

In `retail_pos_server/prisma/schema.prisma`, add this model in the local data section near `Terminal`, `StoreSetting`, and `CashInOut`:

```prisma
model PrintedItemSheet {
  id        Int      @id @default(autoincrement())
  sheetId   Int      @unique
  printedAt DateTime @default(now())
  userId    Int?
  userName  String?
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt
}
```

Do not add `terminalId`.

- [ ] **Step 2: Apply schema to the local DB**

Run:

```bash
cd retail_pos_server
npx prisma db push
```

Expected:

- Prisma reports the database is in sync or applies the new table.
- No destructive reset prompt should be accepted.

- [ ] **Step 3: Regenerate Prisma client**

Run:

```bash
cd retail_pos_server
npx prisma generate
```

Expected:

- `retail_pos_server/src/generated/prisma/client.ts` and model exports are regenerated.
- New generated files for `PrintedItemSheet` may appear under `retail_pos_server/src/generated/prisma/models/`.

- [ ] **Step 4: Commit schema/client generation**

Check exactly what changed:

```bash
git status --short
```

Stage only schema and generated Prisma files:

```bash
git add retail_pos_server/prisma/schema.prisma retail_pos_server/src/generated/prisma
git commit -m "feat: add printed item sheet persistence model"
```

If the worktree contains unrelated prior edits, do not stage them.

---

### Task 2: Add Server Printed-State Service

**Files:**
- Create: `retail_pos_server/src/v1/cloud/cloud.item-sheet.printed.service.ts`

- [ ] **Step 1: Create the service file**

Create `retail_pos_server/src/v1/cloud/cloud.item-sheet.printed.service.ts` with:

```ts
import db from "../../libs/db";
import {
  HttpException,
  InternalServerException,
} from "../../libs/exceptions";

type PrintedSheetUser = {
  id?: number;
  name?: string;
};

export async function getPrintedLabelUpdateSheetIdsService() {
  try {
    const rows = await db.printedItemSheet.findMany({
      select: { sheetId: true },
      orderBy: { sheetId: "asc" },
    });

    return {
      ok: true,
      result: rows.map((row) => row.sheetId),
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("getPrintedLabelUpdateSheetIdsService error:", e);
    throw new InternalServerException();
  }
}

export async function markLabelUpdateSheetPrintedService(
  sheetId: number,
  user?: PrintedSheetUser,
) {
  try {
    const row = await db.printedItemSheet.upsert({
      where: { sheetId },
      create: {
        sheetId,
        userId: user?.id,
        userName: user?.name,
      },
      update: {},
      select: { sheetId: true },
    });

    return {
      ok: true,
      result: { sheetId: row.sheetId },
    };
  } catch (e) {
    if (e instanceof HttpException) throw e;
    console.error("markLabelUpdateSheetPrintedService error:", e);
    throw new InternalServerException();
  }
}
```

- [ ] **Step 2: Run server build to catch generated-client or type errors**

Run:

```bash
cd retail_pos_server
npm run build
```

Expected:

- TypeScript build succeeds.
- If `db.printedItemSheet` is missing, return to Task 1 and rerun `npx prisma generate`.

- [ ] **Step 3: Commit service**

```bash
git add retail_pos_server/src/v1/cloud/cloud.item-sheet.printed.service.ts
git commit -m "feat: add printed item sheet service"
```

---

### Task 3: Add Server Controllers And Routes

**Files:**
- Modify: `retail_pos_server/src/v1/cloud/cloud.item-sheet.controller.ts`
- Modify: `retail_pos_server/src/v1/cloud/cloud.router.ts`

- [ ] **Step 1: Import printed-state service functions**

At the top of `retail_pos_server/src/v1/cloud/cloud.item-sheet.controller.ts`, add:

```ts
import {
  getPrintedLabelUpdateSheetIdsService,
  markLabelUpdateSheetPrintedService,
} from "./cloud.item-sheet.printed.service";
```

The top of the file should include the existing imports plus the new service import:

```ts
import { Response, Request } from "express";
import apiService, { getCloudQs } from "../../libs/cloud.api";
import { parseIntId } from "../../libs/query";
import {
  getPrintedLabelUpdateSheetIdsService,
  markLabelUpdateSheetPrintedService,
} from "./cloud.item-sheet.printed.service";
```

- [ ] **Step 2: Add controller functions**

Append these functions to `cloud.item-sheet.controller.ts`:

```ts
export async function getPrintedLabelUpdateSheetIdsController(
  _req: Request,
  res: Response,
) {
  const result = await getPrintedLabelUpdateSheetIdsService();
  res.status(200).json(result);
}

export async function markLabelUpdateSheetPrintedController(
  req: Request,
  res: Response,
) {
  const id = parseIntId(req, "id");
  const user = res.locals.user
    ? { id: res.locals.user.id, name: res.locals.user.name }
    : undefined;
  const result = await markLabelUpdateSheetPrintedService(id, user);
  res.status(200).json(result);
}
```

This stores user metadata only if a future caller has populated `res.locals.user`. The current cloud route normally has terminal context but no user middleware, so the mark still persists without user metadata.

- [ ] **Step 3: Register routes before `/:id`**

Modify `retail_pos_server/src/v1/cloud/cloud.router.ts` imports to include the new controllers:

```ts
import {
  getLabelUpdateByIdController,
  getLabelUpdatesController,
  getPrintedLabelUpdateSheetIdsController,
  markLabelUpdateSheetPrintedController,
} from "./cloud.item-sheet.controller";
```

Then replace the label-update route section with this exact order:

```ts
cloudRouter.get("/item-sheet/label-update", getLabelUpdatesController);
cloudRouter.get(
  "/item-sheet/label-update/printed",
  getPrintedLabelUpdateSheetIdsController,
);
cloudRouter.post(
  "/item-sheet/label-update/:id/printed",
  markLabelUpdateSheetPrintedController,
);
cloudRouter.get("/item-sheet/label-update/:id", getLabelUpdateByIdController);
```

The `/printed` route must appear before `/:id`.

- [ ] **Step 4: Run server build**

Run:

```bash
cd retail_pos_server
npm run build
```

Expected:

- Build exits 0.

- [ ] **Step 5: Commit controller and route changes**

```bash
git add retail_pos_server/src/v1/cloud/cloud.item-sheet.controller.ts retail_pos_server/src/v1/cloud/cloud.router.ts
git commit -m "feat: expose printed item sheet API"
```

---

### Task 4: Add Renderer API Helpers

**Files:**
- Modify: `retail_pos_app/src/renderer/src/service/cloud.service.ts`

- [ ] **Step 1: Add printed-state response type**

After the imports in `cloud.service.ts`, add:

```ts
export type PrintedLabelUpdateSheetResult = {
  sheetId: number;
};
```

- [ ] **Step 2: Add API helper functions**

At the end of `cloud.service.ts`, add:

```ts
export async function getPrintedLabelUpdateSheetIds(): Promise<
  ApiResponse<number[]>
> {
  return apiService.get<number[]>(
    `/api/cloud/item-sheet/label-update/printed`,
  );
}

export async function markLabelUpdateSheetPrinted(
  id: number | string,
): Promise<ApiResponse<PrintedLabelUpdateSheetResult>> {
  return apiService.post<PrintedLabelUpdateSheetResult>(
    `/api/cloud/item-sheet/label-update/${id}/printed`,
  );
}
```

- [ ] **Step 3: Run app build**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected:

- Build exits 0.

- [ ] **Step 4: Commit app service helper**

```bash
git add retail_pos_app/src/renderer/src/service/cloud.service.ts
git commit -m "feat: add printed item sheet client APIs"
```

---

### Task 5: Replace LocalStorage-Backed Printed State In Renderer

**Files:**
- Modify: `retail_pos_app/src/renderer/src/components/priceTags/PrintItemPriceTagSheet.tsx`

- [ ] **Step 1: Import new API helpers**

Replace the existing cloud service import:

```ts
import {
  getCloudLabelUpdateSheetById,
  migrateDataFromCloudServer,
} from "../../service/cloud.service";
```

with:

```ts
import {
  getCloudLabelUpdateSheetById,
  getPrintedLabelUpdateSheetIds,
  markLabelUpdateSheetPrinted,
  migrateDataFromCloudServer,
} from "../../service/cloud.service";
```

- [ ] **Step 2: Add migration storage prefix**

Keep the existing prefix and add a second prefix below it:

```ts
const QUEUE_PAGE_SIZE = 10;
const PRINTED_SHEET_STORAGE_PREFIX = "pos.printedItemSheetIds";
const PRINTED_SHEET_MIGRATION_PREFIX = "pos.printedItemSheetIdsMigrated";
```

- [ ] **Step 3: Add migration key**

Below `printedSheetStorageKey`, add:

```ts
  const printedSheetMigrationKey = terminal
    ? `${PRINTED_SHEET_MIGRATION_PREFIX}.${terminal.id}`
    : null;
```

- [ ] **Step 4: Replace the localStorage loading effect**

Replace the current effect:

```ts
  useEffect(() => {
    if (!printedSheetStorageKey) return;
    setPrintedSheetIds(readPrintedSheetIds(printedSheetStorageKey));
  }, [printedSheetStorageKey]);
```

with this server-backed effect:

```ts
  useEffect(() => {
    let cancelled = false;

    async function loadPrintedSheetIds() {
      const res = await getPrintedLabelUpdateSheetIds();
      if (cancelled) return;

      if (res.ok && res.result) {
        setPrintedSheetIds(new Set(res.result));
      }
    }

    loadPrintedSheetIds().catch((err) => {
      console.error("Failed to load printed item sheet ids:", err);
    });

    return () => {
      cancelled = true;
    };
  }, []);
```

This fetch failure is non-blocking and does not prevent printing.

- [ ] **Step 5: Add one-time localStorage migration effect**

Below the server-backed loading effect, add:

```ts
  useEffect(() => {
    if (!printedSheetStorageKey || !printedSheetMigrationKey) return;
    if (localStorage.getItem(printedSheetMigrationKey) === "1") return;

    const oldIds = [...readPrintedSheetIds(printedSheetStorageKey)];
    if (oldIds.length === 0) {
      localStorage.setItem(printedSheetMigrationKey, "1");
      return;
    }

    let cancelled = false;

    async function migratePrintedSheetIds() {
      const migratedIds: number[] = [];
      for (const sheetId of oldIds) {
        const res = await markLabelUpdateSheetPrinted(sheetId);
        if (!res.ok || !res.result) {
          throw new Error(res.msg || "Failed to migrate printed sheet id");
        }
        migratedIds.push(res.result.sheetId);
      }

      if (cancelled) return;

      setPrintedSheetIds((prev) => {
        const next = new Set(prev);
        for (const sheetId of migratedIds) next.add(sheetId);
        return next;
      });
      localStorage.setItem(printedSheetMigrationKey, "1");
    }

    migratePrintedSheetIds().catch((err) => {
      console.error("Failed to migrate printed item sheet ids:", err);
    });

    return () => {
      cancelled = true;
    };
  }, [printedSheetMigrationKey, printedSheetStorageKey]);
```

Migration promotes old per-terminal ids to store-global ids. It does not delete the old key.

- [ ] **Step 6: Replace `markSheetPrinted`**

Replace the existing localStorage-writing function:

```ts
  const markSheetPrinted = (sheetId: number) => {
    if (!printedSheetStorageKey) return;
    setPrintedSheetIds((prev) => {
      const next = new Set(prev);
      next.add(sheetId);
      localStorage.setItem(
        printedSheetStorageKey,
        JSON.stringify([...next].sort((a, b) => a - b)),
      );
      return next;
    });
  };
```

with:

```ts
  const markSheetPrinted = async (sheetId: number) => {
    const res = await markLabelUpdateSheetPrinted(sheetId);
    if (!res.ok || !res.result) {
      window.alert(
        res.msg ||
          "Labels were printed, but the Printed marker could not be saved.",
      );
      return;
    }

    setPrintedSheetIds((prev) => {
      const next = new Set(prev);
      next.add(res.result.sheetId);
      return next;
    });
  };
```

- [ ] **Step 7: Await server persistence after successful printing**

In `handlePrint`, replace:

```ts
      markSheetPrinted(selectedSheet.id);
```

with:

```ts
      await markSheetPrinted(selectedSheet.id);
```

This makes UI state update only after server persistence succeeds.

- [ ] **Step 8: Run app build**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected:

- Build exits 0.

- [ ] **Step 9: Commit renderer persistence change**

```bash
git add retail_pos_app/src/renderer/src/components/priceTags/PrintItemPriceTagSheet.tsx
git commit -m "feat: persist printed item sheet state in POS server"
```

---

### Task 6: End-To-End Verification

**Files:**
- Verify only. No file edits expected.

- [ ] **Step 1: Confirm working tree scope**

Run:

```bash
git status --short
```

Expected:

- Only intentional files from this feature are changed or committed.
- Any pre-existing unrelated edits remain unstaged and unmodified.

- [ ] **Step 2: Run server build**

Run:

```bash
cd retail_pos_server
npm run build
```

Expected:

- Build exits 0.

- [ ] **Step 3: Run app build**

Run:

```bash
cd retail_pos_app
npm run build
```

Expected:

- Build exits 0.

- [ ] **Step 4: Manual API smoke check**

With the POS server running, call the endpoint with the same `ip-address` header the renderer sends. Replace `192.168.0.10` with a registered local terminal IP:

```bash
curl -H "ip-address: 192.168.0.10" http://localhost:2200/api/cloud/item-sheet/label-update/printed
```

Expected response shape:

```json
{
  "ok": true,
  "result": []
}
```

If rows already exist, `result` may contain positive integer sheet ids.

- [ ] **Step 5: Manual print flow QA**

In the POS app:

1. Open `Price Tag`.
2. Switch to `Item Sheet`.
3. Confirm label-update sheets load as before.
4. Print a label-update sheet successfully.
5. Confirm that sheet immediately shows the `Printed` badge.
6. Restart the app.
7. Confirm the same sheet still shows `Printed`.
8. Open another terminal connected to the same POS server.
9. Confirm the same sheet shows `Printed` there too.

- [ ] **Step 6: Failed-print QA**

Use a controlled printer failure, such as selecting an unavailable printer, then attempt to print a sheet.

Expected:

- Print failure alert appears.
- The sheet is not marked `Printed`.
- `GET /api/cloud/item-sheet/label-update/printed` does not gain that sheet id.

- [ ] **Step 7: Failed-marker QA**

Temporarily stop the POS server after a successful printer transport is available, or simulate a network failure after print transport in a local test environment.

Expected:

- Labels may print.
- The app alerts: `Labels were printed, but the Printed marker could not be saved.`
- The sheet does not show a new persisted badge until the server POST succeeds.

- [ ] **Step 8: Migration QA**

Before opening the screen, seed old browser storage for the current terminal:

```js
localStorage.setItem("pos.printedItemSheetIds.1", JSON.stringify([123]));
localStorage.removeItem("pos.printedItemSheetIdsMigrated.1");
```

Open `Price Tag > Item Sheet`.

Expected:

- The app posts sheet id `123` to the POS server.
- `localStorage.getItem("pos.printedItemSheetIdsMigrated.1")` becomes `"1"`.
- The old `pos.printedItemSheetIds.1` value remains.
- Sheet `123` shows `Printed` if it appears in the sheet list.

- [ ] **Step 9: Final status**

Run:

```bash
git status --short
```

Expected:

- No unexpected generated files.
- No unrelated edits staged.

If committing in one final commit rather than per task, stage only these feature files:

```bash
git add retail_pos_server/prisma/schema.prisma \
  retail_pos_server/src/generated/prisma \
  retail_pos_server/src/v1/cloud/cloud.item-sheet.printed.service.ts \
  retail_pos_server/src/v1/cloud/cloud.item-sheet.controller.ts \
  retail_pos_server/src/v1/cloud/cloud.router.ts \
  retail_pos_app/src/renderer/src/service/cloud.service.ts \
  retail_pos_app/src/renderer/src/components/priceTags/PrintItemPriceTagSheet.tsx
git commit -m "feat: persist printed item sheet state"
```

---

## Implementation Notes

- The old localStorage key remains useful only for one-time migration.
- The new source of truth is `PrintedItemSheet.sheetId` in the local POS server database.
- Route order matters. `GET /item-sheet/label-update/printed` must be registered before `GET /item-sheet/label-update/:id`.
- `sheetId` is a cloud/API-server `ItemSheet.id`; the POS server does not need to validate it against a local table.
- Do not add `terminalId`; printed state is store-global.
- Do not change `SearchItemSheetList` unless the badge display itself needs visual adjustment.
