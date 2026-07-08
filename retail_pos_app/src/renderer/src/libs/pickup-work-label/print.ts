import { QTY_SCALE } from "../constants";
import type { LabelPrinter } from "../../hooks/useZplPrinters";

export const PICKUP_WORK_LABEL_MEDIA_SIZE = "100100" as const;

export type PickupWorkLabelPrinter = LabelPrinter & {
  mediaSize: typeof PICKUP_WORK_LABEL_MEDIA_SIZE;
};

export function getPickupWorkLabelPrinters(
  printers: LabelPrinter[],
): PickupWorkLabelPrinter[] {
  return printers.filter(
    (printer): printer is PickupWorkLabelPrinter =>
      printer.mediaSize === PICKUP_WORK_LABEL_MEDIA_SIZE,
  );
}

export function getPickupWorkLabelPrintCount(qty: number): number {
  return Math.max(1, Math.ceil(qty / QTY_SCALE));
}
