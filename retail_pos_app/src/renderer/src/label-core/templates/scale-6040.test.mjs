// npm run test:label-core
import assert from "node:assert/strict";
import test from "node:test";

import { buildScaleLabel6040, formatDmy, formatScaleDates } from "./scale-6040.ts";
import { MEDIA } from "../media.ts";
import { elementBounds, renderLabel } from "../zpl.ts";

/**
 * The values of `docs/label-mockups/6040-pre-1d.zpl` — the hand-written ZPL the
 * owner printed on the pre-printed red-grid stock on 2026-08-26 and confirmed
 * fits the grid. Every coordinate asserted below is that file's.
 */
const SAMPLE = {
  nameKo: "모듬사시미 (테스트)",
  nameEn: "Assorted Sashimi",
  packedOnIso: "2026-08-26",
  usedByIso: "2026-08-27",
  weightText: "0.512",
  unit: "kg",
  unitPriceText: "$55.00",
  wasUnitPriceText: "$62.00",
  totalText: "$28.16",
  storeName: "DREAM MARKET",
  storeAddress: "42-50 Rowe St. Eastwood NSW 2122",
};

const ONE_D = { ...SAMPLE, barcode: { kind: "ean13", data12: "200000102816" } };
const TWO_D = {
  ...SAMPLE,
  barcode: {
    kind: "pp",
    qrData: '00:{"00":2,"01":"9300001","04":512,"07":"2026-08-26","08":1}',
  },
};

/** Cells the values must land in, from the pre-printed grid (dots, 203 dpi). */
const GRID = {
  topRule: 67,
  bottomRule: 229,
  symbolZone: { x0: 15, x1: 243, y0: 67, y1: 229 },
  packedCell: { x0: 245, x1: 322 },
  usedByCell: { x0: 322, x1: 392 },
  netCell: { x0: 392, x1: 470 },
  unitPriceCell: { x0: 248, x1: 343, y0: 102, y1: 207 },
  priceCell: { x0: 356, x1: 470, y0: 142, y1: 211 },
};

test("1D reproduces the confirmed pre-printed mockup, field for field", () => {
  const zpl = renderLabel(buildScaleLabel6040(ONE_D));

  for (const line of [
    "^PW480",
    "^LL320",
    // name, above the top red rule
    "^FO18,4^A@N,30,27,E:NOTOKRB.TTF^FB450,1,0,L,0^FH^FD모듬사시미 (테스트)^FS",
    "^FO18,36^A@N,24,22,E:NOTOKRM.TTF^FB450,1,0,L,0^FH^FDAssorted Sashimi^FS",
    // header value row — PACKED ON / USE BY / NET kg
    "^FO228,106^A@N,24,22,E:NOTOKRB.TTF^FB90,1,0,C,0^FH^FD26/08^FS",
    "^FO322,106^A@N,24,22,E:NOTOKRB.TTF^FB70,1,0,C,0^FH^FD27/08^FS",
    "^FO394,106^A@N,24,22,E:NOTOKRB.TTF^FB76,1,0,C,0^FH^FD0.512^FS",
    // $/kg cell
    "^FO250,142^A@N,30,27,E:NOTOKRB.TTF^FB92,1,0,C,0^FH^FD$55.00^FS",
    "^FO252,180^A@N,18,16,E:NOTOKRM.TTF^FB88,1,0,C,0^FH^FDwas $62.00^FS",
    // PRICE cell — right-aligned, no "$" (the stock prints one at x≈347)
    "^FO356,150^A@N,44,40,E:NOTOKRBK.TTF^FB114,1,0,R,0^FH^FD28.16^FS",
    // symbol zone
    "^FO34,80^BY2,3,90^BEN,90,Y,N^FH^FD200000102816^FS",
    // footer, below the bottom red rule
    "^FO0,238^A@N,30,27,E:NOTOKRBK.TTF^FB480,1,0,C,0^FH^FDDREAM MARKET^FS",
    "^FO0,276^A@N,18,16,E:NOTOKRM.TTF^FB480,1,0,C,0^FH^FD42-50 Rowe St. Eastwood NSW 2122^FS",
  ]) {
    assert.ok(zpl.includes(line), `missing: ${line}`);
  }
});

