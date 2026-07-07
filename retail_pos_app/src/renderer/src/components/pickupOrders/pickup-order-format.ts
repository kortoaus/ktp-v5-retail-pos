import { MONEY_DP, MONEY_SCALE, QTY_SCALE } from "../../libs/constants";
import dayjsAU from "../../libs/dayjsAU";
import type {
  PickupOrderDetail,
  PickupOrderDetailWire,
  PickupOrderLine,
  PickupOrderLineWire,
  PickupOrderListItem,
  PickupOrderListItemWire,
  PickupOrderSelectedOption,
  PickupOrderSelectedOptionGroup,
  PickupOrderStatus,
} from "./pickup-order-types";

const groupTypes = new Set(["SINGLE", "MULTIPLE", "QUANTITY"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function readString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function readNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function present<T>(value: T | null): value is T {
  return value !== null;
}

function isGroupType(
  value: string,
): value is PickupOrderSelectedOptionGroup["type"] {
  return groupTypes.has(value);
}

function normalizeOption(value: unknown): PickupOrderSelectedOption | null {
  if (!isRecord(value)) return null;
  const key = readString(value.key);
  const name_en = readString(value.name_en);
  const name_ko = readString(value.name_ko);
  const qty = readNumber(value.qty);
  const priceDelta = readNumber(value.priceDelta);
  if (
    !key ||
    name_en == null ||
    name_ko == null ||
    qty == null ||
    priceDelta == null
  ) {
    return null;
  }
  return { key, name_en, name_ko, qty, priceDelta };
}

function normalizeOptionGroup(
  value: unknown,
): PickupOrderSelectedOptionGroup | null {
  if (!isRecord(value)) return null;
  const optionGroupId = readNumber(value.optionGroupId);
  const key = readString(value.key);
  const name_en = readString(value.name_en);
  const name_ko = readString(value.name_ko);
  const type = readString(value.type);
  const selectedOptions = Array.isArray(value.selectedOptions)
    ? value.selectedOptions.map(normalizeOption).filter(present)
    : null;

  if (
    optionGroupId == null ||
    !key ||
    name_en == null ||
    name_ko == null ||
    !type ||
    !isGroupType(type) ||
    selectedOptions == null
  ) {
    return null;
  }

  return {
    optionGroupId,
    key,
    name_en,
    name_ko,
    type,
    selectedOptions,
  };
}

export function normalizeSelectedOptionGroups(
  value: unknown,
): PickupOrderSelectedOptionGroup[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeOptionGroup).filter(present);
}

export function normalizePickupOrderLine(
  line: PickupOrderLineWire,
): PickupOrderLine {
  return {
    ...line,
    selectedOptionsSnapshot: normalizeSelectedOptionGroups(
      line.selectedOptionsSnapshot,
    ),
  };
}

export function normalizePickupOrderListItem(
  order: PickupOrderListItemWire,
): PickupOrderListItem {
  return {
    ...order,
    lines: order.lines.map(normalizePickupOrderLine),
  };
}

export function normalizePickupOrderDetail(
  order: PickupOrderDetailWire,
): PickupOrderDetail {
  return normalizePickupOrderListItem(order);
}

export function formatPickupMoney(cents: number): string {
  return `$${(cents / MONEY_SCALE).toFixed(MONEY_DP)}`;
}

export function formatPickupQty(qty: number, uom: string): string {
  const display = (qty / QTY_SCALE).toFixed(3).replace(/\.?0+$/, "");
  return `${display} ${uom}`.trim();
}

export function formatPickupTime(value: string): string {
  return dayjsAU(value).format("ddd, DD MMM YYYY hh:mm A");
}

export function countSelectedOptions(
  groups: PickupOrderSelectedOptionGroup[],
): number {
  return groups.reduce((sum, group) => sum + group.selectedOptions.length, 0);
}

export function statusLabel(status: PickupOrderStatus): string {
  return status.replaceAll("_", " ");
}
