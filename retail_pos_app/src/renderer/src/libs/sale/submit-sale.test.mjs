// npm run test:sale-core (retail-runner T-1) — sale submission + operationId.
import assert from "node:assert/strict";
import test from "node:test";

// The till's attempt store is localStorage (libs/operation-id.ts reads it at
// call time); node has none, so install an in-memory one.
const mem = new Map();
Object.defineProperty(globalThis, "localStorage", {
  configurable: true,
  value: {
    getItem: (k) => (mem.has(k) ? mem.get(k) : null),
    setItem: (k, v) => mem.set(k, String(v)),
    removeItem: (k) => mem.delete(k),
  },
});

const { submitSale, submitSpend, sendSaleWithOperation, SALE_MESSAGES } = await import(
  "./submit-sale.ts"
);
const { createTenderState, selectTender, tenderReducer } = await import("./tender-queue.ts");
const { buildNewLine, createEmptyCart } = await import("../../store/SalesStore.helper.ts");

const RATES = { creditSurchargeRate: 15, cashPointRate: 10, otherPointRate: 10 };

function cartOf(cents, over = {}) {
  const line = buildNewLine(
    {
      type: "normal",
      itemId: 1,
      name_en: "Milk",
      name_ko: "우유",
      price: { prices: [cents] },
      promoPrice: null,
      taxable: false,
      isPointExcluded: false,
      uom: "ea",
      barcode: "9300000000017",
    },
    0,
    0,
  );
  return { ...createEmptyCart(), lines: [line], ...over };
}

// Tender state → the inputs the modal hands submitSale.
function tendered(cart, ...actions) {
  const state = actions.reduce(tenderReducer, createTenderState());
  const { cal } = selectTender(state, {
    lines: cart.lines,
    rates: RATES,
    hasMember: cart.member != null,
  });
  return { cal, payments: state.payments, stagedPayment: state.staged };
}

function recorder(answers) {
  const bodies = [];
  const request = async (body) => {
    bodies.push(body);
    const next = answers.shift();
    if (!next) throw new Error("unexpected request");
    return next;
  };
  return { bodies, request };
}

test.beforeEach(() => mem.clear());

test("replayed operationId: the retry resends the same id and returns the existing Invoice", async () => {
  const cart = cartOf(1002);
  const t = tendered(cart, { type: "set-cash-received", cashReceived: 2000 });
  const input = { cart, cartIndex: 2, ...t };
  const { bodies, request } = recorder([
    { ok: false, status: 0, msg: "Network Error", result: null },
    { ok: true, status: 200, msg: "", result: { id: 41, serial: "S-0041", replayed: true } },
    { ok: true, status: 200, msg: "", result: { id: 42, serial: "S-0042" } },
  ]);

  const lost = await submitSale(input, request);
  assert.deepEqual(lost, { ok: false, message: "Network Error" });

  const replay = await submitSale(input, request);
  assert.equal(bodies[0].operationId, bodies[1].operationId, "same attempt, same id");
  assert.equal(typeof bodies[0].operationId, "string");
  assert.equal(replay.ok, true);
  assert.equal(replay.invoice.id, 41, "the Invoice the server already recorded");
  assert.equal(
    replay.replayNotice,
    "This sale was already recorded (S-0041) — nothing was charged twice.",
  );

  // The ok answer settled the attempt: the next sale from that slot is new.
  const next = await submitSale(input, request);
  assert.notEqual(bodies[2].operationId, bodies[1].operationId);
  assert.equal(next.replayNotice, null);
});

test("payload, completed info and change for a CASH sale with rounding", async () => {
  const cart = cartOf(1002, {
    member: { id: "m1", name: "Kim", level: 1, phone_last4: "1234", points: 900 },
  });
  const t = tendered(cart, { type: "set-cash-received", cashReceived: 2000 });
  const { bodies, request } = recorder([
    { ok: true, status: 200, msg: "", result: { id: 7, serial: null } },
  ]);
  const out = await submitSale({ cart, cartIndex: 0, ...t }, request);
  const body = bodies[0];
  assert.equal(body.type, "SALE");
  assert.equal(body.rounding, -2);
  assert.equal(body.total, 1000);
  assert.equal(body.cashChange, 1000);
  assert.deepEqual(body.payments, [{ type: "CASH", amount: 1000 }]);
  assert.equal(body.member.phoneLast4, "1234");
  assert.equal("externalOrderId" in body, false);
  assert.deepEqual(out.completed, {
    invoice: { id: 7, serial: null },
    total: 1000,
    paid: 1000,
    cashReceived: 2000,
    change: 1000,
    receiptPrinted: false,
    memberPointsBefore: 900,
    order: null,
  });
  assert.notEqual(body.rows[0], cart.lines[0], "rows come from a cart snapshot");
});

