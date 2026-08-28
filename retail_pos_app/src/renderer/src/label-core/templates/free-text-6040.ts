/**
 * 60 × 40 free-text label — arbitrary typed lines, paginated onto plain stock.
 *
 * Every other template in this library maps a *domain object* onto a fixed
 * grid: a weighed item, an order, a price tag. This one has no domain at all.
 * The operator types lines, picks a size and a weight per line, and the template
 * flows them down a blank 60 × 40 label the way a word processor flows a
 * paragraph down a page.
 *
 * ## Plain stock, not the pre-printed web
 *
 * `scale-6040` prints *values only*, dropped into the cells of artwork the
 * store already bought printed (red rules, `PACKED ON`, `NET kg`…). This one
 * assumes the **blank** 60 × 40 web: it owns the whole 480 × 320 area and draws
 * nothing but text. Running it on the pre-printed roll will overprint the
 * artwork — that is the operator's call, not something this file can detect.
 *
 * ## Why it returns `Label[]` and not `Label`
 *
 * The other templates cannot overflow: their input is bounded (a name, a price,
 * two dates) so the worst case is a clip, and `clipToBlock` handles it. Free
 * text has no bound. The operator is entitled to type twenty lines, and the
 * honest answer to twenty lines on a 40 mm label is **two labels**, not a
 * truncated one. So overflow becomes pages: the row that would cross the bottom
 * padding starts a new label instead, and `mergeJobs` prints the lot in one job.
 *
 * That is also why nothing here clips. `clipToBlock` exists because `^FB` draws
 * overflow on top of the last line it was given (see `measure.ts`), and the only
 * defence for a bounded layout is to cut the string. Here the defence is a
 * second page, which loses nothing.
 *
 * ## The one thing that still has to fit
 *
 * A row's *width*. Pagination fixes height, not width, so each row is wrapped
 * to the content column before it is placed — at that row's own size, using the
 * same `estimateLines` / `wrapToWidths` model the rest of the library wraps
 * with, so the row count this file places and the breaks the strings actually
 * take cannot disagree. A row that survives that and is still over-wide (one
 * unbroken token longer than the column — a URL, a part number) is hard-broken
 * between characters, which is what `^FB` does to a space-free string anyway.
 *
 * A row can also be broken *explicitly*: a `\n` inside a line's text splits it
 * before any of that happens, so one editor entry can be several printed rows
 * at the same size and weight. That split has to be done here rather than left
 * to the printer — `escape.ts` drops control characters, so a newline handed to
 * `^FD` disappears and the halves print run together.
 *
 * The wrap budget is `CONTENT_W * FIT_SAFETY`, not `CONTENT_W`. The ratios in
 * `measure.ts` are documented to run *narrow*, and a row this file called a fit
 * at exactly 448 is a row the printer can overlap onto itself. Three percent
 * buys that back; it costs at most a character per row, and an extra row is
 * free here in a way it is nowhere else in this library.
 */

import { FIT_SAFETY, estimateLines, textEm, wrapToWidths } from "../measure";
import type { Element, Label, Text } from "../model";
import { getMedia } from "../media";
import { textEl, type TemplateOptions } from "./scale-6040";

/** The three sizes the editor offers, small / medium / large. */
export type FreeTextSize = "S" | "M" | "L";

/** Same three weights the printer has fonts for — see `../fonts`. */
export type FreeTextWeight = "M" | "B" | "BK";

export interface FreeTextLine {
  /**
   * Printed verbatim, except that a newline breaks it.
   *
   * `\n` (and `\r\n`, and a bare `\r`) splits the text into segments *before*
   * any wrapping happens; each segment then wraps on its own at this line's
   * size. An empty segment — from a leading, doubled or trailing newline — is a
   * spacing row, exactly like an empty `text`.
   *
   * The split is not a convenience: `escape.ts` **drops C0 control characters**
   * on the way to `^FD`, so a `\n` that reached the emitter would silently
   * vanish and the two halves would print run together. Breaking here is what
   * makes a multi-line editor entry mean what it looks like.
   *
   * An empty (or whitespace-only) string is a spacing row.
   */
  text: string;
  size: FreeTextSize;
  weight: FreeTextWeight;
}

/**
 * Cell height in dots per size name.
 *
 * 24 / 34 / 48 at 203 dpi is roughly 3 / 4.3 / 6 mm of cap height — small
 * enough to fit a sentence across the 56 mm column, large enough to read from
 * arm's length, and far enough apart that the operator can tell two rows apart
 * at a glance. They are the numbers the owner specified; they are not derived.
 */
export const FREE_TEXT_SIZE_DOTS: Record<FreeTextSize, number> = {
  S: 24,
  M: 34,
  L: 48,
};

/** Margin on all four sides, in dots (2 mm). */
export const FREE_TEXT_PAD = 16;

/**
 * Dots added below a row's cell to make its leading.
 *
 * Uniform, so a size change between rows changes the gap the same way it
 * changes the glyphs — the alternative (a fixed leading) makes an `L` row and
 * an `S` row look unrelated to each other.
 */
export const FREE_TEXT_LEADING_GAP = 6;

const MEDIA_DOTS = getMedia("6040").dots;

/** 480 − 2 × 16. The column every row is wrapped into. */
export const FREE_TEXT_CONTENT_W = MEDIA_DOTS[0] - FREE_TEXT_PAD * 2;

/** 320 − 16. A row may start at or above this minus its own cell height. */
export const FREE_TEXT_BOTTOM = MEDIA_DOTS[1] - FREE_TEXT_PAD;

/** The wrap budget — see the header on why it is not the full column. */
export const FREE_TEXT_WRAP_W = FREE_TEXT_CONTENT_W * FIT_SAFETY;

