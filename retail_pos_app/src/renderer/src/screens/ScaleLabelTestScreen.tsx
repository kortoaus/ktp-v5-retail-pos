/**
 * Temporary bench for the label-core rewrite.
 *
 * Pick a ZPL printer, pick a label to build, read the ZPL that produced it, put
 * it on real stock. Nothing here computes a layout — every number comes from
 * `label-core`, so what is tuned on this screen is the library, not the screen.
 * The sample data below is the only thing this file owns, and it is the mockup's
 * own values so a print can be held against the printout the owner signed off.
 *
 * It will be reshaped into the real /scale weighing page once the templates are
 * settled; until then it is reachable from a temporary home-screen button.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "../libs/cn";
import { buildPPBarcodeString } from "../libs/pp-barcode";
import { useZplPrinters, type LabelPrinter } from "../hooks/useZplPrinters";
import {
  MEDIA,
  MEDIA_IDS,
  buildDiagnosticLabel,
  buildGridLabel,
  buildIngredientLabel58100,
  buildOrderLabel100100,
  buildPriceTag7030,
  buildPriceTag7090,
  buildScaleLabel6040,
  renderLabel,
  type Label,
  type MediaId,
} from "../label-core";

// ---------------------------------------------------------------------------
// Sample data — the 2026-08-26 mockup's values, so prints are comparable
// ---------------------------------------------------------------------------

const NAME_KO = "모듬사시미 (테스트)";
const NAME_EN = "Assorted Sashimi";
const STORE_NAME = "DREAM MARKET";
const STORE_ADDRESS = "42-50 Rowe St. Eastwood NSW 2122";
const EAN13_12 = "200000102816";
const ITEM_BARCODE = "9300001028165";

/**
 * The 60 × 40 samples use a **real POS item**, not a made-up one.
 *
 * PLU `0213436` exists in the catalogue, so a label printed from this screen can
 * be scanned at a live till and is expected to ring up — which is the only way
 * to prove the QR encodes what the parser reads. Every other template's sample
 * data stays generic.
 */
const SCALE_PLU = "0213436";
const SCALE_NAME_KO = "DS 연어 사시미 (호주산)";
const SCALE_NAME_EN = "DS Salmon Sashimi (A)";

/**
 * A real catalogue name long enough to force the 60 × 40 name band onto two
 * lines. The band prints English only and picks 30/1 or 24/2 by measurement
 * (`layoutName6040`), and the short sample above only ever exercises 30/1 —
 * this one is the other branch, on stock, where a clipped line is visible.
 */
const SCALE_NAME_EN_LONG = "NS Shin Black Big Bowl 101g Premium Extra Value Pack";

/**
 * The legacy scale convention: a markdown is announced by a tag *prepended to
 * the name*, not by a field of its own. The adapter builds it, the template only
 * measures it — and here the tag alone is what pushes a name that fits on one
 * line onto two, which is exactly the interaction worth printing.
 */
const SCALE_NAME_EN_TAGGED = `[30% OFF] ${SCALE_NAME_EN}`;

/**
 * The PP payload, built through the canonical builder rather than hand-typed.
 *
 * That is the point of building it here: the screen is the adapter, so this is
 * also the one place that proves `00`/`07`/`08` reach a printed symbol. Five
 * distinct price levels and five distinct promo levels, because that is the
 * long case — 140 bytes, QR version 7 at level L, which is what the 60 × 40
 * symbol zone was sized against.
 */
const PP_QR = buildPPBarcodeString({
  barcode: SCALE_PLU,
  prices: [6200, 5900, 5700, 5500, 5300],
  promoPrices: [5500, 5300, 5100, 4900, 4700],
  weight: 512,
  discountType: "pct",
  discountAmount: 300,
  packedOn: "2026-08-26",
  usedBy: 1,
});

const SCALE_SAMPLE = {
  nameKo: SCALE_NAME_KO,
  nameEn: SCALE_NAME_EN,
  packedOnIso: "2026-08-26",
  usedByIso: "2026-08-27",
  weightText: "0.512",
  unit: "kg",
  unitPriceText: "$55.00",
  wasUnitPriceText: "$62.00",
  totalText: "$28.16",
  storeName: STORE_NAME,
  storeAddress: STORE_ADDRESS,
};