test("the pre-printed captions are never reprinted", () => {
  const zpl = renderLabel(buildScaleLabel6040(ONE_D));
  for (const caption of ["PACKED", "USE BY", "Use by", "Packed", "NET", "Weight", "TOTAL", "$/kg"]) {
    assert.ok(!zpl.includes(caption), `${caption} is on the stock already`);
  }
});

test("the total loses its dollar sign — the stock has one", () => {
  const zpl = renderLabel(buildScaleLabel6040(ONE_D));
  assert.ok(zpl.includes("^FH^FD28.16^FS"), zpl);
  assert.ok(!zpl.includes("^FH^FD$28.16^FS"), "no second $ in the PRICE cell");

  // A caller that already stripped it gets the same output.
  const bare = renderLabel(buildScaleLabel6040({ ...ONE_D, totalText: "28.16" }));
  assert.ok(bare.includes("^FH^FD28.16^FS"));

  // The unit price keeps its sign: that cell's caption is `$/kg`, not `$`.
  assert.ok(zpl.includes("^FH^FD$55.00^FS"));
});

test("the was-price rule is measured and centred in the $/kg cell", () => {
  const label = buildScaleLabel6040(ONE_D);
  const was = label.elements.find((el) => el.kind === "text" && el.text.startsWith("was "));
  const rule = label.elements.find((el) => el.kind === "line");

  assert.ok(was && rule, "a was-price and its rule");
  assert.equal(rule.y, was.y + Math.round(was.size / 2), "half a cell down, through the digits");
  assert.ok(rule.w <= was.width, `rule ${rule.w} must stay inside the cell`);
  assert.ok(rule.x >= GRID.unitPriceCell.x0, "rule starts inside the $/kg cell");
  assert.ok(rule.x + rule.w <= GRID.unitPriceCell.x1, "rule ends inside the $/kg cell");

  // Shorter price, shorter rule — the mockup's hand-drawn width would not move.
  const short = buildScaleLabel6040({ ...ONE_D, wasUnitPriceText: "$5.00" });
  const shortRule = short.elements.find((el) => el.kind === "line");
  assert.ok(shortRule.w < rule.w, `${shortRule.w} < ${rule.w}`);
});

test("2D swaps the EAN for a PP QR and changes nothing else", () => {
  const oneD = renderLabel(buildScaleLabel6040(ONE_D)).split("\n");
  const twoD = renderLabel(buildScaleLabel6040(TWO_D)).split("\n");

  assert.ok(!twoD.join("\n").includes("^BEN"), "no linear barcode on the 2D variant");
  assert.ok(
    twoD.includes(`^FO60,80^BQN,2,3,M^FH^FDMA,${TWO_D.barcode.qrData}^FS`),
    twoD.join("\n"),
  );

  // Every non-symbol line is identical: the grid fixes the rest of the label.
  const strip = (lines) => lines.filter((l) => !l.includes("^BEN") && !l.includes("^BQN"));
  assert.deepEqual(strip(twoD), strip(oneD));
});

test("nothing lands outside 480 × 320, on either variant", () => {
  const [pageW, pageH] = MEDIA["6040"].dots;
  for (const input of [ONE_D, TWO_D]) {
    for (const el of buildScaleLabel6040(input).elements) {
      const box = elementBounds(el);
      assert.ok(box.x >= 0 && box.y >= 0, `${el.kind} starts on the label`);
      assert.ok(box.x + box.w <= pageW, `${el.kind} right edge ${box.x + box.w} > ${pageW}`);
      assert.ok(box.y + box.h <= pageH, `${el.kind} bottom ${box.y + box.h} > ${pageH}`);
    }
  }
});

test("the symbol stays inside the zone the grid leaves for it", () => {
  for (const input of [ONE_D, TWO_D]) {
    const el = buildScaleLabel6040(input).elements.find(
      (e) => e.kind === "barcode" || e.kind === "qr",
    );
    const box = elementBounds(el);
    assert.ok(box.x >= GRID.symbolZone.x0, `${el.kind} left ${box.x}`);
    assert.ok(box.x + box.w <= GRID.symbolZone.x1, `${el.kind} right ${box.x + box.w}`);
    assert.ok(box.y >= GRID.symbolZone.y0, `${el.kind} top ${box.y}`);
  }
});

