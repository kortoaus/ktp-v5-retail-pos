// npm run test:label-core
import assert from "node:assert/strict";
import test from "node:test";

import {
  buildScaleLabel6040,
  formatDmy,
  formatScaleDates,
  layoutName6040,
} from "./scale-6040.ts";
import { MEDIA } from "../media.ts";
import { elementBounds, renderLabel } from "../zpl.ts";
import { buildPPBarcodeString } from "../../libs/pp-barcode.ts";

/**
 * The values of `docs/label-mockups/6040-pre-1d.zpl` — the hand-written ZPL the
 * owner printed on the pre-printed red-grid stock on 2026-08-26 and confirmed
 * fits the grid. Every coordinate asserted below is that file's.
 */
const SAMPLE = {
  /** Carried, never printed on this label — the assertion below is the point. */
  nameKo: "모듬사시미 (테스트)",
  nameEn: "DS Salmon Sashimi (A)",
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

/**
 * The PP payload built the way the screen builds it — through the canonical
 * builder, on the real POS item PLU, with five price levels and five promo
 * levels. That is the *long* case: 140 bytes, one version short of what the
 * emitter is sized for, so the snapshot below is a realistic symbol rather than
 * a toy one.
 */
const PP_QR = buildPPBarcodeString({
  barcode: "0213436",
  prices: [6200, 5900, 5700, 5500, 5300],
  promoPrices: [5500, 5300, 5100, 4900, 4700],
  weight: 512,
  discountType: "pct",
  discountAmount: 300,
  packedOn: "2026-08-26",
  usedBy: 1,
});

const ONE_D = { ...SAMPLE, barcode: { kind: "ean13", data12: "200000102816" } };
const TWO_D = { ...SAMPLE, barcode: { kind: "pp", qrData: PP_QR } };

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
    // name, above the top red rule — English only, centred, one line at 30
    "^FO18,14^A@N,30,27,E:NOTOKRB.TTF^FB450,1,0,C,0^FH^FDDS Salmon Sashimi (A)^FS",
    // header value row — PACKED ON / USE BY / NET kg
    "^FO228,106^A@N,24,22,E:NOTOKRB.TTF^FB90,1,0,C,0^FH^FD26/08^FS",
    "^FO322,106^A@N,24,22,E:NOTOKRB.TTF^FB70,1,0,C,0^FH^FD27/08^FS",
    "^FO394,106^A@N,24,22,E:NOTOKRB.TTF^FB76,1,0,C,0^FH^FD0.512^FS",
    // $/kg cell
    "^FO250,142^A@N,30,27,E:NOTOKRB.TTF^FB92,1,0,C,0^FH^FD$55.00^FS",
    "^FO252,180^A@N,18,16,E:NOTOKRM.TTF^FB88,1,0,C,0^FH^FDwas $62.00^FS",
    // PRICE cell — right-aligned, no "$" (the stock prints one at x≈347)
    "^FO356,150^A@N,44,40,E:NOTOKRBK.TTF^FB114,1,0,R,0^FH^FD28.16^FS",
    // symbol zone — y 90, the 2026-08-26 revision of the mockup (it was 80).
    "^FO34,90^BY2,3,90^BEN,90,Y,N^FH^FD200000102816^FS",
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

  // The line the owner scanned off a ZD421 on 2026-08-26, character for
  // character. ^FT (not ^FO) so the symbol grows up off the red rule at y 229;
  // mag 2; no ^BQ correction-level parameter, because this firmware ignores it;
  // `LA,` so the payload is encoded in automatic mode — manual mode ate the
  // `"`, `[` and `]` out of exactly this payload.
  assert.ok(twoD.includes(`^FT54,205^BQN,2,2^FH^FDLA,${PP_QR}^FS`), twoD.join("\n"));

  // Every non-symbol line is identical: the grid fixes the rest of the label.
  const strip = (lines) => lines.filter((l) => !l.includes("^BEN") && !l.includes("^BQN"));
  assert.deepEqual(strip(twoD), strip(oneD));
});