/**
 * A real statement panel, allergen sentence and all.
 *
 * The 58 × 100 stock gives the paragraph five lines at 18 and truncates past
 * them, so the sample has to be a plausible *full* statement — a short list of
 * ingredients would never show where the cap bites.
 */
const INGREDIENTS =
  "Salmon (Atlantic, farmed), Salt. Allergen information: Contains fish. " +
  "Keep refrigerated below 4C. Consume on day of purchase.";

/**
 * The 58 × 100 samples share the 60 × 40's item and dates; only the money moves.
 *
 * The 2D one carries the 30% markdown the PP payload already declares, so both
 * `was` columns print and the total is the marked-down amount — that is the
 * case the pre-printed stock's two `was` slots exist for, and the one worth
 * holding against real artwork.
 */
const INGREDIENT_SAMPLE = {
  ...SCALE_SAMPLE,
  ingredients: INGREDIENTS,
};

const INGREDIENT_MARKDOWN = {
  ...INGREDIENT_SAMPLE,
  nameEn: SCALE_NAME_EN_TAGGED,
  totalText: "$19.71",
  wasTotalText: "$28.16",
};

/**
 * An each-priced item, on stock whose captions all assume kilograms.
 *
 * A packaged cracker has no weight at all: the NET box takes `1 EA` as free
 * text and the pre-printed `$/KG` has to be ruled out and replaced. Its use-by
 * is 180 days out, which also lands the date row on the other branch of
 * `formatScaleDates` — different years, so both dates gain the year and shrink
 * together. Two things this sample proves that the salmon one cannot.
 */
const EA_PP_QR = buildPPBarcodeString({
  barcode: "00031146200139",
  prices: [130, 140, 140, 140, 140],
  promoPrices: [150, 150, 150, 150, 150],
  weight: null,
  packedOn: "2026-08-26",
  usedBy: 180,
});

const EA_SAMPLE = {
  nameKo: "NS 새우깡 75g",
  nameEn: "NS Shrimp Crackers 75g",
  packedOnIso: "2026-08-26",
  usedByIso: "2027-02-22",
  weightText: "1 EA",
  unit: "EA",
  unitPriceText: "$1.30",
  totalText: "$1.30",
  wasUnitPriceText: null,
  wasTotalText: null,
  ingredients:
    "Tapioca Starch, Shrimp (12%), Wheat Flour, Sugar, Salt. " +
    "Allergen information: Contains crustacean and wheat. Store in a cool dry place.",
  storeName: STORE_NAME,
  storeAddress: STORE_ADDRESS,
};

const PRICE_SAMPLE = {
  nameKo: NAME_KO,
  nameEn: NAME_EN,
  uom: "kg",
  priceCents: 5500,
  wasPriceCents: 6200,
  promoRange: "26/08 - 27/08",
  barcode: ITEM_BARCODE,
};

const ORDER_SAMPLE = {
  orderNo: "SASH-0412",
  // moment `ddd Do MMM HH:mm`, which is what the order screens format with.
  dueText: "Thu 27th Aug 14:00",
  nameKo: NAME_KO,
  nameEn: "Assorted Sashimi Platter",
  qty: 2,
  uom: "ea",
  optionLines: [
    "Wasabi: Extra x1",
    "Soy Sauce: Low sodium x2",
    "Cut: Thick x1",
    "Note: No coriander x1",
  ],
  orderQrData: "order%%%412",
  ppQrData: PP_QR,
};

interface TemplateEntry {
  id: string;
  label: string;
  media: MediaId;
  build: (dbg: boolean) => Label;
}

