import { useMemo, useState } from "react";
import {
  buildIngredientLabel58100,
  buildScaleLabel6040,
  renderLabel,
  type Label,
} from "../../label-core";
import {
  formatLabelDate,
  toIngredientLabel58100Input,
  toScaleLabel6040Input,
  type ScaleLabelLane,
  type ScaleLabelStore,
} from "../../label-core/adapters/scale-label";
import { cn } from "../../libs/cn";
import { MONEY_DP, MONEY_SCALE, QTY_DP } from "../../libs/constants";
import { itemNameParser } from "../../libs/item-utils";
import {
  pickLabelPrinters,
  useZplPrinters,
  type LabelPrinter,
} from "../../hooks/useZplPrinters";
import { useLiveWeight } from "../../hooks/useLiveWeight";
import { useWeighItem } from "../../hooks/useWeighItem";
import MarkdownModal from "./MarkdownModal";
import PriceLevelsModal from "./PriceLevelsModal";

/**
 * Weigh one item and print its label.
 *
 * The screen assembles and nothing more. Every figure comes from
 * `useWeighItem` (which delegates to `scale-core`), the platter from
 * `useLiveWeight`, the template inputs from
 * `label-core/adapters/scale-label`, and the ZPL from `label-core`. If a
 * number is being computed in this file, it is in the wrong place.
 *
 * ## The four print lanes
 *
 * Owner-specified, no PLU-only lane:
 *
 *   1D scale       60 × 40   EAN-13 with the price embedded
 *   1D ingredient  58 × 100  EAN-13 with the price embedded
 *   2D normal      60 × 40   PP QR
 *   2D ingredient  58 × 100  PP QR
 *
 * A lane is offered only when a printer is configured for its media
 * (`pickLabelPrinters`) — the media a printer is loaded with is the only thing
 * that routes a job, never its `language` field.
 *
 * When `label` is a reason string (no price, empty platter, no 7-digit PLU) all
 * four buttons are disabled and the reason is shown where the barcode preview
 * goes. That is deliberate: a scale label that prints with the wrong number on
 * it is worse than one that does not print.
 */

type EditTarget = null | "prices" | "promoPrices" | "markdownPct";

interface PrintLane {
  id: string;
  label: string;
  media: "6040" | "58100";
  lane: ScaleLabelLane;
  build: (weigh: ReturnType<typeof useWeighItem>, store: ScaleLabelStore) => Label | null;
}

const LANES: PrintLane[] = [
  {
    id: "1d-scale",
    label: "1D Scale",
    media: "6040",
    lane: "1d",
    build: (w, store) =>
      w.labelState && w.label && typeof w.label !== "string"
        ? buildScaleLabel6040(toScaleLabel6040Input(w.labelState, w.label, "1d", store))
        : null,
  },
  {
    id: "2d-normal",
    label: "2D Normal",
    media: "6040",
    lane: "2d",
    build: (w, store) =>
      w.labelState && w.label && typeof w.label !== "string"
        ? buildScaleLabel6040(toScaleLabel6040Input(w.labelState, w.label, "2d", store))
        : null,
  },
  {
    id: "1d-ingredient",
    label: "1D Ingredient",
    media: "58100",
    lane: "1d",
    build: (w) =>
      w.labelState && w.label && typeof w.label !== "string"
        ? buildIngredientLabel58100(toIngredientLabel58100Input(w.labelState, w.label, "1d"))
        : null,
  },
  {
    id: "2d-ingredient",
    label: "2D Ingredient",
    media: "58100",
    lane: "2d",
    build: (w) =>
      w.labelState && w.label && typeof w.label !== "string"
        ? buildIngredientLabel58100(toIngredientLabel58100Input(w.labelState, w.label, "2d"))
        : null,
  },
];

const fmt = (cents: number) => (cents / MONEY_SCALE).toFixed(MONEY_DP);

