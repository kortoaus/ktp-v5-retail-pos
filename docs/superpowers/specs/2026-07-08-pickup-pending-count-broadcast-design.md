# Pickup Pending Count Broadcast Design

## Goal

Broadcast the current number of pending pickup orders from the retail POS server to both the retail POS client and the scale tablet app, so operators can see today's pending pickup backlog without manually opening or refreshing the pickup order list.

## Scope

This feature spans three runtimes:

- `ktpv5-pos-retail/retail_pos_server`: owns the local pickup order cache and Socket.IO server.
- `ktpv5-pos-retail/retail_pos_app`: displays the count in the Electron POS client.
- `ktpv5-scale`: displays the count on the tablet pickup tab and pickup screen.

The count is a small realtime signal only. It does not replace the existing pickup order list APIs, detail APIs, manual refresh behavior, status update flow, or pickup sync flow.

## Count Definition

The server computes the count from the local POS database:

- Table/model: `PickupOrderCache`
- Status: `PENDING`
- Pickup start range: from Australia/Sydney start of today through the future
- No upper date bound

The start boundary must use Australia/Sydney business day semantics:

```ts
moment.tz("Australia/Sydney").startOf("day").toDate()
```

The server must not call CRM every 10 seconds. CRM sync remains owned by the existing pickup sync worker and manual sync endpoint.

## Socket Event

Use a dedicated pickup event. Do not reuse `cloud-sync-completed`, app restart IPC, or any cloud sync event.

Event name:

```txt
pickup-order:pending-count
```

Payload:

```ts
export type PickupPendingCountPayload = {
  count: number;
  from: string;
  generatedAt: string;
  intervalMs: number;
};
```

Fields:

- `count`: current pending pickup order count.
- `from`: ISO timestamp for Australia/Sydney start of today.
- `generatedAt`: server timestamp for when the snapshot was computed.
- `intervalMs`: broadcast interval, initially `10000`.

## Server Design

Add a focused pending-count broadcaster under the pickup-order server module.

Responsibilities:

- Count pending pickup orders from local DB.
- Emit the snapshot to all Socket.IO clients.
- Emit a snapshot to a newly connected Socket.IO client immediately.
- Emit a snapshot to all clients every 10 seconds.
- Emit a snapshot immediately after pickup order sync completes.
- Emit a snapshot immediately after a POS-driven pickup status update succeeds.

Suggested files:

- Modify `retail_pos_server/src/v1/pickup-order/pickup-order.repository.ts`
  - Add `countPendingPickupOrdersFrom(from: Date): Promise<number>`.
- Create `retail_pos_server/src/v1/pickup-order/pickup-order.pending-count.ts`
  - Export event name, payload type, snapshot builder, `emitPickupPendingCount`, `emitPickupPendingCountToSocket`, and `startPickupPendingCountBroadcaster`.
- Modify `retail_pos_server/src/index.ts`
  - On `connection`, call `emitPickupPendingCountToSocket(socket)`.
  - After server listen, call `startPickupPendingCountBroadcaster()`.
- Modify pickup sync flow
  - After successful `pickupOrderSyncService.syncPickupOrders()`, call `emitPickupPendingCount()`.
- Modify pickup status update flow
  - After `updatePickupOrderStatusFromPos` succeeds and before returning the response, call `emitPickupPendingCount()`.

Error handling:

- A failed count query must be logged and must not crash the server.
- Interval overlap should be avoided with a small in-flight guard.
- If Socket.IO is not initialized, emit helpers should log or no-op rather than break HTTP status updates.

## POS Client Design

The POS client already depends on `socket.io-client@^4.8.3`, so no install is required in `retail_pos_app`.

Use a component-level socket connection, matching the existing `SyncButton` style.

Suggested file:

- Create `retail_pos_app/src/renderer/src/components/pickupOrders/PickupPendingCountButton.tsx`

Component responsibilities:

- Mount: connect to `apiService.getBaseURL()` via Socket.IO.
- Subscribe to `pickup-order:pending-count`.
- Store latest payload locally.
- Track connection state.
- Disconnect on unmount.
- Render a compact clickable count button.

Props:

```ts
type Props = {
  onRefresh: () => void;
};
```

Click behavior:

- If currently on the pickup orders page, call `onRefresh()`.
- If placed outside the pickup page later, it may navigate to `/manager/pickup-orders` or the existing pickup route before refreshing. Initial implementation should place it in the pickup page header and use `onRefresh`.