const TEMPLATES: TemplateEntry[] = [
  {
    id: "6040-1d",
    label: "6040 · 1D",
    media: "6040",
    build: (dbg) =>
      buildScaleLabel6040(
        { ...SCALE_SAMPLE, barcode: { kind: "ean13", data12: EAN13_12 } },
        { dbg },
      ),
  },
  {
    // The name band's other branch: too wide for one line at 30, so two at 24.
    // Everything else is the 1D sample, so the two prints differ only in the
    // band above the top red rule.
    id: "6040-1d-long",
    label: "6040 · 1D (long name)",
    media: "6040",
    build: (dbg) =>
      buildScaleLabel6040(
        {
          ...SCALE_SAMPLE,
          nameEn: SCALE_NAME_EN_LONG,
          barcode: { kind: "ean13", data12: EAN13_12 },
        },
        { dbg },
      ),
  },
  {
    // The dates straddle a New Year, so `formatScaleDates` has to print
    // DD/MM/YY on both and shrink them into the same pre-printed cells. This is
    // the branch that is easy to break and impossible to see on the 1D sample.
    id: "6040-1d-year",
    label: "6040 · 1D (year-boundary)",
    media: "6040",
    build: (dbg) =>
      buildScaleLabel6040(
        {
          ...SCALE_SAMPLE,
          packedOnIso: "2026-12-31",
          usedByIso: "2027-01-01",
          barcode: { kind: "ean13", data12: EAN13_12 },
        },
        { dbg },
      ),
  },
  {
    // The PP payload carries a 30% markdown, so the name carries the tag the
    // legacy scale puts in front of a marked-down item. The tag is prepended
    // here, by the adapter — the template is handed one finished string.
    id: "6040-2d",
    label: "6040 · 2D",
    media: "6040",
    build: (dbg) =>
      buildScaleLabel6040(
        { ...SCALE_SAMPLE, nameEn: SCALE_NAME_EN_TAGGED, barcode: { kind: "pp", qrData: PP_QR } },
        { dbg },
      ),
  },
  {
    id: "58100-1d",
    label: "58100 · 1D",
    media: "58100",
    build: (dbg) =>
      buildIngredientLabel58100(
        { ...INGREDIENT_SAMPLE, barcode: { kind: "ean13", data12: EAN13_12 } },
        { dbg },
      ),
  },
  {
    // The mockup's own case: tagged name, both `was` columns, marked-down total.
    id: "58100-2d",
    label: "58100 · 2D",
    media: "58100",
    build: (dbg) =>
      buildIngredientLabel58100(
        { ...INGREDIENT_MARKDOWN, barcode: { kind: "pp", qrData: PP_QR } },
        { dbg },
      ),
  },
  {
    // Each-priced: the `$/KG` correction and the different-years date branch.
    id: "58100-2d-ea",
    label: "58100 · 2D (EA item)",
    media: "58100",
    build: (dbg) =>
      buildIngredientLabel58100(
        { ...EA_SAMPLE, barcode: { kind: "pp", qrData: EA_PP_QR } },
        { dbg },
      ),
  },
  {
    id: "7030",
    label: "7030",
    media: "7030",
    build: (dbg) => buildPriceTag7030(PRICE_SAMPLE, { dbg }),
  },
  {
    id: "7090-normal",
    label: "7090 · normal",
    media: "7090",
    build: (dbg) =>
      buildPriceTag7090(
        {
          ...PRICE_SAMPLE,
          priceCents: 6200,
          wasPriceCents: null,
          promoRange: null,
          storeName: STORE_NAME,
        },
        { dbg },
      ),
  },
  {
    id: "7090-normal-member",
    label: "7090 · normal + member",
    media: "7090",
    build: (dbg) =>
      buildPriceTag7090(
        {
          ...PRICE_SAMPLE,
          priceCents: 6200,
          wasPriceCents: null,
          promoRange: null,
          memberPriceCents: 5900,
          storeName: STORE_NAME,
        },
        { dbg },
      ),
  },
  {
    id: "7090-promo",
    label: "7090 · promo",
    media: "7090",
    build: (dbg) =>
      buildPriceTag7090(
        { ...PRICE_SAMPLE, promoName: "Special", storeName: STORE_NAME },
        { dbg },
      ),
  },
  {
    id: "7090-promo-member",
    label: "7090 · promo + member",
    media: "7090",
    build: (dbg) =>
      buildPriceTag7090(
        {
          ...PRICE_SAMPLE,
          promoName: "Special",
          memberPriceCents: 5200,
          storeName: STORE_NAME,
        },
        { dbg },
      ),
  },
  {
    id: "100100",
    label: "100100 · order + PP QR",
    media: "100100",
    build: (dbg) => buildOrderLabel100100(ORDER_SAMPLE, { dbg }),
  },
];

