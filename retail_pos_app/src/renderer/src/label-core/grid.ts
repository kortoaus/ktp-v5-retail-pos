/**
 * A measuring grid, printed on the stock you are trying to lay out.
 *
 * Every pre-printed web in this fleet was tuned by holding a hand-written ZPL
 * against real artwork and moving numbers until they landed. That works, but it
 * costs a print per guess — the 58 × 100 `$/KG` correction took three, and was
 * still 19 dots out. Printing this first turns the whole exercise into one
 * print and a ruler-free read: put the grid on the pre-printed stock, read the
 * caption's corners straight off the labelled lines, type them into the
 * template.
 *
 * It is also the standing answer to a supplier reprinting the web slightly out
 * of registration. When a roll arrives and the values stop landing, print this
 * on the new roll and compare against the numbers in the template's header
 * comment. That is why it lives in `label-core` rather than in a screen: it is
 * part of how these templates are maintained, and it travels with them to the
 * other repos.
 *
 * **Built-in font, not Noto.** The whole point is that this prints on a printer
 * you have not finished setting up, so it must not depend on `~DY` having
 * installed the TTFs. Every glyph here is an ASCII digit.
 */

import { getMedia, type MediaId } from "./media";
import { textWidth } from "./measure";
import type { Element, Label } from "./model";

/** Labelled lines every 40 dots — 5 mm at 203 dpi. */
export const GRID_MAJOR = 40;
/** Unlabelled ticks every 20 dots along the edges, for reading between lines. */
export const GRID_MINOR = 20;
/** How far a minor tick reaches in from the edge. */
export const GRID_TICK = 8;
/** Cell height of the coordinate numbers. */
export const GRID_LABEL_SIZE = 16;

function line(x: number, y: number, w: number, h: number): Element {
  return { kind: "line", x, y, w, h, thick: 1 };
}

function label(x: number, y: number, text: string): Element {
  return { kind: "text", x, y, text, size: GRID_LABEL_SIZE, font: "builtin" };
}

/**
 * The grid for one media size.
 *
 * Full-width and full-height rules every `GRID_MAJOR` dots, each one labelled
 * with its own coordinate — columns along the top, rows down the left — plus
 * `GRID_MINOR` ticks on all four edges so a caption edge that falls between two
 * rules can still be read to the nearest 20. The media's own right and bottom
 * edges are drawn as well: if either is missing from the printout, the label is
 * mounted off-centre and no template coordinate will save it.
 *
 * Pure, like every other builder here — no printer, no DOM, no clock.
 */
export function buildGridLabel(media: MediaId): Label {
  const [width, height] = getMedia(media).dots;
  const elements: Element[] = [];

  for (let x = 0; x < width; x += GRID_MAJOR) {
    elements.push(line(x, 0, 1, height));
    // The origin's column number would sit on top of the row numbers.
    if (x === 0) continue;
    // The last column or two have no room to the right of their rule, so their
    // number goes to the left of it. Better an off-side number than one the
    // printer clips, which is the one thing a measuring tool must never do.
    const text = String(x);
    const w = textWidth(text, GRID_LABEL_SIZE);
    elements.push(label(x + 3 + w <= width ? x + 3 : x - 3 - w, 3, text));
  }
  for (let y = 0; y < height; y += GRID_MAJOR) {
    elements.push(line(0, y, width, 1));
    if (y > 0) elements.push(label(3, y + 3, String(y)));
  }

  // The media's far edges, which the loops above stop short of.
  elements.push(line(width - 1, 0, 1, height), line(0, height - 1, width, 1));

  for (let x = GRID_MINOR; x < width; x += GRID_MAJOR) {
    elements.push(line(x, 0, 1, GRID_TICK), line(x, height - GRID_TICK, 1, GRID_TICK));
  }
  for (let y = GRID_MINOR; y < height; y += GRID_MAJOR) {
    elements.push(line(0, y, GRID_TICK, 1), line(width - GRID_TICK, y, GRID_TICK, 1));
  }

  // Which sheet this is, for the pile of them on the bench.
  elements.push(label(3, height - GRID_LABEL_SIZE - 4, `${media} ${width}x${height}`));

  return { media, elements, dbg: false };
}
