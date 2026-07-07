import { QTY_SCALE } from "../constants";
import type {
  PickupOrderDetail,
  PickupOrderLine,
  PickupOrderSelectedOption,
  PickupOrderSelectedOptionGroup,
} from "../../components/pickupOrders/pickup-order-types";
import { buildPickupWorkLabelQrPayload } from "./pp-payload";

export type PickupWorkLabelModel = {
  documentId: string;
  pickupStartsAt: string;
  memberName: string;
  itemBarcode: string;
  itemNameEn: string;
  optionLines: string[];
  optionTotal: number;
  note: string | null;
  qrPayload: string;
};

function trimValue(value: string | null): string {
  return value?.trim() ?? "";
}

function blankToNull(value: string | null): string | null {
  const trimmed = trimValue(value);
  return trimmed ? trimmed : null;
}

function labelFromEnglish(nameEn: string, key: string): string {
  const trimmed = nameEn.trim();
  return trimmed || key;
}

function formatScaledQty(qty: number): string {
  return (qty / QTY_SCALE).toFixed(3).replace(/\.?0+$/, "");
}

function formatSelectedOption(option: PickupOrderSelectedOption): string {
  return `${labelFromEnglish(option.name_en, option.key)} x${formatScaledQty(
    option.qty,
  )}`;
}

function buildOptionLine(group: PickupOrderSelectedOptionGroup): string | null {
  if (group.selectedOptions.length === 0) return null;
  const groupLabel = labelFromEnglish(group.name_en, group.key);
  const options = group.selectedOptions.map(formatSelectedOption).join(", ");
  return `${groupLabel}: ${options}`;
}

function buildOptionLines(groups: PickupOrderSelectedOptionGroup[]): string[] {
  return groups.flatMap((group) => {
    const line = buildOptionLine(group);
    return line ? [line] : [];
  });
}

function appendNoteLine(optionLines: string[], note: string | null): string[] {
  return note ? [...optionLines, `Note: ${note}`] : optionLines;
}

export function buildPickupWorkLabelModel(
  order: PickupOrderDetail,
  line: PickupOrderLine,
): PickupWorkLabelModel {
  const itemBarcode = line.barcode.trim();
  const code = trimValue(line.code);
  const itemNameEn = line.name_en.trim() || code || itemBarcode;
  const memberName = order.memberName.trim() || "-";
  const note = blankToNull(line.note);

  return {
    documentId: order.documentId.trim(),
    pickupStartsAt: order.pickupStartsAt,
    memberName,
    itemBarcode,
    itemNameEn,
    optionLines: appendNoteLine(
      buildOptionLines(line.selectedOptionsSnapshot),
      note,
    ),
    optionTotal: line.optionTotal,
    note,
    qrPayload: buildPickupWorkLabelQrPayload({
      barcode: itemBarcode,
      prices: line.prices,
      promoPrices: line.promoPrices,
      optionTotal: line.optionTotal,
    }),
  };
}
