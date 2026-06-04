# Persist Label Update Printed State Design

## Goal

Make the `Printed` marker for label-update item sheets survive POS app version updates and browser storage resets.

When any terminal in the store successfully prints a label-update sheet, every terminal connected to the same local POS server should show that sheet as `Printed`.

## Current Behavior

`PrintItemPriceTagSheet` stores printed sheet ids in renderer `localStorage` using a terminal-specific key:

```text
pos.printedItemSheetIds.{terminal.id}
```

The value is a JSON array of cloud item sheet ids, for example:

```json
[12, 15, 19]
```

`SearchItemSheetList` receives this set and shows the `Printed` badge when `printedSheetIds.has(sheet.id)` is true.

This is fragile because the marker is tied to browser storage. App upgrades, profile resets, or terminal replacement can remove the history.

## Scope

In scope:

- Store printed label-update sheet ids in the local POS server database.
- Treat printed state as global for the store/local POS server, not per terminal.
- Load printed sheet ids from the POS server when the price-tag item-sheet screen mounts.
- Mark a sheet as printed only after the print job succeeds.
- Keep the existing `Printed` badge UI behavior.
- Optionally migrate existing localStorage ids once, then continue using server persistence.

Out of scope:

- Cloud API schema changes in `ktpv5-api-server`.
- Web client changes.
- Global multi-store printed status.
- Row-level printed status.
- Printer job auditing beyond the fact that a sheet was marked printed.
- Changing label-update sheet creation, editing, search, or cloud proxy behavior.

## Decision

Use POS-local persistence in `retail_pos_server`.

Do not use `terminalId`. The business rule is that a label-update sheet only needs to be printed once per store. If terminal A prints sheet `123`, terminal B should also see sheet `123` as printed.

Do not add this field to the cloud `ItemSheet` model for this iteration. The local POS server is the store-local execution point for physical label printing, and the immediate pain is local upgrade/reset loss.

## Data Model

Add a Prisma model to `retail_pos_server/prisma/schema.prisma`:

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

Notes:

- `sheetId` is the cloud/API-server `ItemSheet.id`.
- `sheetId` is unique because printed state is store-global.
- No relation to a local item-sheet table is needed because the POS server does not store cloud item sheets locally today; it proxies label-update sheet reads.
- `userId` and `userName` are optional metadata. If the request has an authenticated user in `res.locals`, store it. If not, still mark the sheet printed.

Apply the schema with the repo's current POS-server workflow:

```bash
cd retail_pos_server
npx prisma db push
npx prisma generate
```

## Server API

Add focused server handlers under the existing cloud item-sheet area.

Recommended routes:

```text
GET  /api/cloud/item-sheet/label-update/printed
POST /api/cloud/item-sheet/label-update/:id/printed
```

The existing label-update sheet routes remain unchanged:

```text
GET /api/cloud/item-sheet/label-update
GET /api/cloud/item-sheet/label-update/:id
```

### `GET /printed`

Returns all printed sheet ids known to the local POS server:

```ts
ApiResponse<number[]>
```

Response example:

```json
{
  "ok": true,
  "result": [12, 15, 19]
}
```

The result should be sorted ascending for stable client state.

### `POST /:id/printed`

Marks one sheet id as printed.

Behavior:

- Parse `id` with the existing id parser.
- Upsert by `sheetId`.
- If the row already exists, return success without creating a duplicate.
- If user metadata is available, write it on create. Do not overwrite the original metadata on repeated posts.

Response:

```ts
ApiResponse<{ sheetId: number }>
```

Response example:

```json
{
  "ok": true,
  "result": { "sheetId": 12 }
}
```

## App API Client

Extend `retail_pos_app/src/renderer/src/service/cloud.service.ts` with:

```ts
export async function getPrintedLabelUpdateSheetIds(): Promise<ApiResponse<number[]>>;

export async function markLabelUpdateSheetPrinted(
  id: number | string,
): Promise<ApiResponse<{ sheetId: number }>>;
```

These should call the new POS server routes.

## Renderer Behavior

Update `PrintItemPriceTagSheet`:

