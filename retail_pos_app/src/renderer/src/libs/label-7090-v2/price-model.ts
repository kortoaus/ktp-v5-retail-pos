import { Item } from "../../types/models";
import { fmtDateRangeStr } from "../dayjsAU";
import { itemNameParser } from "../item-utils";
import type {
  PriceDisplay,
  PriceTag7090Case,
  PriceTag7090Model,
} from "./types";

function positivePrice(value: number | undefined): number | null {
  return typeof value === "number" && value > 0 ? value : null;
}

function minPositivePrice(prices: Array<number | null>): number | null {
  const positivePrices = prices.filter((price) => price !== null);
  return positivePrices.length > 0 ? Math.min(...positivePrices) : null;
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

export function getPriceTag7090Model(item: Item): PriceTag7090Model {
  const { name_en, name_ko } = itemNameParser(item);
  const baseGuestCents = item.price?.prices[0] ?? 0;
  const normalMemberCents = positivePrice(item.price?.prices[1]);
  const promoGuestCents = positivePrice(item.promoPrice?.prices[0]);
  const promoMemberCents = positivePrice(item.promoPrice?.prices[1]);

  const hasPromo = promoGuestCents !== null;
  const guestPriceCents =
    promoGuestCents !== null
      ? Math.min(baseGuestCents, promoGuestCents)
      : baseGuestCents;
  const memberPriceCents = minPositivePrice([
    normalMemberCents,
    promoMemberCents,
  ]);
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
