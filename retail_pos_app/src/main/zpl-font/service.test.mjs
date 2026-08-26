import assert from "node:assert/strict";
import test from "node:test";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";

import { MockPrinter } from "./mock-printer.mjs";
import { createZplFontService } from "./service.ts";
import { FONTS } from "./catalog.ts";
import { PROOF_SAMPLE, PROOF_BUILTIN_REFERENCE, PROOF_VERDICT } from "./commands.ts";

/** The real bundled fonts that ship in the installer. */
const REAL_FONT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../../resources/fonts",
);

/**
 * A stand-in font directory with valid TrueType headers and hostile bodies.
 *
 * The payload is packed with ZPL control characters: if the transport were
 * escaping or splitting on them, the stored object would come back the wrong
 * size. Small files keep the tests quick — the real ones are ~2.5MB each.
 */
async function fakeFontDir(sizeBytes = 40_000) {
  const dir = await mkdtemp(path.join(tmpdir(), "zpl-font-"));
  for (const [i, spec] of FONTS.entries()) {
    const body = Buffer.alloc(sizeBytes + i * 1_000);
    body.writeUInt32BE(0x00010000, 0); // TrueType magic
    const hostile = Buffer.from("^XZ~DY,^FS~HI^XA_", "latin1");
    for (let at = 4; at < body.length; at += hostile.length) hostile.copy(body, at);
    await writeFile(path.join(dir, spec.sourceFile), body);
  }
  return dir;
}

async function withPrinter(opts, fn) {
  const printer = new MockPrinter(opts);
  await printer.listen();
  try {
    return await fn(printer);
  } finally {
    await printer.close();
  }
}

const fastConnect = { connectTimeoutMs: 2_000, writeTimeoutMs: 1_500 };
// A printer that accepts a socket and then says nothing would otherwise cost
// the full query timeout on every call in this file.
const fastQuery = 1_000;

test("status reports every weight missing on a fresh printer", async () => {
  const fontDir = await fakeFontDir();
  await withPrinter({}, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    const status = await service.status(printer.target);

    assert.equal(status.totalCount, 3);
    assert.equal(status.installedCount, 0);
    assert.deepEqual(new Set(status.fonts.map((f) => f.state)), new Set(["missing"]));
    assert.deepEqual(status.identity, {
      model: "ZD421-200dpi",
      firmware: "V93.21.37Z",
      dpmm: 8,
      dpi: 203,
    });
  });
});

test("status flags a stale object as a mismatch, not as installed", async () => {
  const fontDir = await fakeFontDir();
  await withPrinter({}, async (printer) => {
    printer.seed("NOTOKRM.TTF", 123);
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    const status = await service.status(printer.target);

    const medium = status.fonts.find((f) => f.filename === "NOTOKRM.TTF");
    assert.equal(medium.state, "mismatch");
    assert.equal(medium.installedSize, 123);
    assert.equal(status.installedCount, 0);
  });
});

test("status survives firmware that reports no free space", async () => {
  const fontDir = await fakeFontDir();
  await withPrinter({ reportFreeSpace: false }, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    const status = await service.status(printer.target);

    assert.equal(status.freeBytes, null);
    assert.equal(status.totalCount, 3); // the listing itself still parsed
  });
});

test("status returns a null identity rather than guessing the resolution", async () => {
  const fontDir = await fakeFontDir();
  await withPrinter({ brokenIdentity: true }, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    assert.equal((await service.status(printer.target)).identity, null);
  });
});

test("install delivers every weight byte-for-byte despite ZPL bytes in the payload", async () => {
  const fontDir = await fakeFontDir();
  await withPrinter({}, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    const result = await service.install(printer.target);

    assert.equal(result.sent.length, 3);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.status.installedCount, 3);
    for (const font of result.status.fonts) {
      assert.equal(printer.objects.get(font.filename), font.bundledSize);
    }
  });
});

test("install reports progress that only ever moves forward", async () => {
  const fontDir = await fakeFontDir();
  await withPrinter({}, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    const events = [];
    await service.install(printer.target, { onProgress: (p) => events.push(p) });

    assert.ok(events.length >= 3);
    assert.deepEqual([...new Set(events.map((e) => e.count))], [3]);
    for (const weight of FONTS.map((f) => f.weight)) {
      const forWeight = events.filter((e) => e.weight === weight);
      assert.ok(forWeight.length, `no progress for ${weight}`);
      const sent = forWeight.map((e) => e.sentBytes);
      assert.deepEqual(sent, [...sent].sort((a, b) => a - b));
      assert.equal(sent.at(-1), forWeight.at(-1).totalBytes);
    }
  });
});

