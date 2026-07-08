import assert from "node:assert/strict";
import { register } from "node:module";
import test from "node:test";

register(
  `data:text/javascript,${encodeURIComponent(`
    export async function resolve(specifier, context, nextResolve) {
      const isRelative = specifier.startsWith("./") || specifier.startsWith("../");
      const lastSegment = specifier.split("/").at(-1) ?? "";
      const hasExtension = /\\.[a-zA-Z0-9]+$/.test(lastSegment);

      if (isRelative && !hasExtension) {
        try {
          return await nextResolve(specifier, context);
        } catch (error) {
          if (error && error.code === "ERR_MODULE_NOT_FOUND") {
            return nextResolve(\`\${specifier}.ts\`, context);
          }
          throw error;
        }
      }

      return nextResolve(specifier, context);
    }
  `)}`,
);

const { buildPickupWorkLabelModel } = await import(
  "../../src/renderer/src/libs/pickup-work-label/model.ts"
);
const { buildPickupWorkLabelQrPayload, normalizePromoPrices } = await import(
  "../../src/renderer/src/libs/pickup-work-label/pp-payload.ts"
);

const baseLine = {
  crmLineId: 4102,
  index: 2,
  itemId: 501,
  name_en: "  Salmon Bowl  ",
  name_ko: "연어 덮밥",
  barcode: " 9330001112223 ",
  code: "SLM-BOWL",
  uom: "ea",
  prices: [1299, 1199],
  promoPrices: { prices: [1099, "bad", Number.POSITIVE_INFINITY, 999] },
  memberLevel: 1,
  optionTotal: 350,
  qty: 3000,
  total: 4647,
  note: "  no onion please  ",
  selectedOptionsSnapshot: [
    {
      optionGroupId: 10,
      key: "base",
      name_en: "  Base  ",
      name_ko: "베이스",
      type: "SINGLE",
      selectedOptions: [
        {
          key: "brown-rice",
          name_en: "  Brown Rice  ",
          name_ko: "현미밥",
          qty: 1000,
          priceDelta: 0,
        },
        {
          key: "quinoa",
          name_en: "  Quinoa  ",
          name_ko: "퀴노아",
          qty: 500,
          priceDelta: 0,
        },
      ],
    },
    {
      optionGroupId: 20,
      key: "protein",
      name_en: "   ",
      name_ko: "단백질",
      type: "QUANTITY",
      selectedOptions: [
        {
          key: "extra-salmon",
          name_en: "  Extra Salmon  ",
          name_ko: "연어 추가",
          qty: 2000,
          priceDelta: 350,
        },
      ],
    },
  ],
};

const baseOrder = {
  crmOrderId: 9001,
  documentId: "  PU-20260707-0001  ",
  status: "ORDER_CONFIRMED",
  memberId: "crm-member-42",
  memberName: "  Mina Kim  ",
  memberLevel: 1,
  memberPhoneLast4: "4321",
  pickupStartsAt: "2026-07-07T08:30:00.000+10:00",
  linesTotal: 4647,
  total: 4647,
  crmCreatedAt: "2026-07-07T07:30:00.000+10:00",
  crmUpdatedAt: "2026-07-07T07:45:00.000+10:00",
  syncedAt: "2026-07-07T07:45:10.000+10:00",
  lines: [baseLine],
};

test("normalizePromoPrices accepts arrays and records while filtering invalid values", () => {
  assert.deepEqual(
    normalizePromoPrices([100, "200", Number.NaN, 250, Infinity, -50]),
    [100, 250, -50],
  );
  assert.deepEqual(
    normalizePromoPrices({ prices: [999, null, 888, Number.NEGATIVE_INFINITY] }),
    [999, 888],
  );
  assert.deepEqual(normalizePromoPrices({ prices: "999" }), []);
  assert.deepEqual(normalizePromoPrices(null), []);
});

test("buildPickupWorkLabelQrPayload builds a v2 PP barcode without quantity", () => {
  const payload = buildPickupWorkLabelQrPayload({
    barcode: "9330001112223",
    prices: [1299, 1199],
    promoPrices: { prices: [1099, "bad", 999] },
    optionTotal: 350,
    pickupOrderId: 9001,
  });

  assert.equal(payload.startsWith("00:"), true);
  const parsed = JSON.parse(payload.slice("00:".length));
  assert.deepEqual(parsed, {
    "00": 2,
    "01": "9330001112223",
    "02": [1649, 1549],
    "03": [1449, 1349],
    "09": 9001,
  });
  assert.equal(Object.hasOwn(parsed, "04"), false);
});

test('buildPickupWorkLabelQrPayload omits "09" for invalid pickup order ids', () => {
  for (const pickupOrderId of [0, -1, 12.5, Number.NaN]) {
    const payload = buildPickupWorkLabelQrPayload({
      barcode: "9330001112223",
      prices: [1299, 1199],
      promoPrices: { prices: [1099, 999] },
      optionTotal: 350,
      pickupOrderId,
    });

    const parsed = JSON.parse(payload.slice("00:".length));
    assert.equal(Object.hasOwn(parsed, "09"), false);
  }
});

test("buildPickupWorkLabelModel uses English labels and keeps quantity out of QR", () => {
  const model = buildPickupWorkLabelModel(baseOrder, baseLine);

  assert.deepEqual(
    {
      documentId: model.documentId,
      pickupStartsAt: model.pickupStartsAt,
      memberName: model.memberName,
      itemBarcode: model.itemBarcode,
      itemNameEn: model.itemNameEn,
      optionLines: model.optionLines,
      optionTotal: model.optionTotal,
      note: model.note,
    },
    {
      documentId: "PU-20260707-0001",
      pickupStartsAt: "2026-07-07T08:30:00.000+10:00",
      memberName: "Mina Kim",
      itemBarcode: "9330001112223",
      itemNameEn: "Salmon Bowl",
      optionLines: [
        "Base: Brown Rice x1, Quinoa x0.5",
        "protein: Extra Salmon x2",
        "Note: no onion please",
      ],
      optionTotal: 350,
      note: "no onion please",
    },
  );

  const parsedQrPayload = JSON.parse(model.qrPayload.slice("00:".length));
  assert.deepEqual(parsedQrPayload, {
    "00": 2,
    "01": "9330001112223",
    "02": [1649, 1549],
    "03": [1449, 1349],
    "09": 9001,
  });
  assert.equal(Object.hasOwn(parsedQrPayload, "04"), false);
});

test("buildPickupWorkLabelModel falls back when English labels and note are blank", () => {
  const fallbackLine = {
    ...baseLine,
    name_en: " ",
    barcode: "  ",
    code: "  FALLBACK-CODE  ",
    note: "   ",
    selectedOptionsSnapshot: [
      {
        optionGroupId: 30,
        key: "sauce",
        name_en: " ",
        name_ko: "소스",
        type: "MULTIPLE",
        selectedOptions: [
          {
            key: "soy",
            name_en: " ",
            name_ko: "간장",
            qty: 1250,
            priceDelta: 0,
          },
        ],
      },
    ],
  };
  const fallbackOrder = {
    ...baseOrder,
    memberName: " ",
    documentId: " DOC-2 ",
    lines: [fallbackLine],
  };

  const model = buildPickupWorkLabelModel(fallbackOrder, fallbackLine);

  assert.equal(model.documentId, "DOC-2");
  assert.equal(model.memberName, "-");
  assert.equal(model.itemBarcode, "");
  assert.equal(model.itemNameEn, "FALLBACK-CODE");
  assert.deepEqual(model.optionLines, ["sauce: soy x1.25"]);
  assert.equal(model.note, null);
  assert.deepEqual(JSON.parse(model.qrPayload.slice("00:".length)), {
    "00": 2,
    "01": "",
    "02": [1649, 1549],
    "03": [1449, 1349],
    "09": 9001,
  });
});
