type PriceTierSource = { prices: number[] } | null;

export type PriceTagQueueBadge = "P" | "M" | "PM" | null;

export function getPriceTagQueueBadge({
  price,
  promoPrice,
}: {
  price: PriceTierSource;
  promoPrice: PriceTierSource;
}): PriceTagQueueBadge {
  if (promoPrice != null) {
    return hasDifferentMemberPrice(promoPrice) ? "PM" : "P";
  }

  return hasDifferentMemberPrice(price) ? "M" : null;
}

function hasDifferentMemberPrice(price: PriceTierSource) {
  if (price == null) return false;
  const [guestPrice, memberPrice] = price.prices;
  return (
    typeof guestPrice === "number" &&
    typeof memberPrice === "number" &&
    guestPrice !== memberPrice
  );
}
