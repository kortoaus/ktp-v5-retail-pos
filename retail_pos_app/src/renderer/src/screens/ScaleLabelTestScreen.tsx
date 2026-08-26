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

const INGREDIENTS =
  "Salmon, Tuna, Kingfish, Rice, Vinegar, Sugar, Salt, Wasabi, Soy Sauce (Water, Soybean, Wheat, Salt), Seaweed, Sesame Oil, Preservative (202)";

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
  dueText: "27/08 14:00",
  nameKo: NAME_KO,
  nameEn: "Assorted Sashimi Platter",
  qty: 2,
  optionLines: [
    "Wasabi: Extra x1",
    "Soy Sauce: Low sodium x2",
    "Cut: Thick x1",
    "Note: No coriander x1",
  ],
  orderQrData: "https://ktpv5.local/order/SASH-0412",
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
    id: "6040-2d",
    label: "6040 · 2D",
    media: "6040",
    build: (dbg) =>
      buildScaleLabel6040({ ...SCALE_SAMPLE, barcode: { kind: "pp", qrData: PP_QR } }, { dbg }),
  },
  {
    // Both symbols in the one zone: the QR this POS scans, and a bare EAN-13
    // for every scanner that has never heard of the PP schema.
    id: "6040-2d-1d",
    label: "6040 · 2D+1D",
    media: "6040",
    build: (dbg) =>
      buildScaleLabel6040(
        { ...SCALE_SAMPLE, barcode: { kind: "pp-ean13", qrData: PP_QR, data12: EAN13_12 } },
        { dbg },
      ),
  },
  {
    id: "58100-1d",
    label: "58100 · 1D",
    media: "58100",
    build: (dbg) =>
      buildIngredientLabel58100(
        {
          ...SCALE_SAMPLE,
          ingredients: INGREDIENTS,
          barcode: { kind: "ean13", data12: EAN13_12 },
        },
        { dbg },
      ),
  },
  {
    id: "58100-2d",
    label: "58100 · 2D",
    media: "58100",
    build: (dbg) =>
      buildIngredientLabel58100(
        { ...SCALE_SAMPLE, ingredients: INGREDIENTS, barcode: { kind: "pp", qrData: PP_QR } },
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

type Selection = { kind: "diagnostic" } | { kind: "template"; id: string };

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

  const label = useMemo(
    () => (template ? template.build(dbg) : buildDiagnosticLabel(media, { dbg })),
    [template, media, dbg],
  );
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
              {template ? template.label : "Diagnostic"} · {dots[0]} × {dots[1]} dots @ 203 dpi
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
            {printing ? "Printing..." : `Print ${template ? template.label : "diagnostic label"}`}
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