test("install skips what the printer already has, and --force does not", async () => {
  const fontDir = await fakeFontDir();
  await withPrinter({}, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    await service.install(printer.target);

    const second = await service.install(printer.target);
    assert.equal(second.sent.length, 0);
    assert.equal(second.skipped.length, 3);

    const forced = await service.install(printer.target, { force: true });
    assert.equal(forced.sent.length, 3);
  });
});

test("install replaces a stale object", async () => {
  const fontDir = await fakeFontDir();
  await withPrinter({}, async (printer) => {
    printer.seed("NOTOKRM.TTF", 999);
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });

    const result = await service.install(printer.target, { weights: ["Medium"] });

    assert.deepEqual(result.sent.map((f) => f.weight), ["Medium"]);
    assert.equal(result.status.fonts.find((f) => f.weight === "Medium").state, "installed");
  });
});

test("install fails when the printer stored something other than what was sent", async () => {
  // The transfer looks clean but the object is short — only re-reading catches it.
  const fontDir = await fakeFontDir();
  await withPrinter({ truncateStoredBy: 10 }, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    await assert.rejects(() => service.install(printer.target), /did not verify/);
  });
});

test("install fails, and stores nothing, when the printer drops mid-transfer", async () => {
  const fontDir = await fakeFontDir(200_000);
  await withPrinter({ failAfterBytes: 20_000 }, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    await assert.rejects(() => service.install(printer.target));
    assert.equal(printer.objects.size, 0);
  });
});

test("install fails within the write timeout when the printer stops reading", async () => {
  const fontDir = await fakeFontDir(8_000_000);
  await withPrinter({ stall: true }, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    const started = Date.now();

    await assert.rejects(() => service.install(printer.target), /accepted no data/);

    // Bounded by the query timeout (the printer never answers ^HW) plus the
    // write timeout — not by anything waiting on an event that never comes.
    assert.ok(Date.now() - started < 5_000, "a stalled printer must not hang the install");
  });
});

test("a second install succeeds after a failed one", async () => {
  const fontDir = await fakeFontDir();
  await withPrinter({}, async (printer) => {
    printer.seed("NOTOKRM.TTF", 1);
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });

    await service.install(printer.target);

    assert.equal((await service.status(printer.target)).installedCount, 3);
  });
});

test("isBusy is true only while a transfer is running", async () => {
  const fontDir = await fakeFontDir(400_000);
  await withPrinter({}, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    assert.equal(service.isBusy(printer.target), false);

    let sawBusy = false;
    await service.install(printer.target, {
      onProgress: () => {
        if (service.isBusy(printer.target)) sawBusy = true;
      },
    });

    assert.equal(sawBusy, true, "isBusy must be true during the transfer");
    assert.equal(service.isBusy(printer.target), false);
  });
});

test("a concurrent install on the same printer is refused, not interleaved", async () => {
  // Two ~DY streams on one printer would each eat the other's bytes.
  const fontDir = await fakeFontDir(400_000);
  await withPrinter({}, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });

    const first = service.install(printer.target);
    await assert.rejects(() => service.install(printer.target), /already running/);
    await first;
  });
});

test("testPrint refuses when nothing is installed", async () => {
  const fontDir = await fakeFontDir();
  await withPrinter({}, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    await assert.rejects(() => service.testPrint(printer.target), /install first/);
  });
});

test("testPrint sends a label naming every installed weight", async () => {
  const fontDir = await fakeFontDir();
  await withPrinter({}, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    await service.install(printer.target);

    await service.testPrint(printer.target, { widthMm: 100, heightMm: 100 });

    const job = printer.lastPrintJob;
    assert.match(job, /\^CI28/);
    assert.match(job, /\^PW800/);
    for (const spec of FONTS) {
      assert.ok(job.includes(`E:${spec.filename}`), `${spec.filename} missing from the label`);
    }
    assert.ok(job.includes(PROOF_SAMPLE));
  });
});

test("testPrint scales to the label width it is given", async () => {
  const fontDir = await fakeFontDir();
  await withPrinter({}, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    await service.install(printer.target, { weights: ["Bold"] });

    await service.testPrint(printer.target, { widthMm: 70, weights: ["Bold"] });

    assert.match(printer.lastPrintJob, /\^PW560/);
  });
});

test("testPrint falls back to the given dpi when ~HI is unreadable", async () => {
  const fontDir = await fakeFontDir();
  await withPrinter({ brokenIdentity: true }, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    await service.install(printer.target, { weights: ["Medium"] });

    await service.testPrint(printer.target, { widthMm: 100, dpi: 300, weights: ["Medium"] });

    assert.match(printer.lastPrintJob, /\^PW1200/);
  });
});

