// node --experimental-strip-types --test src/renderer/src/libs/scale-browse-page-policy.test.mjs
import assert from "node:assert/strict";
import test from "node:test";
import { applyBrowsePage, initialBrowseListState } from "./scale-browse-page-policy.ts";

const success = (result, hasNext = true) => ({ ok: true, result, msg: "", hasNext });
const failure = { ok: false, result: null, msg: "Network error", hasNext: false };
const first = () => applyBrowsePage(initialBrowseListState(), { append: false, page: 1 }, success([1, 2]));

test("new panel starts empty without errors or cached paging", () => {
  const state = initialBrowseListState();
  assert.deepEqual(state, { items: [], page: 1, hasMore: false, error: null, loadMoreError: null });
  state.items.push(1);
  assert.deepEqual(initialBrowseListState().items, []);
});

test("first search failure replaces old results with a full-panel error", () => {
  assert.deepEqual(applyBrowsePage(first(), { append: false, page: 1 }, failure), {
    items: [], page: 1, hasMore: false, error: "Network error", loadMoreError: null,
  });
});

test("failed append preserves every loaded page and the unconsumed tail", () => {
  const loaded = applyBrowsePage(first(), { append: true, page: 2 }, success([3, 4]));
  const failed = applyBrowsePage(loaded, { append: true, page: 3 }, failure);
  assert.deepEqual(failed, { ...loaded, loadMoreError: "Network error" });
  assert.equal(failed.items, loaded.items);
  assert.equal(loaded.loadMoreError, null);
  assert.equal(failed.page + 1, 3);
  assert.equal(failed.hasMore, true);
});

test("repeated append failure can retry the same page then append once", () => {
  let state = first();
  for (let i = 0; i < 2; i++) {
    state = applyBrowsePage(state, { append: true, page: state.page + 1 }, failure);
  }
  const recovered = applyBrowsePage(state, { append: true, page: state.page + 1 }, success([3], false));
  assert.deepEqual(recovered, { items: [1, 2, 3], page: 2, hasMore: false, error: null, loadMoreError: null });
});

test("retrying the first page clears errors; a new search replaces old pages", () => {
  const failed = applyBrowsePage(first(), { append: false, page: 1 }, failure);
  assert.deepEqual(applyBrowsePage(failed, { append: false, page: 1 }, success([9])), {
    items: [9], page: 1, hasMore: true, error: null, loadMoreError: null,
  });
  const failedAppend = applyBrowsePage(first(), { append: true, page: 2 }, failure);
  assert.deepEqual(applyBrowsePage(failedAppend, { append: false, page: 1 }, success([])), {
    items: [], page: 1, hasMore: true, error: null, loadMoreError: null,
  });
});

test("null successful payload is failure; empty successful results are not an error", () => {
  const nullResult = { ...failure, ok: true };
  assert.equal(applyBrowsePage(first(), { append: false, page: 1 }, nullResult).error, "Network error");
  assert.equal(applyBrowsePage(first(), { append: true, page: 2 }, nullResult).loadMoreError, "Network error");
  assert.deepEqual(applyBrowsePage(first(), { append: false, page: 1 }, {
    ok: true, result: [], msg: "", hasNext: undefined,
  }), { items: [], page: 1, hasMore: false, error: null, loadMoreError: null });
});
