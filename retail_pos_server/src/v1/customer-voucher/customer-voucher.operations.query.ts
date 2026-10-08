import { BadRequestException } from "../../libs/exceptions";
import {
  prismaCvOperationStore,
  type CustomerVoucherOperationStore,
  type CvOperationStatus,
} from "./customer-voucher.operation.store";

// GET /api/customer-voucher/operations?status=UNRESOLVED,CONFIRMED (T-15).
// Lists ledger rows (newest first, max 200). Note CONFIRMED includes rows
// waiting for their sale transaction; open = INTENT/UNRESOLVED/CONFIRMED
// without invoice (see customer-voucher.operation.store.ts).
const ALL_STATUSES: CvOperationStatus[] = [
  "INTENT",
  "CONFIRMED",
  "LINKED",
  "VOIDED",
  "UNRESOLVED",
  "FAILED",
];
const DEFAULT_STATUSES: CvOperationStatus[] = ["INTENT", "CONFIRMED", "UNRESOLVED"];

export function parseOperationStatuses(raw: string | undefined): CvOperationStatus[] {
  if (raw == null || raw.trim() === "") return DEFAULT_STATUSES;
  const out: CvOperationStatus[] = [];
  for (const part of raw.split(",")) {
    const value = part.trim().toUpperCase();
    if (!value) continue;
    const status = ALL_STATUSES.find((s) => s === value);
    if (!status)
      throw new BadRequestException(
        `status must be a comma list of ${ALL_STATUSES.join(", ")}`,
      );
    if (!out.includes(status)) out.push(status);
  }
  return out.length ? out : DEFAULT_STATUSES;
}

export async function listCustomerVoucherOperationsService(
  rawStatus: string | undefined,
  store: CustomerVoucherOperationStore = prismaCvOperationStore,
) {
  const statuses = parseOperationStatuses(rawStatus);
  const [rows, openCount] = await Promise.all([
    store.list(statuses, 200),
    store.countOpen(),
  ]);
  return { ok: true, result: rows, openCount };
}
