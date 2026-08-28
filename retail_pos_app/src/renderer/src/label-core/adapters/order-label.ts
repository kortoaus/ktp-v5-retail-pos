/**
 * Order detail + line → 100 × 100 order label input.
 *
 * App-facing, like its sibling `item-price-tag.ts`: it knows the order DTOs and
 * `Australia/Sydney`, and it is not part of the portable `label-core/` set. See
 * that file's header for the split.
 *
 * Ported from `components/orders/OrderViewer.tsx handlePrintLabel` plus
 * `components/orders/order-label-zpl.ts`, which built the ZPL string directly.
 * What changes in the port is what the new template made possible rather than
 * anything about the order:
 *
 *   - **The Korean name is passed through.** The old builder gated `name_ko`
 *     behind an "is this printable ASCII" test, because its `^A0` fields had no
 *     `^CI28` and could not carry hangul; the test never passed, so the line
 *     never printed. `renderLabel` emits `^CI28` and the Noto faces are in
 *     printer flash, so the name simply goes on the label now.
 *   - **Nothing is sanitised here.** `sanitizeZplText` stripped every non-ASCII
 *     byte to keep `^FD` safe; `label-core/escape.ts fieldData` escapes the three
 *     characters that actually matter (`^ ~ _`) and leaves UTF-8 intact.
 *   - **The QR is real.** The old label drew an empty box captioned `ORDER QR`.
 *     The payload is `order%%%<orderId>` — the same string
 *     `pick-list-render.ts` puts in the pick-list QR, so one scan handler reads
 *     both.
 *
 * Runtime imports are `dayjsAU` and two dependency-free modules, so the
 * colocated `*.test.mjs` runs this directly under node.
 */

import dayjsAU from "../../libs/dayjsAU";
import { ORDER_QR_PREFIX } from "../../libs/order-qr";
import { formatOrderLabelOptionLine } from "../../components/orders/order-label-zpl";
import type { OrderDetail, OrderLine } from "../../service/order.service";
import type { OrderLabelInput } from "../templates/order-100100";

/** All the label needs from the order itself. */
export type OrderLabelOrder = Pick<OrderDetail, "id" | "orderNo" | "dueAt">;

/**
 * The unit printed beside the quantity.
 *
 * Order lines carry no unit: `OrderLine.qty` is a plain EA integer (not the
 * POS `QTY_SCALE` fixed-point), and neither the line nor the detail exposes the
 * source item's `uom`. Owner decision (2026-08-26): print `EA` until the order
 * DTO carries a real unit.
 */
export const ORDER_LINE_UOM = "EA";

/**
 * `Thu 27th Aug 14:00` — the format `order-100100.ts` documents.
 *
 * The server computes `dueAt`; this only renders it, in Sydney time, and never
 * recomputes a deadline. `Do` needs dayjs's `advancedFormat` plugin, which
 * `libs/dayjsAU.ts` already extends.
 *
 * A null or unparseable `dueAt` returns null and the template prints `-`,
 * rather than dropping the word — a due line that is simply absent reads as
 * "no deadline".
 */
export function formatOrderLabelDue(iso: string | null): string | null {
  if (!iso) return null;
  const at = dayjsAU(iso);
  return at.isValid() ? at.format("ddd Do MMM HH:mm") : null;
}

/**
 * One made-to-order line, as a label.
 *
 * The name fallback is the old builder's: an empty English name falls back to
 * `#<sourceItemId>`, so a line with no name still identifies the item it came
 * from. The Korean name has no fallback — it is either there or the line is
 * omitted.
 */
export function toOrderLabelInput(
  detail: OrderLabelOrder,
  line: OrderLine,
): OrderLabelInput {
  return {
    orderNo: detail.orderNo,
    dueText: formatOrderLabelDue(detail.dueAt),
    nameKo: line.name_ko,
    nameEn: line.name_en.trim() || `#${line.sourceItemId}`,
    qty: line.qty,
    uom: ORDER_LINE_UOM,
    optionLines: line.options.map(formatOrderLabelOptionLine),
    orderQrData: `${ORDER_QR_PREFIX}${detail.id}`,
    // No PP payload on an order label — the template then draws no second box,
    // which is the point: an empty box on a 100 mm label is a large way to
    // print nothing. Owner decision (2026-08-26).
    ppQrData: null,
  };
}
