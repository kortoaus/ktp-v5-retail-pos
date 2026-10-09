import assert from "node:assert/strict";
import test from "node:test";

import {
  STORE_SCREEN_POST_LIMIT,
  isStoreScreenPostLive,
  parseStoreScreenPostLimit,
  selectStoreScreenPosts,
} from "./cloud.post.service";
import { BadRequestException } from "../../libs/exceptions";

const NOW = new Date("2026-10-09T02:00:00.000Z"); // 13:00 Sydney (AEDT)
const BEFORE = "2026-10-09T01:59:59.000Z";
const AFTER = "2026-10-09T02:00:01.000Z";

type Row = {
  id: number;
  status: string;
  eventEndAt?: string | null;
  autoArchivedAt?: string | null;
  archived?: boolean;
};

const live = (id: number, extra: Partial<Row> = {}): Row => ({
  id,
  status: "published",
  eventEndAt: null,
  ...extra,
});

test("limit is five", () => {
  assert.equal(STORE_SCREEN_POST_LIMIT, 5);
});

test("undated published post is shown", () => {
  assert.equal(isStoreScreenPostLive({ status: "published" }, NOW), true);
  assert.equal(isStoreScreenPostLive(live(1), NOW), true);
});

test("expired post (eventEndAt before now) is dropped", () => {
  assert.equal(isStoreScreenPostLive(live(1, { eventEndAt: BEFORE }), NOW), false);
});

test("future-ended post (eventEndAt after now) is shown", () => {
  assert.equal(isStoreScreenPostLive(live(1, { eventEndAt: AFTER }), NOW), true);
});

test("post ending exactly now is still shown (ended = strictly before now, as the kiosk)", () => {
  assert.equal(isStoreScreenPostLive(live(1, { eventEndAt: NOW.toISOString() }), NOW), true);
});

test("archived status is dropped", () => {
  assert.equal(isStoreScreenPostLive(live(1, { status: "archived" }), NOW), false);
  assert.equal(isStoreScreenPostLive(live(1, { status: "draft" }), NOW), false);
  assert.equal(isStoreScreenPostLive({}, NOW), false);
});

test("archived flag is dropped", () => {
  assert.equal(isStoreScreenPostLive(live(1, { archived: true }), NOW), false);
});

test("auto-archived post (autoArchivedAt at or before now) is dropped; future auto-archive is shown", () => {
  assert.equal(isStoreScreenPostLive(live(1, { autoArchivedAt: BEFORE }), NOW), false);
  assert.equal(isStoreScreenPostLive(live(1, { autoArchivedAt: NOW.toISOString() }), NOW), false);
  assert.equal(isStoreScreenPostLive(live(1, { autoArchivedAt: AFTER }), NOW), true);
});

test("Date values and unparseable dates", () => {
  assert.equal(isStoreScreenPostLive({ status: "published", eventEndAt: new Date(BEFORE) }, NOW), false);
  assert.equal(isStoreScreenPostLive({ status: "published", eventEndAt: "not a date" }, NOW), true);
});

test("owner example: five fetched, two ended or archived → rotate three, CRM order kept", () => {
  const rows = [
    live(10),
    live(9, { eventEndAt: BEFORE }),
    live(8, { eventEndAt: AFTER }),
    live(7, { status: "archived" }),
    live(6),
  ];
  assert.deepEqual(
    selectStoreScreenPosts(rows, 5, NOW).map((r) => r.id),
    [10, 8, 6],
  );
});

test("cut to the newest five before filtering (a sixth live post does not back-fill)", () => {
  const rows = [live(7, { eventEndAt: BEFORE }), live(6), live(5), live(4), live(3), live(2), live(1)];
  assert.deepEqual(
    selectStoreScreenPosts(rows, 5, NOW).map((r) => r.id),
    [6, 5, 4, 3],
  );
});

test("never more than the limit even if CRM ignores it", () => {
  const rows = Array.from({ length: 20 }, (_, i) => live(20 - i));
  const picked = selectStoreScreenPosts(rows, STORE_SCREEN_POST_LIMIT, NOW);
  assert.equal(picked.length, 5);
  assert.deepEqual(picked.map((r) => r.id), [20, 19, 18, 17, 16]);
});

test("parseStoreScreenPostLimit: absent → 5, numeric kept, capped at 5, junk → 400", () => {
  assert.equal(parseStoreScreenPostLimit(undefined), 5);
  assert.equal(parseStoreScreenPostLimit(""), 5);
  assert.equal(parseStoreScreenPostLimit("5"), 5);
  assert.equal(parseStoreScreenPostLimit("3"), 3);
  assert.equal(parseStoreScreenPostLimit("20"), 5);
  for (const bad of ["0", "-1", "2.5", "abc", ["5"], 5]) {
    assert.throws(() => parseStoreScreenPostLimit(bad), BadRequestException);
  }
});
