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