- Remove the normal dependency on `localStorage` for current printed state.
- On mount, fetch printed ids from `getPrintedLabelUpdateSheetIds()`.
- Store them in the existing `printedSheetIds: Set<number>` state.
- After both 70x30 and 70x90 print paths complete successfully, call `markLabelUpdateSheetPrinted(selectedSheet.id)`.
- Update local state only after the server marks the sheet printed.
- Keep passing `printedSheetIds` to `SearchItemSheetList`.

The `Printed` badge remains purely presentational in `SearchItemSheetList`.

## Optional LocalStorage Migration

Because existing terminals may already have useful localStorage history, add a conservative one-time migration.

Migration behavior:

1. Read the previous key for the current terminal:

   ```text
   pos.printedItemSheetIds.{terminal.id}
   ```

2. Parse it with the existing defensive number-array logic.
3. POST each id to `markLabelUpdateSheetPrinted`.
4. Merge successfully posted ids into the fetched server set.
5. Write a migration marker to localStorage:

   ```text
   pos.printedItemSheetIdsMigrated.{terminal.id}
   ```

6. Do not delete the old localStorage value during this iteration.

This migration intentionally promotes old per-terminal printed history to store-global printed history. That matches the new business rule: if one terminal had recorded a sheet as printed, the store can treat it as printed.

If any migration POST fails, skip the migration marker so the app can retry later.

## Error Handling

Printed-state loading failure should not block label printing.

If `GET /printed` fails:

- Show the sheet list with no printed markers or any currently loaded state.
- Do not alert on screen mount unless there is already a local pattern for non-blocking fetch errors in this screen.

If `POST /:id/printed` fails after a successful print:

- Keep the print job successful.
- Alert the operator that labels were printed but the printed marker could not be saved.
- Do not mark the sheet as printed in UI state unless the server confirms persistence.

If migration fails:

- Do not block the screen.
- Do not set the migration marker.
- Continue using whatever printed ids were loaded from the server.

## Data Flow

```text
Screen mount
  -> GET /api/cloud/item-sheet/label-update/printed
  -> Set<number> in PrintItemPriceTagSheet
  -> SearchItemSheetList shows Printed badges

Successful print
  -> POST /api/cloud/item-sheet/label-update/:id/printed
  -> POS server upserts PrintedItemSheet(sheetId)
  -> Renderer adds id to Set<number>
  -> SearchItemSheetList shows Printed badge
```

The existing cloud sheet list fetch remains:

```text
POS app -> local POS server -> cloud device API -> local POS server -> POS app
```

Printed-state persistence stays local:

```text
POS app -> local POS server database
```

## Verification

Server:

```bash
cd retail_pos_server
npx prisma db push
npx prisma generate
npm run build
```

App:

```bash
cd retail_pos_app
npm run build
```

Manual QA:

- Open Price Tag > Item Sheet.
- Confirm sheets load as before.
- Print a label-update sheet successfully.
- Confirm the sheet immediately shows `Printed`.
- Restart the POS app and confirm the same sheet still shows `Printed`.
- Open another terminal connected to the same POS server and confirm the same sheet shows `Printed`.
- Confirm app version update/browser storage reset does not clear server-backed printed state.
- Confirm a failed printer send does not mark the sheet printed.
- Confirm a failed `POST /printed` after successful printing alerts the operator and does not show a persisted badge until the server saves it.
- If migration is implemented, seed old localStorage ids and confirm they are promoted to server-backed printed ids once.

## Risks

- `printLabel` success means the job was handed to the configured printer transport; it does not prove labels physically came out. This matches the current print-flow assumption.
- Store-global printed status can hide a sheet from attention even if the first terminal printed it on the wrong media or printer. This is accepted by the requirement that one successful terminal print is enough.
- If the local POS database is rebuilt from scratch, printed state will be lost unless database backup/restore includes the new table.
- Local-only persistence means a different store-local POS server will not know about printed state from another server. That is intentional for this iteration.

## Estimated Effort

Implementation estimate: 2-4 hours.

With optional localStorage migration, manual QA across two terminals, and both app/server builds: about half a day.