/** One placed row: either a text row, or a blank spacing row (`text: ""`). */
export interface FreeTextRow {
  text: string;
  /** Cell height in dots — already resolved from the size name. */
  size: number;
  weight: FreeTextWeight;
}

/**
 * Greedy character break, for a token no space can break.
 *
 * The same accumulate-while-it-fits rule `wrapToWidths` applies to a space-free
 * string; it is spelled out here because `wrapToWidths` only reaches for it when
 * the *whole* string has no space, and a long token can also arrive inside a
 * sentence that does. Never returns an empty row: a single character wider than
 * the column goes out over-wide rather than into an infinite loop.
 */
function hardBreak(text: string, size: number, width: number): string[] {
  const rows: string[] = [];
  let row = "";
  for (const ch of text) {
    const next = row + ch;
    if (!row || textEm(next) * size <= width) {
      row = next;
      continue;
    }
    rows.push(row);
    row = ch;
  }
  if (row) rows.push(row);
  return rows;
}

/**
 * `text` broken into rows that each fit `width` at `size`.
 *
 * `estimateLines` counts the rows, `wrapToWidths` produces them — the same wrap
 * model twice, which is what keeps the count and the content in step (pass
 * `wrapToWidths` too few widths and it keeps the overflow on the last row).
 * Anything still over-wide after that is one unbroken token, and gets the
 * character break.
 *
 * Whitespace-only input returns `[]`; the caller turns that into a spacing row,
 * because "how much space" is a layout question and this function only breaks
 * strings.
 */
export function wrapFreeTextLine(
  text: string,
  size: number,
  width: number = FREE_TEXT_WRAP_W,
): string[] {
  const trimmed = text.trim();
  if (!trimmed || size <= 0 || width <= 0) return [];

  const count = estimateLines(trimmed, size, width);
  const rows = wrapToWidths(trimmed, size, new Array(Math.max(1, count)).fill(width));

  return rows.flatMap((row) =>
    textEm(row) * size <= width ? [row] : hardBreak(row, size, width),
  );
}

/** `\n`, `\r\n` and a bare `\r` all break a line. See `FreeTextLine.text`. */
const NEWLINE = /\r\n|\r|\n/;

/**
 * Input lines flattened into the rows that will actually be placed.
 *
 * Two levels of breaking, in this order:
 *
 *  1. **Explicit** — the operator's own newlines. One input line becomes one
 *     segment per `\n`, and the split happens *first*, so a segment never wraps
 *     across a break the operator asked for.
 *  2. **Measured** — each segment then wraps to the content column at this
 *     line's size.
 *
 * A segment that is empty or whitespace-only becomes exactly one blank row, so
 * `"a\n\nb"` prints `a`, a gap, `b`, and a trailing `\n` leaves a trailing gap.
 *
 * Exported because the editor's "N줄 · M장" summary and the on-screen preview
 * both want the row list without building ZPL for it.
 */
export function freeTextRows(lines: readonly FreeTextLine[]): FreeTextRow[] {
  const out: FreeTextRow[] = [];
  for (const line of lines) {
    const size = FREE_TEXT_SIZE_DOTS[line.size] ?? FREE_TEXT_SIZE_DOTS.M;
    for (const segment of line.text.split(NEWLINE)) {
      const wrapped = wrapFreeTextLine(segment, size);
      if (wrapped.length === 0) {
        // A blank segment is deliberate whitespace: it consumes one leading at
        // its own size, so the operator picks how big the gap is by picking
        // S/M/L on the line the newline lives in.
        out.push({ text: "", size, weight: line.weight });
        continue;
      }
      for (const row of wrapped) out.push({ text: row, size, weight: line.weight });
    }
  }
  return out;
}

function rowEl(y: number, row: FreeTextRow): Text {
  return textEl(FREE_TEXT_PAD, y, row.text, row.size, row.weight, {
    width: FREE_TEXT_CONTENT_W,
    lines: 1,
    align: "L",
  });
}

/**
 * Free-text lines flowed onto as many 60 × 40 labels as they need.
 *
 * Rows go top to bottom from the top padding. A row occupies `[y, y + size)`;
 * when that would reach past `FREE_TEXT_BOTTOM` the current label is closed and
 * the row starts the next one. A label is only emitted if something is actually
 * printed on it, so an empty input — or an input of nothing but blank lines —
 * returns `[]` rather than one blank label nobody asked for.
 *
 * `dbg` and `copies` ride through onto **every** page: "two copies" of a
 * three-page note means three pages printed twice, not three pages and one
 * duplicate.
 */
export function buildFreeTextLabels6040(
  lines: readonly FreeTextLine[],
  opts: TemplateOptions = {},
): Label[] {
  const rows = freeTextRows(lines);

  const pages: Label[] = [];
  let elements: Element[] = [];
  let y = FREE_TEXT_PAD;

  const closePage = (): void => {
    // Blank rows alone do not make a page — nothing would print on it.
    if (elements.length === 0) return;
    pages.push({
      media: "6040",
      elements,
      dbg: opts.dbg ?? false,
      ...(opts.copies && opts.copies > 1 ? { copies: Math.round(opts.copies) } : {}),
    });
    elements = [];
  };

  for (const row of rows) {
    // `y > FREE_TEXT_PAD` keeps a fresh page from breaking against itself. It
    // cannot trigger today (the tallest row is 48 dots and 16 + 48 < 304), but
    // a future size that does not fit at all would otherwise loop forever.
    if (y + row.size > FREE_TEXT_BOTTOM && y > FREE_TEXT_PAD) {
      closePage();
      y = FREE_TEXT_PAD;
    }
    if (row.text) elements.push(rowEl(y, row));
    y += row.size + FREE_TEXT_LEADING_GAP;
  }
  closePage();

  return pages;
}