test("the footer and the was-price are optional", () => {
  const zpl = renderLabel(
    buildScaleLabel6040({
      ...ONE_D,
      wasUnitPriceText: null,
      storeName: null,
      storeAddress: null,
    }),
  );

  assert.ok(!zpl.includes("DREAM MARKET"));
  assert.ok(!zpl.includes("was "));
  assert.ok(!zpl.includes("^GB"), "no strike without a was-price");
  assert.ok(zpl.includes("28.16"), "the total still prints");
});

test("dbg rides through to the emitter", () => {
  assert.equal(buildScaleLabel6040(ONE_D).dbg, false);
  assert.equal(buildScaleLabel6040(ONE_D, { dbg: true }).dbg, true);
  assert.ok(renderLabel(buildScaleLabel6040(ONE_D, { copies: 3 })).includes("^PQ3"));
});

// ---------------------------------------------------------------------------
// formatScaleDates
// ---------------------------------------------------------------------------

test("same year drops the year and keeps the grid's 24", () => {
  const dates = formatScaleDates("2026-08-26", "2026-08-27");
  assert.deepEqual(dates, { packed: "26/08", usedBy: "27/08", size: 24 });
});

test("same year across a month boundary still drops the year", () => {
  const dates = formatScaleDates("2026-08-31", "2026-09-03");
  assert.deepEqual(dates, { packed: "31/08", usedBy: "03/09", size: 24 });
});

test("different years print DD/MM/YY on both dates and shrink together", () => {
  const dates = formatScaleDates("2026-08-26", "2027-01-05");
  assert.equal(dates.packed, "26/08/26");
  assert.equal(dates.usedBy, "05/01/27");
  assert.ok(dates.size < 24, `shrunk from 24, got ${dates.size}`);
  assert.ok(dates.size >= 14, `never below the floor, got ${dates.size}`);
});

test("the year boundary: 31/12 → 01/01 is the case the year exists for", () => {
  const dates = formatScaleDates("2026-12-31", "2027-01-01");
  assert.equal(dates.packed, "31/12/26");
  assert.equal(dates.usedBy, "01/01/27");
  assert.ok(dates.size < 24);

  // Without the year these two would read as out of order on the shelf.
  const sameYear = formatScaleDates("2026-12-30", "2026-12-31");
  assert.deepEqual(sameYear, { packed: "30/12", usedBy: "31/12", size: 24 });
});

test("both dates always print at one size", () => {
  for (const [a, b] of [
    ["2026-08-26", "2026-08-27"],
    ["2026-12-31", "2027-01-01"],
    ["2025-01-01", "2026-01-01"],
  ]) {
    const dates = formatScaleDates(a, b);
    const label = buildScaleLabel6040({ ...ONE_D, packedOnIso: a, usedByIso: b });
    const sizes = label.elements
      .filter((el) => el.kind === "text" && (el.text === dates.packed || el.text === dates.usedBy))
      .map((el) => el.size);
    assert.equal(sizes.length, 2, `${a} → ${b}`);
    assert.equal(sizes[0], sizes[1]);
  }
});

test("a shrunk date still fits its pre-printed cell", () => {
  const label = buildScaleLabel6040({
    ...ONE_D,
    packedOnIso: "2026-12-31",
    usedByIso: "2027-01-01",
  });
  const [packed, usedBy] = label.elements.filter(
    (el) => el.kind === "text" && el.text.includes("/") && el.y === 106,
  );

  assert.ok(packed.x + packed.width <= GRID.usedByCell.x0, "packed stops before the USE BY cell");
  assert.ok(usedBy.x + usedBy.width <= GRID.netCell.x0, "use-by stops before the NET cell");
});

test("a non-ISO date passes through rather than printing an empty cell", () => {
  assert.equal(formatDmy("26/08/26", true), "26/08/26");
  assert.equal(formatDmy("", true), "");
  const dates = formatScaleDates("26/08/26", "27/08/26");
  assert.equal(dates.packed, "26/08/26");
  assert.equal(dates.usedBy, "27/08/26");
});

test("formatDmy is the one date formatter both scale labels share", () => {
  assert.equal(formatDmy("2026-08-26", false), "26/08");
  assert.equal(formatDmy("2026-08-26", true), "26/08/26");
  assert.equal(formatDmy("2027-01-01", true), "01/01/27");
});