test("split CASH + staged CREDIT: the ready draft goes in without ADD", async () => {
  const cart = cartOf(10001);
  const t = tendered(
    cart,
    { type: "set-cash-received", cashReceived: 5000 },
    { type: "commit-staged", key: "c1" },
    { type: "change-slot", slot: "CREDIT" },
    { type: "set-credit-bill", billPortion: 5001, left: 5001, surchargeRate: 15 },
  );
  const { bodies, request } = recorder([{ ok: true, msg: "", result: { id: 9, serial: "S9" } }]);
  await submitSale({ cart, cartIndex: 1, ...t }, request);
  assert.deepEqual(bodies[0].payments, [
    { type: "CASH", amount: 5000 },
    { type: "CREDIT", amount: 5076 },
  ]);
  assert.equal(bodies[0].creditSurchargeAmount, 75);
  assert.equal(bodies[0].total, 10076);
});

test("order-loaded cart: externalOrderId sent, collect result mapped (old servers too)", async () => {
  const cart = cartOf(500, { externalOrderId: "ord-1", orderNo: null });
  const t = tendered(cart, { type: "set-cash-received", cashReceived: 500 });
  const { bodies, request } = recorder([
    { ok: true, msg: "", result: { id: 1, serial: "A", collectResult: "conflict" } },
    { ok: true, msg: "", result: { id: 2, serial: "B", collectSynced: true } },
    { ok: true, msg: "", result: { id: 3, serial: "C" } },
  ]);
  const a = await submitSale({ cart, cartIndex: 0, ...t }, request);
  assert.equal(bodies[0].externalOrderId, "ord-1");
  assert.deepEqual(a.completed.order, { orderNo: "ord-1", collectResult: "conflict" });
  const b = await submitSale({ cart, cartIndex: 0, ...t }, request);
  assert.equal(b.completed.order.collectResult, "collected");
  const c = await submitSale({ cart, cartIndex: 0, ...t }, request);
  assert.equal(c.completed.order.collectResult, "pending");
});

test("a settling 409 ends the attempt; OPERATION_IN_PROGRESS keeps it", async () => {
  const payload = { type: "SALE" };
  const ids = [];
  const answer = (res) => async (body) => (ids.push(body.operationId), res);
  await sendSaleWithOperation(payload, 3, answer({ ok: false, msg: "", result: { code: "OPERATION_IN_PROGRESS" } }));
  await sendSaleWithOperation(payload, 3, answer({ ok: false, msg: "", result: { code: "OPERATION_PAYLOAD_MISMATCH" } }));
  await sendSaleWithOperation(payload, 3, answer({ ok: true, msg: "", result: {} }));
  assert.equal(ids[0], ids[1]);
  assert.notEqual(ids[1], ids[2]);
});

test("cart slots are separate attempts", async () => {
  const ids = [];
  const req = async (body) => (ids.push(body.operationId), { ok: false, status: 0, msg: "x" });
  await sendSaleWithOperation({}, 0, req);
  await sendSaleWithOperation({}, 1, req);
  assert.notEqual(ids[0], ids[1]);
});

test("failure without a message falls back to the screen text", async () => {
  const cart = cartOf(100);
  const t = tendered(cart, { type: "set-cash-received", cashReceived: 100 });
  const out = await submitSale({ cart, cartIndex: 0, ...t }, async () => ({ ok: true, msg: "", result: null }));
  assert.deepEqual(out, { ok: false, message: SALE_MESSAGES.saleFailed });
});

test("SPEND: zero amounts, no payments, no operationId", async () => {
  const cart = cartOf(1234);
  const bodies = [];
  const ok = await submitSpend(cart, async (b) => (bodies.push(b), { ok: true, msg: "", result: { id: 5 } }));
  assert.deepEqual(ok, { ok: true, invoice: { id: 5 } });
  assert.equal(bodies[0].type, "SPEND");
  assert.equal(bodies[0].total, 0);
  assert.deepEqual(bodies[0].payments, []);
  assert.equal(bodies[0].rows[0].total, 0);
  assert.equal("operationId" in bodies[0], false);
  const failed = await submitSpend(cart, async () => ({ ok: false, msg: "" }));
  assert.deepEqual(failed, { ok: false, message: "Failed to record spend" });
});
