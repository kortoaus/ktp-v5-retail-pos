export const RECEIPT_EXTRA_FOOTER_LINE_WIDTH = 42;

export type ReceiptExtraFooterValidationError = {
  lineNumber: number;
  width: number;
  maxWidth: number;
};

export type ReceiptExtraFooterValidation = {
  ok: boolean;
  errors: ReceiptExtraFooterValidationError[];
};

const normalizeNewlines = (value: string): string => value.replace(/\r\n?/g, "\n");

const receiptFooterCharWidth = (char: string): number => {
  const codePoint = char.codePointAt(0);
  return codePoint !== undefined && codePoint >= 0x20 && codePoint <= 0x7e
    ? 1
    : 2;
};

export const receiptFooterPrintWidth = (value: string): number => {
  let width = 0;

  for (const char of value) {
    width += receiptFooterCharWidth(char);
  }

  return width;
};

export const splitReceiptExtraFooterLines = (
  value: string | null | undefined,
): string[] => {
  if (value == null || value.trim() === "") {
    return [];
  }

  return normalizeNewlines(value).split("\n");
};

export const normalizeReceiptExtraFooterPayload = (
  value: string,
): string | undefined => {
  if (value.trim() === "") {
    return undefined;
  }

  return normalizeNewlines(value);
};

export const validateReceiptExtraFooterText = (
  value: string,
  maxWidth = RECEIPT_EXTRA_FOOTER_LINE_WIDTH,
): ReceiptExtraFooterValidation => {
  const lines = splitReceiptExtraFooterLines(value);
  const errors: ReceiptExtraFooterValidationError[] = [];

  lines.forEach((line, index) => {
    const width = receiptFooterPrintWidth(line);

    if (width > maxWidth) {
      errors.push({
        lineNumber: index + 1,
        width,
        maxWidth,
      });
    }
  });

  return {
    ok: errors.length === 0,
    errors,
  };
};

export const truncateReceiptExtraFooterLine = (
  value: string,
  maxWidth = RECEIPT_EXTRA_FOOTER_LINE_WIDTH,
): string => {
  if (maxWidth <= 0) {
    return "";
  }

  let width = 0;
  let result = "";

  for (const char of value) {
    const charWidth = receiptFooterCharWidth(char);

    if (width + charWidth > maxWidth) {
      break;
    }

    width += charWidth;
    result += char;
  }

  return result.trimEnd();
};
