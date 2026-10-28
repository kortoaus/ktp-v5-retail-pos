// Action Framework layout walker (retail-eftpos T-7). The terminal side tells
// the POS what to show while a payment waits on it (AWAITING_POS): an ordered
// `layout` of containers (`horizontal_layout`: one row; `vertical_layout`:
// one row per element) of `{ key, label? }` → `properties[key]` of type
// text | button | input | image, plus flat `details` shown as-is. Nothing
// here knows a transaction screen — the till's ActionFormView just paints the
// rows this returns (no hardcoded signature / receipt screens).
// A button with `submit: true` posts every input (keyed by its `name`) with
// the row version; a button with `action` posts just its key — the store
// server runs or relays both (POST /api/eft/transactions/:id/actions).
// Pure; mirrored (not copied) by the Runner's eft-action-form.ts.

import type { EftActionForm, EftActionProperty } from "./eft-types";

export type ActionElement =
  | { kind: "text"; key: string; text: string }
  | { kind: "button"; key: string; label: string; submit: boolean; action: string | null }
  | { kind: "input"; key: string; name: string; label: string; inputType: string | null }
  | { kind: "image"; key: string; label: string; src: string }
  | { kind: "unsupported"; key: string; type: string };

export interface ActionFormLayout {
  rows: ActionElement[][];
  details: { key: string; value: string }[];
  /** Input names in layout order (the body of a submit button). */
  inputNames: string[];
}

type LayoutRef = { key: string; label: string | null };

function refOf(raw: unknown): LayoutRef | null {
  if (typeof raw === "string") return { key: raw, label: null };
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  if (typeof r.key !== "string" || !r.key) return null;
  return { key: r.key, label: typeof r.label === "string" ? r.label : null };
}

/** Layout containers → rows of element refs. Unknown containers become one row. */
function layoutRows(layout: unknown): LayoutRef[][] | null {
  if (!Array.isArray(layout)) return null;
  const rows: LayoutRef[][] = [];
  for (const container of layout) {
    const single = refOf(container);
    if (single) {
      rows.push([single]);
      continue;
    }
    if (!container || typeof container !== "object") continue;
    for (const [kind, value] of Object.entries(container as Record<string, unknown>)) {
      if (!Array.isArray(value)) continue;
      const refs = value.map(refOf).filter((r): r is LayoutRef => r != null);
      if (!refs.length) continue;
      if (kind === "vertical_layout") for (const r of refs) rows.push([r]);
      else rows.push(refs);
    }
  }
  return rows;
}

function element(ref: LayoutRef, prop: EftActionProperty | undefined): ActionElement {
  const type = prop?.type ?? "";
  const label = (prop?.label ?? ref.label ?? "").toString();
  switch (type) {
    case "text":
      return { kind: "text", key: ref.key, text: label };
    case "button":
      return {
        kind: "button",
        key: ref.key,
        label: label || ref.key,
        submit: prop?.submit === true,
        action: typeof prop?.action === "string" ? prop.action : null,
      };
    case "input":
      return {
        kind: "input",
        key: ref.key,
        name: typeof prop?.name === "string" && prop.name ? prop.name : ref.key,
        label,
        inputType: typeof prop?.input_type === "string" ? prop.input_type : null,
      };
    case "image": {
      const data = typeof prop?.data === "string" ? prop.data : "";
      const mime = typeof prop?.mime === "string" && /^image\/[\w.+-]+$/.test(prop.mime) ? prop.mime : "";
      const b64 = !prop?.encoding || String(prop.encoding).toLowerCase() === "base64";
      if (!data || !mime || !b64) return { kind: "unsupported", key: ref.key, type: "image" };
      return { kind: "image", key: ref.key, label, src: `data:${mime};base64,${data}` };
    }
    default:
      return { kind: "unsupported", key: ref.key, type: type || "unknown" };
  }
}

function detailValue(v: unknown): string {
  if (v == null) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  try {
    return JSON.stringify(v);
  } catch {
    return String(v);
  }
}

export function walkActionForm(form: EftActionForm | null | undefined): ActionFormLayout {
  const props = form?.properties ?? {};
  const fromLayout = layoutRows(form?.layout);
  // No usable layout: every property on its own row, in the order sent.
  const refs: LayoutRef[][] =
    fromLayout && fromLayout.length ? fromLayout : Object.keys(props).map((key) => [{ key, label: null }]);
  const rows = refs.map((row) => row.map((ref) => element(ref, props[ref.key])));
  const inputNames: string[] = [];
  for (const row of rows) for (const el of row) if (el.kind === "input" && !inputNames.includes(el.name)) inputNames.push(el.name);
  const details = Object.entries(form?.details ?? {}).map(([key, value]) => ({ key, value: detailValue(value) }));
  return { rows, details, inputNames };
}

/**
 * The POST /actions body for a pressed button: a submit button carries every
 * input value (missing ones as ""), a named action carries none. Always the
 * row version (409 STALE_VERSION when it moved meanwhile).
 */
export function actionBody(
  layout: ActionFormLayout,
  button: Extract<ActionElement, { kind: "button" }>,
  values: Record<string, string>,
  version: number,
): { buttonKey: string; inputs: Record<string, string>; version: number } {
  const inputs: Record<string, string> = {};
  if (button.submit) for (const name of layout.inputNames) inputs[name] = values[name] ?? "";
  return { buttonKey: button.key, inputs, version };
}
