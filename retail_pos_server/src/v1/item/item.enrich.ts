// T-24 (audit R-13) — one typed join helper for item responses.
//
// Item pricing (item.service.ts) and both hotkey reads (hotkey.service.ts)
// used to match rows with Array.find inside a map — O(items × prices). These
// helpers build an itemId → row Map once per response. `firstByKey` keeps the
// FIRST row per key, exactly what Array.find returned, so responses stay
// byte-identical (see item.enrich.test.ts).

export function firstByKey<T, K>(
  rows: readonly T[],
  key: (row: T) => K,
): Map<K, T> {
  const map = new Map<K, T>();
  for (const row of rows) {
    const k = key(row);
    if (!map.has(k)) map.set(k, row);
  }
  return map;
}

export interface PriceProjection<P, Q, PO, QO> {
  price: (price: P) => PO;
  promoPrice: (promo: Q) => QO;
}

// item → { ...item, price, promoPrice } (null when absent), with an optional
// endpoint-specific projection of the matched price rows.
export function enrichItemsWithPrices<
  I extends { id: number },
  P extends { itemId: number },
  Q extends { itemId: number },
  PO = P,
  QO = Q,
>(
  items: readonly I[],
  prices: readonly P[],
  promoPrices: readonly Q[],
  projection?: PriceProjection<P, Q, PO, QO>,
): Array<I & { price: PO | null; promoPrice: QO | null }> {
  const priceByItem = firstByKey(prices, (p) => p.itemId);
  const promoByItem = firstByKey(promoPrices, (p) => p.itemId);
  return items.map((item) => {
    const price = priceByItem.get(item.id) ?? null;
    const promoPrice = promoByItem.get(item.id) ?? null;
    return {
      ...item,
      price: price && projection ? projection.price(price) : (price as PO | null),
      promoPrice:
        promoPrice && projection
          ? projection.promoPrice(promoPrice)
          : (promoPrice as QO | null),
    };
  });
}

// hotkey → { ...hotkey, keys: [{ ...key, item }] } (item undefined when the
// item row is missing, as before).
export function attachItemsToHotkeyKeys<
  K extends { itemId: number },
  H extends { keys: K[] },
  I extends { id: number },
>(
  hotkeys: readonly H[],
  items: readonly I[],
): Array<Omit<H, "keys"> & { keys: Array<K & { item: I | undefined }> }> {
  const itemById = firstByKey(items, (i) => i.id);
  return hotkeys.map((hotkey) => ({
    ...hotkey,
    keys: hotkey.keys.map((key) => ({
      ...key,
      item: itemById.get(key.itemId),
    })),
  }));
}