// ---------------------------------------------------------------------------

/**
 * What the Print button will send.
 *
 * `diagnostic` and `grid` both follow the `media` picker; a `template` carries
 * its own media, which is why it is the one that names an id.
 */
type Selection = { kind: "diagnostic" } | { kind: "grid" } | { kind: "template"; id: string };

function printerKey(printer: LabelPrinter): string {
  return printer.type === "serial"
    ? `serial:${printer.path}`
    : `net:${printer.host}:${printer.port}`;
}

function printerAddress(printer: LabelPrinter): string {
  return printer.type === "serial" ? printer.path : `${printer.host}:${printer.port}`;
}

export default function ScaleLabelTestScreen() {
  const { printers, printLabel } = useZplPrinters();
  const [selectedKey, setSelectedKey] = useState("");
  const [media, setMedia] = useState<MediaId>("6040");
  const [selection, setSelection] = useState<Selection>({ kind: "diagnostic" });
  const [dbg, setDbg] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [message, setMessage] = useState("");

  // SLCS is gone from this track; a printer still configured for it cannot
  // render the fonts this library addresses, so it is not offered.
  const zplPrinters = useMemo(
    () => printers.filter((printer) => printer.language === "zpl"),
    [printers],
  );

  const selected =
    zplPrinters.find((printer) => printerKey(printer) === selectedKey) ?? zplPrinters[0];

  const template =
    selection.kind === "template"
      ? TEMPLATES.find((entry) => entry.id === selection.id)
      : undefined;

  const activeMedia = template ? template.media : media;

  const label = useMemo(() => {
    if (template) return template.build(dbg);
    // The grid ignores `dbg` on purpose: outlining a grid outlines every rule.
    if (selection.kind === "grid") return buildGridLabel(media);
    return buildDiagnosticLabel(media, { dbg });
  }, [template, selection.kind, media, dbg]);
  const zpl = useMemo(() => renderLabel(label), [label]);

  // Deliberately a warning and not a block: testing a 70 × 90 tag on the 100 ×
  // 150 stock that happens to be loaded is a normal thing to do at this stage.
  const mediaWarning =
    selected?.mediaSize && selected.mediaSize !== activeMedia
      ? `Printer is set to ${MEDIA[selected.mediaSize].label}; this label is ${MEDIA[activeMedia].label}. Printing anyway.`
      : "";

  const handlePrint = async (): Promise<void> => {
    if (!selected || printing) return;

    setPrinting(true);
    setMessage("");
    try {
      // A ~DY font transfer swallows everything arriving on the printer until
      // its declared byte count is satisfied, so a label sent mid-install is
      // eaten and lost. The service knows it is busy but exposes no IPC saying
      // so; what it does expose is a status query, and a printer part-way
      // through an install will not answer a second connection. A failed status
      // therefore means "busy or unreachable" — either way, do not print.
      if (selected.type === "net") {
        const status = await window.electronAPI.zplFontStatus({
          host: selected.host,
          port: selected.port,
        });
        if (!status.ok) {
          window.alert(
            `Printer is not answering — a font transfer may be running.\n\n${status.message}\n\nPrint cancelled.`,
          );
          setMessage("Print cancelled: printer busy or unreachable.");
          return;
        }
      }

      const result = await printLabel(selected, { language: "zpl", data: zpl });
      setMessage(result.ok ? "Sent." : result.message);
      if (!result.ok) window.alert(result.message);
    } catch (err) {
      const text = err instanceof Error ? err.message : "Failed to print";
      setMessage(text);
      window.alert(text);
    } finally {
      setPrinting(false);
    }
  };

  const dots = MEDIA[activeMedia].dots;
  const selectionLabel = template
    ? template.label
    : selection.kind === "grid"
      ? `Grid ${MEDIA[media].label}`
      : "Diagnostic";

  return (
    <div className="h-full w-full bg-gray-100 flex flex-col">
      <div className="h-16 flex items-center gap-4 px-4 border-b border-gray-200 bg-white">
        <Link to="/" className="text-sm text-blue-600 hover:text-blue-800 font-medium">
          &larr; Back
        </Link>
        <h1 className="text-lg font-semibold text-gray-900">Scale / Label Test</h1>
        <span className="text-xs text-gray-400">label-core templates</span>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[minmax(320px,420px)_1fr] gap-4 p-4">
        <section className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-4 overflow-y-auto">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-gray-500 uppercase">ZPL Printer</span>
            {zplPrinters.length === 0 ? (
              <p className="text-sm text-gray-500">
                No ZPL printer configured. Add one in Interface Settings.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {zplPrinters.map((printer) => {
                  const key = printerKey(printer);
                  const active = selected ? printerKey(selected) === key : false;
                  return (
                    <button
                      key={key}
                      type="button"
                      onPointerDown={() => setSelectedKey(key)}
                      className={cn(
                        "h-12 px-3 rounded-lg border text-sm font-semibold text-left transition-colors",
                        active
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
                      )}
                    >
                      {printer.name}
                      <span className="ml-2 font-normal text-gray-400">
                        {printerAddress(printer)}
                      </span>
                      {printer.mediaSize && (
                        <span className="ml-2 font-normal text-gray-400">
                          {MEDIA[printer.mediaSize].label}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-gray-500 uppercase">Templates</span>
            <div className="grid grid-cols-2 gap-2">
              {TEMPLATES.map((entry) => (
                <button
                  key={entry.id}
                  type="button"
                  onPointerDown={() => setSelection({ kind: "template", id: entry.id })}
                  className={cn(
                    "h-12 px-2 rounded-lg border text-xs font-semibold transition-colors",
                    template?.id === entry.id
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
                  )}
                >
                  {entry.label}
                </button>
              ))}
            </div>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-gray-500 uppercase">
              Diagnostic Media
            </span>
            <div className="grid grid-cols-3 gap-2">
              {MEDIA_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onPointerDown={() => {
                    setMedia(id);
                    setSelection({ kind: "diagnostic" });
                  }}
                  className={cn(
                    "h-12 rounded-lg border text-sm font-semibold transition-colors",
                    selection.kind === "diagnostic" && media === id
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
                  )}
                >
                  {MEDIA[id].label}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-400">
              {selectionLabel} · {dots[0]} × {dots[1]} dots @ 203 dpi
            </span>
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-gray-500 uppercase">
              Measuring Grid
            </span>
            <div className="grid grid-cols-3 gap-2">
              {MEDIA_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onPointerDown={() => {
                    setMedia(id);
                    setSelection({ kind: "grid" });
                  }}
                  className={cn(
                    "h-12 rounded-lg border text-sm font-semibold transition-colors",
                    selection.kind === "grid" && media === id
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
                  )}
                >
                  {MEDIA[id].label}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-400">
              Print on the pre-printed stock and read the artwork&rsquo;s corners straight off
              the numbered lines &mdash; 40-dot rules, 20-dot edge ticks.
            </span>
          </div>

          <button
            type="button"
            onPointerDown={() => setDbg((value) => !value)}
            className={cn(
              "h-12 rounded-lg border text-sm font-semibold transition-colors",
              dbg
                ? "border-amber-500 bg-amber-50 text-amber-700"
                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
            )}
          >
            Debug outlines: {dbg ? "ON" : "OFF"}
          </button>

          {mediaWarning && (
            <p className="text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg p-2">
              {mediaWarning}
            </p>
          )}

          <button
            type="button"
            disabled={!selected || printing}
            onPointerDown={handlePrint}
            className={cn(
              "mt-auto h-14 rounded-lg text-base font-bold transition-colors",
              selected && !printing
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-gray-200 text-gray-400",
            )}
          >
            {printing ? "Printing..." : `Print ${selectionLabel}`}
          </button>

          {message && <p className="text-sm text-gray-600 break-words">{message}</p>}
        </section>

        <section className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-3 min-h-0">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500 uppercase">Generated ZPL</span>
            <span className="text-sm font-medium text-gray-500">
              {label.elements.length} elements · {zpl.split("\n").length} lines · {zpl.length}{" "}
              bytes
            </span>
          </div>
          <textarea
            readOnly
            value={zpl}
            spellCheck={false}
            className="flex-1 min-h-0 rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-800 resize-none outline-none"
          />
        </section>
      </div>
    </div>
  );
}