export default function WeighPanel({
  itemId,
  store,
  onBack,
}: {
  itemId: number;
  store: ScaleLabelStore;
  onBack: () => void;
}) {
  const { weight, weightString } = useLiveWeight(true);
  const weigh = useWeighItem(itemId, weightString);
  const { printers, printLabel } = useZplPrinters();
  const [editTarget, setEditTarget] = useState<EditTarget>(null);
  const [printingId, setPrintingId] = useState<string | null>(null);
  const [message, setMessage] = useState("");

  const label = weigh.label;
  const labelOk = label != null && typeof label !== "string";
  const reason = typeof label === "string" ? label : null;

  const printersByMedia = useMemo(
    () => ({
      "6040": pickLabelPrinters(printers, "6040"),
      "58100": pickLabelPrinters(printers, "58100"),
    }),
    [printers],
  );

  const handlePrint = async (entry: PrintLane, printer: LabelPrinter) => {
    if (printingId) return;
    const built = entry.build(weigh, store);
    if (!built) return;

    setPrintingId(entry.id);
    setMessage("");
    try {
      // A `~DY` font transfer swallows everything arriving on the printer until
      // its byte count is satisfied, so a label sent mid-install is eaten. The
      // service exposes no "busy" IPC, but a printer part-way through an
      // install will not answer a second connection — a failed status means
      // busy or unreachable, and either way this must not print.
      if (printer.type === "net") {
        const status = await window.electronAPI.zplFontStatus({
          host: printer.host,
          port: printer.port,
        });
        if (!status.ok) {
          setMessage(`Printer busy or unreachable: ${status.message}`);
          window.alert(
            `Printer is not answering — a font transfer may be running.\n\n${status.message}\n\nPrint cancelled.`,
          );
          return;
        }
      }

      const result = await printLabel(printer, {
        language: "zpl",
        data: renderLabel(built),
      });
      setMessage(result.ok ? `Sent — ${entry.label}` : result.message);
      if (!result.ok) window.alert(result.message);
    } catch (err) {
      const text = err instanceof Error ? err.message : "Failed to print";
      setMessage(text);
      window.alert(text);
    } finally {
      setPrintingId(null);
    }
  };

  if (weigh.loading) {
    return (
      <div className="h-full flex items-center justify-center text-sm text-gray-400">
        Loading item…
      </div>
    );
  }

  if (!weigh.item) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-4">
        <p className="text-sm text-red-700">{weigh.loadError ?? "Item not found."}</p>
        <button
          type="button"
          onPointerDown={onBack}
          className="h-12 px-6 rounded-lg bg-gray-200 font-semibold active:bg-gray-300"
        >
          ← Back to items
        </button>
      </div>
    );
  }

  const item = weigh.item;
  const { name_en, name_ko } = itemNameParser(item);
  const weightDisplay = weigh.isWeighed
    ? (weight.weight || 0).toFixed(QTY_DP)
    : weigh.fixedWeightString || "N/A";

  return (
    <div className="h-full w-full flex bg-gray-100 divide-x divide-gray-200">
      {/* ── Left: the editable form ─────────────────────────────────────── */}
      <div className="flex-1 min-w-0 overflow-y-auto bg-white p-4 flex flex-col gap-5">
        <div className="flex items-start gap-3">
          <button
            type="button"
            onPointerDown={onBack}
            className="h-12 px-4 rounded-lg bg-gray-100 font-semibold text-sm active:bg-gray-200 shrink-0"
          >
            ← Items
          </button>
          <div className="min-w-0">
            <div className="text-lg font-bold truncate">{name_en}</div>
            <div className="text-sm text-gray-500 truncate">
              {name_ko ? `${name_ko} · ` : ""}
              {item.barcodePLU || item.barcode} ·{" "}
              {weigh.isWeighed ? "Weight item" : "Fixed weight"}
            </div>
          </div>
        </div>

        {/* Prices — tap to override the level array for this session. */}
        <div className="grid grid-cols-2 gap-4">
          <Field label={`Price / ${weigh.isWeighed ? "kg" : item.uom || "unit"} (Lv.0)`}>
            <div
              onPointerDown={() => setEditTarget("prices")}
              className="h-14 rounded-lg border border-gray-300 px-3 flex items-center justify-end gap-2 cursor-pointer active:bg-gray-50"
            >
              {weigh.wasPriceCents != null && (
                <span className="text-sm text-gray-400 line-through tabular-nums">
                  ${fmt(weigh.wasPriceCents)}
                </span>
              )}
              <span className="text-xl font-bold tabular-nums">
                ${fmt(weigh.unitPriceCents ?? 0)}
              </span>
            </div>
          </Field>
          <Field label="Promo Prices">
            <div
              onPointerDown={() => setEditTarget("promoPrices")}
              className="h-14 rounded-lg border border-gray-300 px-3 flex items-center justify-end cursor-pointer active:bg-gray-50"
            >
              <span className="text-xl font-bold tabular-nums text-red-600">
                {(weigh.promoPrices?.[0] ?? 0) > 0
                  ? `$${fmt(weigh.promoPrices?.[0] ?? 0)}`
                  : "N/A"}
              </span>
            </div>
          </Field>
        </div>

        {/* Markdown — percent only (owner, 2026-08-28; the $ kind stays in
            scale-core/PP 05=2 for the runner, this station just doesn't offer
            it). Folds into the total and the 1D embedded price; rides in PP
            05/06 only, never in 02/03. */}
        <Field label="Markdown">
          <div className="flex gap-3">
            <button
              type="button"
              onPointerDown={() => setEditTarget("markdownPct")}
              className={cn(
                "h-14 flex-1 rounded-lg border-2 font-bold",
                weigh.markdown?.type === "pct"
                  ? "border-blue-600 bg-blue-600 text-white"
                  : "border-gray-300 bg-white text-gray-700",
              )}
            >
              {weigh.markdown?.type === "pct"
                ? `${(weigh.markdown.value / 10).toFixed(1).replace(/\.0$/, "")}% OFF`
                : "% Markdown"}
            </button>
            {weigh.markdown && (
              <button
                type="button"
                onPointerDown={() => weigh.setMarkdown(null)}
                className="h-14 px-4 rounded-lg bg-red-600 text-white font-bold shrink-0"
              >
                Clear
              </button>
            )}
          </div>
        </Field>

        {/* Dates — data is ISO, use-by is derived from packed-on + the
            catalogue's `scaleData.usedBy` and is display only. */}
        <div className="grid grid-cols-2 gap-4">
          <Field label="Packed On">
            <div className="flex items-center gap-2">
              <StepButton onPress={() => weigh.shiftPackedOn(-1)}>−</StepButton>
              <span
                className={cn(
                  "flex-1 text-center text-lg font-bold tabular-nums",
                  weigh.packedOnChanged && "text-red-600",
                )}
              >
                {formatLabelDate(weigh.packedOnIso)}
              </span>
              <StepButton onPress={() => weigh.shiftPackedOn(1)}>+</StepButton>
              {weigh.packedOnChanged && (
                <button
                  type="button"
                  onPointerDown={weigh.resetPackedOn}
                  className="h-12 px-3 rounded-lg bg-red-600 text-white text-sm font-bold shrink-0"
                >
                  Today
                </button>
              )}
            </div>
          </Field>
          <Field label={`Use By (+${weigh.usedByOffsetDays} days)`}>
            <div className="h-12 flex items-center text-lg font-bold tabular-nums text-gray-700">
              {formatLabelDate(weigh.usedByIso)}
            </div>
          </Field>
        </div>

        <Field label="Ingredients">
          <p className="text-sm text-gray-600 leading-snug">
            {weigh.ingredients || "N/A"}
          </p>
        </Field>
      </div>

      {/* ── Right: the platter, the totals, and the four lanes ──────────── */}
      <div className="w-[440px] shrink-0 bg-white p-4 flex flex-col gap-4 overflow-y-auto">
        <div className="rounded-xl bg-gray-50 py-4 text-center">
          <div className="text-5xl font-extrabold tabular-nums">{weightDisplay}</div>
          <div className="text-base text-gray-500 mt-1">
            {weigh.isWeighed ? "kg" : "fixed"}
          </div>
          {weigh.isWeighed && (
            <div
              className={cn(
                "text-xs font-semibold mt-1",
                weight.status === "stable" ? "text-green-600" : "text-amber-600",
              )}
            >
              {weight.status === "stable" && "Stable"}
              {weight.status === "unstable" && "Unstable"}
              {weight.status === "error" && (weight.message ?? "Scale error")}
              {weight.status === "disconnected" && "Scale disconnected"}
            </div>
          )}
        </div>

        <div className="flex flex-col gap-2 border-t border-gray-100 pt-3">
          <SummaryRow
            title="Unit price"
            was={weigh.wasPriceCents != null ? `$${fmt(weigh.wasPriceCents)}` : null}
            value={weigh.unitPriceCents != null ? `$${fmt(weigh.unitPriceCents)}` : "—"}
          />
          <SummaryRow
            title="Total"
            was={
              weigh.hasMarkdown && weigh.baseTotalCents != null
                ? `$${fmt(weigh.baseTotalCents)}`
                : null
            }
            value={weigh.totalCents != null ? `$${fmt(weigh.totalCents)}` : "—"}
            big
          />
        </div>

        <div className="rounded-lg border border-gray-200 bg-gray-50 p-3">
          <div className="text-[10px] font-bold uppercase text-gray-400">
            Label barcode (EAN-13)
          </div>
          {labelOk ? (
            <div className="text-lg font-bold tabular-nums tracking-widest">
              {label.barcodeWithCheckDigit ?? label.barcode}
            </div>
          ) : (
            <div className="text-sm font-semibold text-red-700">{reason ?? "—"}</div>
          )}
        </div>

        {/* 2×2, legacy colour scheme (owner 2026-08-28): 1D lanes blue-500 on
            white text, 2D lanes yellow-400 on black — the green PLU lane of the
            old app is gone. One button per lane, first printer on its media. */}
        <div className="grid grid-cols-2 gap-3">
          {LANES.map((entry) => {
            const printer = printersByMedia[entry.media][0];
            const is2d = entry.lane === "2d";
            return (
              <button
                key={entry.id}
                type="button"
                disabled={!printer || !labelOk || printingId != null}
                onPointerDown={() => printer && void handlePrint(entry, printer)}
                className={cn(
                  "h-14 rounded-lg px-3 text-sm font-bold disabled:bg-gray-200 disabled:text-gray-400",
                  is2d
                    ? "bg-yellow-400 text-black active:bg-yellow-500"
                    : "bg-blue-500 text-white active:bg-blue-600",
                )}
              >
                {printingId === entry.id
                  ? "Printing…"
                  : printer
                    ? entry.label
                    : `${entry.label} — no printer`}
              </button>
            );
          })}
        </div>

        {message && <p className="text-sm text-gray-600 break-words">{message}</p>}
      </div>

      <PriceLevelsModal
        open={editTarget === "prices"}
        title="Price levels (Lv.0–4)"
        values={weigh.prices}
        onConfirm={(next) => {
          weigh.setPrices(next);
          setEditTarget(null);
        }}
        onClose={() => setEditTarget(null)}
      />
      <PriceLevelsModal
        open={editTarget === "promoPrices"}
        title="Promo price levels (Lv.0–4)"
        values={weigh.promoPrices}
        onConfirm={(next) => {
          weigh.setPromoPrices(next);
          setEditTarget(null);
        }}
        onClose={() => setEditTarget(null)}
      />
      <MarkdownModal
        open={editTarget === "markdownPct"}
        kind="pct"
        current={weigh.markdown}
        onConfirm={(next) => {
          weigh.setMarkdown(next);
          setEditTarget(null);
        }}
        onClose={() => setEditTarget(null)}
      />
    </div>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex flex-col gap-1.5">
      <span className="text-xs font-bold uppercase text-gray-400">{label}</span>
      {children}
    </div>
  );
}

function StepButton({
  onPress,
  children,
}: {
  onPress: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onPointerDown={onPress}
      className="w-12 h-12 shrink-0 rounded-lg bg-gray-100 text-xl font-bold active:bg-gray-200"
    >
      {children}
    </button>
  );
}

function SummaryRow({
  title,
  was,
  value,
  big = false,
}: {
  title: string;
  was: string | null;
  value: string;
  big?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between">
      <span className="text-sm font-bold text-gray-500">{title}</span>
      <span className="flex items-baseline gap-2">
        {was && (
          <span className="text-sm text-gray-400 line-through tabular-nums">{was}</span>
        )}
        <span
          className={cn(
            "font-bold tabular-nums",
            big ? "text-3xl text-blue-600" : "text-xl text-gray-900",
          )}
        >
          {value}
        </span>
      </span>
    </div>
  );
}
