import assert from "node:assert/strict";
import test from "node:test";

import {
  assertObjectName,
  downloadObjectHeader,
  escapeFieldData,
  hostDirectory,
  objectDelete,
  parseDirectoryListing,
  parsePrinterIdentity,
  proofLabel,
  PROOF_SAMPLE,
} from "./commands.ts";

test("downloadObjectHeader matches the form in the ZPL guide", () => {
  assert.equal(
    downloadObjectHeader("E:", "NOTOKRM", 6222432),
    "~DYE:NOTOKRM.TTF,B,T,6222432,,",
  );
});

test("downloadObjectHeader rejects names ~DY cannot store", () => {
  assert.throws(() => downloadObjectHeader("E:", "TOOLONGNAME", 1), /1-8/);
  assert.throws(() => downloadObjectHeader("E:", "noto-kr", 1), /alphanumeric/);
  assert.throws(() => assertObjectName(""), /1-8/);
});

test("downloadObjectHeader rejects a size the printer could not act on", () => {
  assert.throws(() => downloadObjectHeader("E:", "NOTOKRM", 0), /positive integer/);
  assert.throws(() => downloadObjectHeader("E:", "NOTOKRM", 1.5), /positive integer/);
});

test("parseDirectoryListing reads entries and free space through framing", () => {
  const raw =
    "\x02*E:NOTOKRM.TTF   6222432\r\n" +
    "*E:NOTOKRB.TTF   6222712\r\n" +
    "-46137344 bytes free E:FLASH\r\n\x03";
  const { entries, freeBytes } = parseDirectoryListing(raw);

  assert.equal(entries.length, 2);
  assert.deepEqual(entries[0], { drive: "E:", filename: "NOTOKRM.TTF", size: 6222432 });
  assert.equal(freeBytes, 46137344);
});

test("parseDirectoryListing tolerates the printer's own font list", () => {
  // Verbatim shape observed on a ZD421 running V93.21.37Z.
  const raw = "*E:CG_TIMES.TTF     62259\r\n*E:TT0003M_.TTF    169200\r\n";
  const { entries, freeBytes } = parseDirectoryListing(raw);

  assert.deepEqual(entries.map((e) => e.filename), ["CG_TIMES.TTF", "TT0003M_.TTF"]);
  // That firmware reported no parseable free-space line, so this must stay null
  // rather than becoming a number callers would trust.
  assert.equal(freeBytes, null);
});

test("parseDirectoryListing returns empty for a drive with nothing on it", () => {
  assert.deepEqual(parseDirectoryListing("\x02-67108864 bytes free E:FLASH\x03"), {
    entries: [],
    freeBytes: 67108864,
  });
});

test("parsePrinterIdentity reads dots per millimetre and derives dpi", () => {
  const id = parsePrinterIdentity("\x02ZD421-200dpi,V93.21.37Z,8,008192KB,X\x03\r\n");
  assert.deepEqual(id, {
    model: "ZD421-200dpi",
    firmware: "V93.21.37Z",
    dpmm: 8,
    dpi: 203,
  });
});

test("parsePrinterIdentity handles 300 dpi", () => {
  assert.equal(parsePrinterIdentity("ZD421,V93.21.37Z,12,008192KB")?.dpi, 305);
});

test("parsePrinterIdentity returns null rather than guessing", () => {
  assert.equal(parsePrinterIdentity("UNKNOWN RESPONSE"), null);
  assert.equal(parsePrinterIdentity("ZD421,V1,9,x"), null);
  assert.equal(parsePrinterIdentity(""), null);
});

test("escapeFieldData escapes the caret ZPL would read as a command", () => {
  assert.equal(escapeFieldData("!@#$%^&*()[]"), "!@#$%_5E&*()[]");
});

test("escapeFieldData escapes tilde and underscore", () => {
  assert.equal(escapeFieldData("a~b_c"), "a_7Eb_5Fc");
});