test("an unreachable printer surfaces as an error, not a hang", async () => {
  const fontDir = await fakeFontDir();
  const service = createZplFontService({ fontDir, connect: { connectTimeoutMs: 1_000 } });
  await assert.rejects(
    () => service.status({ host: "127.0.0.1", port: 1 }),
    /cannot reach|timed out/,
  );
});

test("a font file that is not TrueType is refused before anything is sent", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "zpl-font-cff-"));
  for (const spec of FONTS) {
    // OTTO: the OpenType/CFF face a ZD421 stored and then would not draw.
    await writeFile(path.join(dir, spec.sourceFile), Buffer.from("OTTO____", "latin1"));
  }
  await withPrinter({}, async (printer) => {
    const service = createZplFontService({ fontDir: dir, connect: fastConnect, queryTimeoutMs: fastQuery });
    await assert.rejects(() => service.install(printer.target), /TrueType outlines/);
    assert.equal(printer.objects.size, 0);
  });
});

test("a missing font directory names the path it looked in", async () => {
  const service = createZplFontService({ fontDir: "/nonexistent/fonts", connect: fastConnect, queryTimeoutMs: fastQuery });
  await assert.rejects(
    () => service.status({ host: "127.0.0.1", port: 9100 }),
    /font file not found: \/nonexistent\/fonts/,
  );
});

test("the fonts that actually ship are present and are TrueType", async () => {
  // Guards the packaged binaries: nothing else in the build would notice one
  // being truncated or swapped, and the failure would surface as a blank label.
  await withPrinter({}, async (printer) => {
    const service = createZplFontService({ fontDir: REAL_FONT_DIR, connect: fastConnect, queryTimeoutMs: fastQuery });
    const status = await service.status(printer.target);

    assert.equal(status.fonts.length, 3);
    for (const font of status.fonts) {
      assert.ok(font.bundledSize > 1_000_000, `${font.sourceFile} looks truncated`);
    }
    const total = status.fonts.reduce((n, f) => n + f.bundledSize, 0);
    assert.ok(total < 32 * 1024 * 1024, "the three fonts must fit in printer flash");
  });
});

// ---------------------------------------------------------------------------
// Blind mode — printers that take the fonts but answer no query
//
// A Bixolon XD3/XD5 in BPL-Z accepts ~DY downloads and draws ^A@ + ^CI28
// hangul exactly like a Zebra, and answers ~HI / ^HW / ^HH with no bytes at
// all. Verified on hardware 2026-08-26. Every query-shaped certainty the rest
// of this file relies on is unavailable there, so the proof label replaces it.
// ---------------------------------------------------------------------------

const blind = { silent: true };

test("a silent printer is classified as not responding, not treated as a failure", async () => {
  const fontDir = await fakeFontDir();
  await withPrinter(blind, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    const status = await service.status(printer.target);

    assert.equal(status.capabilities.responds, false);
    assert.equal(status.identity, null);
    assert.equal(status.capabilities.dpi, undefined, "no dpi may be invented");
    assert.equal(status.freeBytes, null);
    assert.equal(status.totalCount, 3);
    assert.equal(status.installedCount, 0);
    assert.deepEqual(new Set(status.fonts.map((f) => f.state)), new Set(["unknown"]));
    assert.match(status.message, /proof label/i);
  });
});

test("a silent printer takes the dpi it is given and nothing more", async () => {
  const fontDir = await fakeFontDir();
  await withPrinter(blind, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    const status = await service.status(printer.target, { dpi: 300 });

    assert.equal(status.capabilities.dpi, 300);
    assert.equal(status.capabilities.model, undefined);
  });
});

test("a printer that answers is still reported as responding, with its own dpi", async () => {
  const fontDir = await fakeFontDir();
  await withPrinter({}, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    // The override must not win over what the printer says about itself.
    const status = await service.status(printer.target, { dpi: 300 });

    assert.equal(status.capabilities.responds, true);
    assert.equal(status.capabilities.dpi, 203);
    assert.equal(status.capabilities.model, "ZD421-200dpi");
    assert.equal(status.message, undefined);
  });
});

test("install on a silent printer streams every weight and proves it with a label", async () => {
  const fontDir = await fakeFontDir();
  await withPrinter(blind, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    const result = await service.install(printer.target, { widthMm: 100 });

    assert.equal(result.sent.length, 3);
    assert.equal(result.skipped.length, 0);
    assert.equal(result.verified, false, "nothing on this printer can verify an install");
    assert.match(result.message, /proof label/i);

    for (const font of result.status.fonts) {
      assert.equal(font.state, "unverified");
      assert.equal(font.installedSize, null);
      // The bytes did land, whatever the printer will admit to.
      assert.equal(printer.objects.get(font.filename), font.bundledSize);
    }
    assert.equal(result.status.installedCount, 0, "unverified is not installed");
  });
});