UI behavior:

- Connected and loaded: `Pending today: N`
- Before first payload: `Pending today: -`
- Disconnected/reconnecting: keep the last count visible with reduced opacity or a small disconnected style.

Mount location:

- Modify `retail_pos_app/src/renderer/src/screens/PickupOrderSearchScreen.tsx`.
- Add the button in the header.
- Pass `onRefresh={() => searchPanelRef.current?.refreshCurrentPage()}`.

## Scale Tablet Design

The scale tablet app does not currently include `socket.io-client`.

Install:

```bash
cd /Users/dev/ktpv5/ktpv5-scale
npm install socket.io-client@^4.8.3
```

This dependency is pure JavaScript. It does not require a new native dev-client build. Expo/Metro should be restarted so the JS dependency is bundled.

The tablet should not open sockets from individual pickup screen components. The count needs to be visible in the tab bar even when the pickup screen is not mounted, and the pickup page header should share the same count. Use one app-level or tabs-level provider.

Suggested files:

- Modify `ktpv5-scale/api/apiService.ts`
  - Add `getBaseURL(): string | undefined`.
- Create `ktpv5-scale/context/pickupPendingCountContext.tsx`
  - Own the single Socket.IO connection.
  - Expose latest payload and connection state via `usePickupPendingCount()`.
- Modify `ktpv5-scale/app/(tabs)/_layout.tsx`
  - Mount `PickupPendingCountProvider` around the tab layout.
  - Show the pending count as a badge on the Pickup tab.
- Create `ktpv5-scale/components/pickupOrders/PickupPendingCountBadge.tsx`
  - Render count from `usePickupPendingCount()`.
  - Accept `onRefresh`.
  - On press, call `onRefresh()`.
- Modify `ktpv5-scale/components/pickupOrders/PickupOrderSearchScreen.tsx`
  - Add the badge in the screen header.
  - Pass `onRefresh={() => searchPanelRef.current?.refreshCurrentPage()}`.

Provider behavior:

- Connect only when `apiService.getBaseURL()` returns a configured POS server URL.
- Use Socket.IO reconnect options:

```ts
{
  transports: ["websocket", "polling"],
  reconnection: true,
  reconnectionAttempts: Infinity,
  reconnectionDelay: 1000,
  reconnectionDelayMax: 10000,
  timeout: 10000,
}
```

Connection states:

- `connected`: true after `connect`.
- `connected`: false after `disconnect` or `connect_error`.
- Keep the last known count while disconnected.
- After reconnect, rely on the server's connection-time snapshot emit to refresh immediately.

## Reconnection Guarantees

Socket.IO client reconnection is enabled on both clients. Correctness depends on the server emitting the current snapshot on every new socket connection. That ensures a recovered client receives the current count immediately rather than waiting up to 10 seconds.

Clients should not reset count to zero on disconnect. A disconnect means stale, not empty.

## Interaction With Existing Pickup Flows

The broadcast count does not change:

- Pickup order search filters.
- Pickup order list pagination.
- Pickup detail modal.
- Status transition validation.
- Print history behavior.
- Pending label print confirmation flow.
- CRM pickup sync cursor behavior.

The count should update promptly when:

- A pickup sync inserts or updates pending orders.
- A pending order is confirmed through status action.
- A pending order is confirmed after successful label printing.
- A pending order is cancelled.
- The 10-second interval notices a DB change caused by another process.

## Validation

Server:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_server
npm run build
```

POS client:

```bash
cd /Users/dev/ktpv5/ktpv5-pos-retail/retail_pos_app
npm run build
```

Scale:

```bash
cd /Users/dev/ktpv5/ktpv5-scale
npx tsc --noEmit --pretty false
npm run lint
git diff --check
```

Manual checks:

1. Start the POS server.
2. Open the POS pickup screen and confirm the pending count appears in the header.
3. Open the scale tablet app and confirm the Pickup tab badge shows the same count.
4. Confirm or cancel a pending pickup order.
5. Confirm the count decreases without waiting for the 10-second interval.
6. Stop and restart the POS server or disconnect/reconnect the client network.
7. Confirm the clients reconnect and receive the current count snapshot.

## Out Of Scope

- Broadcasting full pickup order lists.
- CRM polling every 10 seconds.
- Replacing existing pickup list refresh behavior.
- Member filter work in the scale app.
- Any Discord notification.
