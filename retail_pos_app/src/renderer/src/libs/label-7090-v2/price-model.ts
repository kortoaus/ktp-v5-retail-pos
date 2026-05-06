import { Item } from "../../types/models";
import { fmtDateRangeStr } from "../dayjsAU";
import { itemNameParser } from "../item-utils";
import type {
  PriceDisplay,
  PriceTag7090BuildOptions,
  PriceTag7090Case,
  PriceTag7090Model,
} from "./types";

function positivePrice(value: number | undefined): number | null {
  return typeof value === "number" && value > 0 ? value : null;
}

function memberPrice(guestCents: number, value: number | undefined): number | null {
  const priceCents = positivePrice(value);
  return priceCents !== null && priceCents < guestCents ? priceCents : null;
}

function display(
  label: "GUEST" | "MEMBER",
  baseGuestCents: number,
  priceCents: number,
): PriceDisplay {
  return {
    label,
    priceCents,
    saveCents: Math.max(0, baseGuestCents - priceCents),
  };
}

export function getPriceTag7090Model(
  item: Item,
  options: PriceTag7090BuildOptions = {},
): PriceTag7090Model {
  const { name_en, name_ko } = itemNameParser(item);
  const usePromo = options.priceMode !== "normal";
  const storeName = options.storeName?.trim() || "Special";
  const baseGuestCents = item.price?.prices[0] ?? 0;
  const normalMemberCents = memberPrice(baseGuestCents, item.price?.prices[1]);
  const promoGuestCandidate = usePromo
    ? positivePrice(item.promoPrice?.prices[0])
    : null;
  const hasPromo = promoGuestCandidate !== null;
  const guestPriceCents =
    promoGuestCandidate !== null
      ? Math.min(baseGuestCents, promoGuestCandidate)
      : baseGuestCents;
  const promoMemberCents = hasPromo
    ? memberPrice(guestPriceCents, item.promoPrice?.prices[1])
    : null;
  const memberPriceCents = hasPromo ? promoMemberCents : normalMemberCents;
  const hasMember = memberPriceCents !== null;

  let caseName: PriceTag7090Case;
  if (hasPromo && hasMember) {
    caseName = "promo-member";
  } else if (hasPromo) {
    caseName = "promo-guest";
  } else if (hasMember) {
    caseName = "normal-member";
  } else {
    caseName = "normal-guest";
  }

  return {
    caseName,
    headline:
      caseName === "normal-member"
        ? "Member Price"
        : hasPromo
          ? item.promoPrice?.name_en || "Special"
          : storeName,
    barcode: item.barcodeGTIN || item.barcodePLU || item.barcode,
    code: item.code,
    nameKo: name_ko,
    nameEn: name_en,
    uom: item.uom,
    baseGuestCents,
    guest: display("GUEST", baseGuestCents, guestPriceCents),
    member:
      hasMember && memberPriceCents !== null
        ? display("MEMBER", baseGuestCents, memberPriceCents)
        : null,
    promoNameKo: hasPromo ? item.promoPrice?.name_ko ?? null : null,
    promoNameEn: hasPromo ? item.promoPrice?.name_en ?? null : null,
    promoDateRange:
      hasPromo && item.promoPrice
        ? fmtDateRangeStr(item.promoPrice.validFrom, item.promoPrice.validTo)
        : null,
  };
}
