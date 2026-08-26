/**
 * Batching several labels into one job.
 *
 * A ZPL stream is just formats back to back — `^XZ^XA` needs nothing between
 * them — so merging is concatenation. It matters because the transport opens a
 * socket (or a serial port) per job: printing forty price tags as forty jobs
 * means forty connections, and on a serial printer that is forty chances to
 * lose one. They are separated by a newline purely so a human reading the
 * generated string can tell where a label ends.
 */

import type { Label } from "./model";
import { renderLabel } from "./zpl";

export function mergeJobs(labels: Array<Label | string>): string {
  return labels
    .map((label) => (typeof label === "string" ? label : renderLabel(label)))
    .join("\n");
}