test("escapeFieldData does not re-escape the underscores it introduces", () => {
  assert.equal(escapeFieldData("^~"), "_5E_7E");
  assert.equal(escapeFieldData("_^"), "_5F_5E");
});

test("escapeFieldData leaves hangul and plain ASCII alone", () => {
  assert.equal(escapeFieldData("가나다 한글 ABC 123"), "가나다 한글 ABC 123");
});

const FONTS = [
  { filename: "NOTOKRM.TTF", weight: "Medium" },
  { filename: "NOTOKRB.TTF", weight: "Bold" },
];

test("proofLabel sizes the label in dots from millimetres", () => {
  const zpl = proofLabel({ dpmm: 8, widthMm: 100, heightMm: 100, fonts: FONTS });
  assert.match(zpl, /\^PW800/);
  assert.match(zpl, /\^LL800/);
});

test("proofLabel leaves label length to the printer when height is omitted", () => {
  const zpl = proofLabel({ dpmm: 8, widthMm: 70, fonts: FONTS });
  assert.match(zpl, /\^PW560/);
  assert.doesNotMatch(zpl, /\^LL/);
});

test("proofLabel selects UTF-8 so hangul field data is interpreted", () => {
  assert.match(proofLabel({ dpmm: 8, widthMm: 100, fonts: FONTS }), /\^CI28/);
});

test("proofLabel captions each row with a built-in font", () => {
  // A row whose sample is blank still has to say which weight failed.
  const zpl = proofLabel({ dpmm: 8, widthMm: 100, fonts: FONTS });
  const caption = zpl.split("\n").find((l) => l.includes("Medium"));
  assert.match(caption, /\^A0N/);
  assert.doesNotMatch(caption, /\^A@/);
});

test("proofLabel draws each sample with its downloaded font", () => {
  const zpl = proofLabel({ dpmm: 8, widthMm: 100, fonts: FONTS });
  for (const font of FONTS) {
    const row = zpl
      .split("\n")
      .find((l) => l.includes(`E:${font.filename}`) && l.includes(PROOF_SAMPLE));
    assert.ok(row, `no sample row for ${font.filename}`);
    assert.match(row, /\^A@N/);
  }
});

test("proofLabel enables ^FH on every field carrying escapable data", () => {
  const zpl = proofLabel({ dpmm: 8, widthMm: 100, fonts: FONTS });
  for (const line of zpl.split("\n")) {
    if (line.includes("^FD")) assert.match(line, /\^FH\^FD/);
  }
});

test("proofLabel keeps the sample inside the printable width", () => {
  // Hangul is full-width, so cell count is a fair proxy for advance width.
  for (const widthMm of [70, 100]) {
    const zpl = proofLabel({ dpmm: 8, widthMm, fonts: FONTS });
    const glyph = Number(zpl.match(/\^A@N,(\d+),/)[1]);
    const margin = 16;
    assert.ok(
      [...PROOF_SAMPLE].length * glyph <= widthMm * 8 - margin * 2,
      `sample overflows a ${widthMm}mm label at ${glyph} dots`,
    );
  }
});

test("proofLabel scales layout for a 300 dpi printer", () => {
  const zpl = proofLabel({ dpmm: 12, widthMm: 100, fonts: FONTS });
  assert.match(zpl, /\^PW1200/);
});

test("proofLabel escapes a caller-supplied sample", () => {
  const zpl = proofLabel({ dpmm: 8, widthMm: 100, fonts: FONTS, sample: "a^b~c" });
  assert.match(zpl, /\^FDa_5Eb_7Ec\^FS/);
});

test("query builders", () => {
  assert.equal(hostDirectory(), "^XA^HWE:*.*^XZ");
  assert.equal(hostDirectory("E:*.TTF"), "^XA^HWE:*.TTF^XZ");
  assert.equal(objectDelete("E:", "NOTOKRM.TTF"), "^XA^IDE:NOTOKRM.TTF^FS^XZ");
});