test("the 2D QR clears the pre-printed rule whatever the payload does", () => {
  for (const qrData of [PP_QR, "00:{}", `00:${"x".repeat(140)}`]) {
    const el = buildScaleLabel6040({ ...SAMPLE, barcode: { kind: "pp", qrData } }).elements.find(
      (e) => e.kind === "qr",
    );
    const box = elementBounds(el);
    assert.equal(box.y + box.h, 205, `bottom edge is anchored, got ${box.y + box.h}`);
    assert.ok(box.y > GRID.topRule, `top ${box.y} must stay under the top rule`);
    assert.ok(box.y + box.h < GRID.bottomRule, "and clear of the bottom rule");
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

// ---------------------------------------------------------------------------
// The unit correction — the stock says `$/kg`, the item may not be sold by it
// ---------------------------------------------------------------------------

test("a kilogram item leaves the pre-printed $/kg caption alone", () => {
  const label = buildScaleLabel6040(ONE_D);
  assert.ok(!label.elements.some((el) => el.kind === "text" && el.text.startsWith("$/")));
  assert.ok(!renderLabel(label).includes("^FO297,216"), "no rule over the caption");
});

test("an each-priced item strikes the caption and names the real unit", () => {
  // The replacement goes to the caption's LEFT: the PRICE box starts at x 356.
  // These coordinates are measured off the artwork and not yet grid-checked on
  // hardware — see the constants' comment in the template.
  const zpl = renderLabel(buildScaleLabel6040({ ...ONE_D, unit: "EA", weightText: "1 EA" }));

  assert.ok(zpl.includes("^FO297,216^GB42,2,2^FS"), zpl);
  assert.ok(zpl.includes("^FO252,206^A@N,18,16,E:NOTOKRB.TTF^FH^FD$/EA^FS"), zpl);
  // The NET cell takes the caller's free text verbatim — no unit appended here.
  assert.ok(zpl.includes("^FH^FD1 EA^FS"), zpl);

  const lower = renderLabel(buildScaleLabel6040({ ...ONE_D, unit: "100g" }));
  assert.ok(lower.includes("^FH^FD$/100G^FS"), lower);
});

test("dbg rides through to the emitter", () => {
  assert.equal(buildScaleLabel6040(ONE_D).dbg, false);
  assert.equal(buildScaleLabel6040(ONE_D, { dbg: true }).dbg, true);
  assert.ok(renderLabel(buildScaleLabel6040(ONE_D, { copies: 3 })).includes("^PQ3"));
});

// ---------------------------------------------------------------------------
// The name band — English only, centred, one line at 30 or two at 24
// ---------------------------------------------------------------------------

test("the Korean name never reaches the 60 x 40 label", () => {
  const zpl = renderLabel(buildScaleLabel6040({ ...ONE_D, nameKo: "모듬사시미 (테스트)" }));
  assert.ok(!zpl.includes("모듬사시미"), "nameKo is carried for the 58 x 100 label, not printed here");
  assert.ok(zpl.includes("DS Salmon Sashimi (A)"), "nameEn is the only name on this label");

  // And it is the *only* text field above the top red rule.
  const above = buildScaleLabel6040(ONE_D).elements.filter(
    (el) => el.kind === "text" && el.y < GRID.topRule,
  );
  assert.equal(above.length, 1);
  assert.equal(above[0].align, "C");
});

test("a short name gets one Bold 30 line, centred in the band", () => {
  // 22 characters, mixed case — inside the 95% of 450 the rule allows.
  assert.deepEqual(layoutName6040("DS Salmon Sashimi 100g"), { size: 30, lines: 1, y: 14 });
  // 24 characters, UPPERCASE — capitals are wider, and this one still fits.
  assert.deepEqual(layoutName6040("DS SALMON SASHIMI (AUST)"), { size: 30, lines: 1, y: 14 });
});

test("a long name gets two Bold 24 lines, moved up to make room", () => {
  // 34 mixed-case characters: too wide for one line at 30, comfortable at 24.
  assert.deepEqual(layoutName6040("DS Salmon Sashimi Premium Pack 1kg"), {
    size: 24,
    lines: 2,
    y: 6,
  });
  // 28 UPPERCASE characters — four fewer than the mixed case needs, because
  // capitals measure 0.63 em against lower case's 0.55.
  assert.deepEqual(layoutName6040("DS SALMON SASHIMI (AUS) 100G"), { size: 24, lines: 2, y: 6 });
});

test("a name too long for two lines of 24 shrinks, and stops at 20", () => {
  const sixty = layoutName6040("A".repeat(60));
  assert.equal(sixty.lines, 2);
  assert.ok(sixty.size < 24, `shrunk from 24, got ${sixty.size}`);
  assert.ok(sixty.size >= 20, `never below the floor, got ${sixty.size}`);

  // Past anything a product name plausibly is, it clamps rather than vanishing.
  assert.equal(layoutName6040("A".repeat(400)).size, 20);
});

test("the legacy scale tag is measured with the name, not stripped from it", () => {
  // The screen adapter prepends `[30% OFF] ` / `[$1.00 OFF] `; the template only
  // measures what it is handed. The tag is what pushes this 21-character name
  // (one line at 30 on its own) onto two lines.
  assert.deepEqual(layoutName6040("DS Salmon Sashimi (A)"), { size: 30, lines: 1, y: 14 });
  assert.deepEqual(layoutName6040("[30% OFF] DS Salmon Sashimi (A)"), {
    size: 24,
    lines: 2,
    y: 6,
  });

  const zpl = renderLabel(
    buildScaleLabel6040({ ...ONE_D, nameEn: "[30% OFF] DS Salmon Sashimi (A)" }),
  );
  assert.ok(
    zpl.includes("^FO18,6^A@N,24,22,E:NOTOKRB.TTF^FB450,2,0,C,0^FH^FD[30% OFF] DS Salmon Sashimi (A)^FS"),
    zpl,
  );
});

test("the name band never reaches the top red rule", () => {
  for (const nameEn of [
    "DS Salmon Sashimi (A)",
    "DS Salmon Sashimi Premium Pack 1kg",
    "NS Shin Black Big Bowl 101g Premium Extra Value Pack",
    "A".repeat(400),
  ]) {
    const el = buildScaleLabel6040({ ...ONE_D, nameEn }).elements.find((e) => e.kind === "text");
    const box = elementBounds(el);
    assert.equal(box.x + box.w, 468, "the block stays on the media");
    assert.ok(box.y + box.h <= GRID.topRule, `${nameEn} ends at ${box.y + box.h}`);
  }
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
