import { BarcodeType } from "../generated/prisma/enums";

/**
 * Validate a UPC-A code (12 digits) by verifying its check digit.
 *
 * UPC-A structure: 11 data digits + 1 check digit
 * Check digit rules (for the first 11 digits):
 * - Sum digits in odd positions (1,3,5,...,11) and multiply by 3
 * - Add sum of digits in even positions (2,4,6,...,10)
 * - Check digit = (10 - (total % 10)) % 10
 */
export function isValidUpcA(upc12: string): boolean {
  if (!/^\d{12}$/.test(upc12)) return false;

  const payload = upc12.slice(0, 11);
  const expectedCd = upc12.charCodeAt(11) - 48;

  let oddSum = 0; // positions 1,3,5,...,11 (1-based) within the 11-digit payload
  let evenSum = 0; // positions 2,4,6,...,10

  for (let i = 0; i < 11; i++) {
    const d = payload.charCodeAt(i) - 48;
    // i is 0-based; position = i+1
    if ((i + 1) % 2 === 1) oddSum += d;
    else evenSum += d;
  }

  const total = oddSum * 3 + evenSum;
  const computedCd = (10 - (total % 10)) % 10;

  return computedCd === expectedCd;
}

/**
 * Validate an EAN-13 code by checking its structure and check digit.
 *
 * EAN-13 structure: 12 data digits + 1 check digit (13 total)
 * Check digit calculation:
 * 1. Sum all digits in odd positions (1st, 3rd, ..., 11th, 13th) [except the 13th, which is the check digit]
 * 2. Sum all digits in even positions (2nd, 4th, ..., 12th)
 * 3. total = (sumOdd * 1) + (sumEven * 3)
 * 4. The check digit is (10 - (total % 10)) % 10
 * @param ean13 The EAN-13 code as a string
 * @returns true if valid, false otherwise
 */
export function isValidEan13(ean13: string): boolean {
  if (!/^\d{13}$/.test(ean13)) return false;

  let sum = 0;
  for (let i = 0; i < 12; i++) {
    const digit = parseInt(ean13[i], 10);
    if (isNaN(digit)) return false;
    sum += digit * (i % 2 === 0 ? 1 : 3);
  }
  const calcCheckDigit = (10 - (sum % 10)) % 10;
  const actualCheckDigit = parseInt(ean13[12], 10);
  if (isNaN(actualCheckDigit)) return false;

  return calcCheckDigit === actualCheckDigit;
}

export function fiveDigitFloat(val: number): string {
  const cents = Math.min(Math.round(val * 100), 99999);
  return String(cents).padStart(5, "0");
}

export function ean13CheckDigit(rawBarcode: string): number {
  const payload = rawBarcode.slice(0, 12);
  let sum = 0;
  for (let i = 0; i < 12; i++) {
    sum += (payload.charCodeAt(i) - 48) * (i % 2 === 0 ? 1 : 3);
  }
  return (10 - (sum % 10)) % 10;
}

export function isValidGtin14(gtin14: string): boolean {
  if (!/^\d{14}$/.test(gtin14)) return false;

  let sum = 0;
  for (let i = 0; i < 13; i++) {
    const digit = gtin14.charCodeAt(i) - 48;
    sum += digit * (i % 2 === 0 ? 3 : 1);
  }

  const calcCheckDigit = (10 - (sum % 10)) % 10;
  const actualCheckDigit = gtin14.charCodeAt(13) - 48;

  return calcCheckDigit === actualCheckDigit;
}

export function getNormalizedBarcode(rawBarcode: string): {
  type: BarcodeType;
  gtin14: string | null;
  plu: string | null;
} {
  // if raw barcode has not numbers, return null
  // ASSUMPTION: scanner sends digits-only (Label ID / AIM stripped)
  if (!/^\d+$/.test(rawBarcode)) {
    return {
      type: BarcodeType.RAW,
      gtin14: null,
      plu: null,
    };
  }

  const barcode = rawBarcode.replace(/[^0-9]/g, "").trim();

  // prefix included: 02+IIIII
  if (barcode.length === 7 && barcode.startsWith("02")) {
    return {
      type: BarcodeType.PLU,
      gtin14: null,
      plu: barcode,
    };
  }

  if (barcode.length === 13) {
    // CL5000 / EAN13-like: treat as internal label regardless of check digit
    if (barcode.startsWith("02")) {
      return {
        type: BarcodeType.PLU,
        gtin14: null,
        plu: barcode.slice(0, 7), // 02 + IIIII
      };
    }

    if (isValidEan13(barcode)) {
      return {
        type: BarcodeType.EAN,
        gtin14: "0" + barcode,
        plu: null,
      };
    }

    // (optional) if you *really* want to label UPC-expanded-EAN as UPC type, do it here,
    // but it's not necessary for GTIN14 normalization.
  }

  if (barcode.length === 12) {
    if (isValidUpcA(barcode)) {
      return {
        type: BarcodeType.UPC,
        gtin14: "00" + barcode,
        plu: null,
      };
    }
  }

  if (barcode.length === 14) {
    if (isValidGtin14(barcode)) {
      return {
        type: BarcodeType.GTIN,
        gtin14: barcode,
        plu: null,
      };
    }
  }

  if (barcode.length > 14 && barcode.startsWith("01")) {
    // get after 14 characters
    // It extracts the 14 digits of the GTIN-14 from positions 2 (inclusive) to 16 (exclusive).
    // For barcodes starting with "01", positions 2-15 hold the GTIN-14 value (zero-based indices).
    const gtin14 = barcode.substring(2, 16);
    if (isValidGtin14(gtin14)) {
      return {
        type: BarcodeType.GTIN,
        gtin14: gtin14,
        plu: null,
      };
    }
  }

  return {
    type: BarcodeType.RAW,
    gtin14: null,
    plu: null,
  };
}