test("the proof label a blind install prints carries its own verdict", async () => {
  const fontDir = await fakeFontDir();
  await withPrinter(blind, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    await service.install(printer.target, { widthMm: 100 });

    const job = printer.lastPrintJob;
    assert.ok(job, "a blind install must print a proof label unasked");
    assert.match(job, /\^CI28/);
    assert.match(job, /\^PW800/);
    for (const spec of FONTS) {
      const row = job.split("\n").find((l) => l.includes(`E:${spec.filename}`));
      assert.ok(row, `${spec.filename} missing from the label`);
      assert.match(row, /\^A@N/);
    }
    assert.ok(job.includes(PROOF_SAMPLE));
    // Built-in font lines: these print even if every download failed, which is
    // what separates "the font is wrong" from "the label never came out".
    assert.ok(job.includes(PROOF_BUILTIN_REFERENCE));
    assert.ok(job.includes(PROOF_VERDICT));
    assert.match(job.split("\n").find((l) => l.includes(PROOF_VERDICT)), /\^A0N/);
  });
});

test("a blind install does not throw, and repeating it sends everything again", async () => {
  // With no directory to read there is nothing to skip against — force is moot.
  const fontDir = await fakeFontDir();
  await withPrinter(blind, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    await service.install(printer.target);

    const second = await service.install(printer.target);
    assert.equal(second.sent.length, 3);
    assert.equal(second.skipped.length, 0);
  });
});

test("a blind install still fails loudly when the printer stops taking bytes", async () => {
  // Silence about status is not silence about transport: a transfer that dies
  // is a real error and must not be dressed up as an unverified success.
  const fontDir = await fakeFontDir(200_000);
  await withPrinter({ silent: true, failAfterBytes: 20_000 }, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    await assert.rejects(() => service.install(printer.target));
    assert.equal(printer.objects.size, 0);
  });
});

test("testPrint on a silent printer is allowed with nothing installed", async () => {
  // "Is it installed" is the question this label answers; refusing to print
  // until something says yes would mean never printing at all.
  const fontDir = await fakeFontDir();
  await withPrinter(blind, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    await service.testPrint(printer.target, { widthMm: 70 });

    const job = printer.lastPrintJob;
    assert.match(job, /\^PW560/);
    for (const spec of FONTS) {
      assert.ok(job.includes(`E:${spec.filename}`), `${spec.filename} missing from the label`);
    }
    assert.ok(job.includes(PROOF_VERDICT));
  });
});

test("testPrint on a silent printer honours a single requested weight", async () => {
  const fontDir = await fakeFontDir();
  await withPrinter(blind, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    await service.testPrint(printer.target, { widthMm: 100, weights: ["Bold"] });

    const job = printer.lastPrintJob;
    assert.ok(job.includes("E:NOTOKRB.TTF"));
    assert.ok(!job.includes("E:NOTOKRM.TTF"));
  });
});

test("a blind proof label assumes 203 dpi until told otherwise", async () => {
  const fontDir = await fakeFontDir();
  await withPrinter(blind, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });

    await service.testPrint(printer.target, { widthMm: 100 });
    assert.match(printer.lastPrintJob, /\^PW800/);

    await service.testPrint(printer.target, { widthMm: 100, dpi: 300 });
    assert.match(printer.lastPrintJob, /\^PW1200/);
  });
});

test("a printer that answers keeps the plain proof label, with no blind footer", async () => {
  const fontDir = await fakeFontDir();
  await withPrinter({}, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });
    await service.install(printer.target, { weights: ["Medium"] });

    // A verified install prints nothing by itself — that behaviour is unchanged.
    assert.equal(printer.lastPrintJob, undefined);

    await service.testPrint(printer.target, { widthMm: 100, weights: ["Medium"] });
    assert.ok(!printer.lastPrintJob.includes(PROOF_VERDICT));
    assert.ok(!printer.lastPrintJob.includes(PROOF_BUILTIN_REFERENCE));
  });
});

test("the proof print after a blind install stays inside the busy guard", async () => {
  // The ~DY stream and the proof share one port; anything else printing to it
  // in between is swallowed by the font transfer and lost.
  const fontDir = await fakeFontDir(400_000);
  await withPrinter(blind, async (printer) => {
    const service = createZplFontService({ fontDir, connect: fastConnect, queryTimeoutMs: fastQuery });

    const running = service.install(printer.target);
    assert.equal(service.isBusy(printer.target), true);
    await assert.rejects(() => service.install(printer.target), /already running/);
    await assert.rejects(() => service.testPrint(printer.target), /already running/);

    await running;
    assert.equal(service.isBusy(printer.target), false);
    assert.ok(printer.lastPrintJob.includes(PROOF_VERDICT));
  });
});
