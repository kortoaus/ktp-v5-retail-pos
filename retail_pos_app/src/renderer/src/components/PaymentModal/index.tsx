import { useMemo, useState } from "react";
import { SaleLineType } from "../../types/sales";
import { OnPaymentPayload } from "../../types/models";
import { Decimal } from "decimal.js";

const CREDIT_SURCHARGE_RATE = 0.015; // 1.5%

export default function PaymentModal({
  lines,
  onPayment,
}: {
  open: boolean;
  onClose: () => void;
  lines: SaleLineType[];
  onPayment: (payload: OnPaymentPayload) => void;
}) {
  const [documentDiscountMethod, setDocumentDiscountMethod] = useState<
    "percent" | "amount"
  >("percent");
  const [documentDiscountValue, setDocumentDiscountValue] = useState(0);
  const [cashReceived, setCashReceived] = useState(0);
  const [creditReceived, setCreditReceived] = useState(0);

  const subTotal = useMemo(() => {
    return lines.reduce((acc, line) => {
      return acc.add(new Decimal(line.total));
    }, new Decimal(0));
  }, [lines]);

  const taxableRatio = useMemo(() => {
    if (subTotal.isZero()) return new Decimal(0);
    const taxableTotal = lines
      .filter((line) => line.taxable)
      .reduce((acc, line) => {
        return acc.add(new Decimal(line.total));
      }, new Decimal(0));

    return taxableTotal.div(subTotal);
  }, [lines, subTotal]);

  const documentDiscountAmount = useMemo(() => {
    if (documentDiscountMethod === "percent") {
      const factor = new Decimal(documentDiscountValue).div(100);
      return Decimal.min(subTotal, subTotal.mul(factor));
    }
    return Decimal.min(subTotal, new Decimal(documentDiscountValue));
  }, [subTotal, documentDiscountMethod, documentDiscountValue]);

  const creditSurchargeAmount = useMemo(() => {
    return new Decimal(creditReceived).mul(CREDIT_SURCHARGE_RATE);
  }, [creditReceived]);

  const exactDue = useMemo(
    () => subTotal.sub(documentDiscountAmount),
    [subTotal, documentDiscountAmount],
  );

  const totalDue = useMemo(
    () => exactDue.add(creditSurchargeAmount),
    [exactDue, creditSurchargeAmount],
  );

  const roundedTotalDue = useMemo(() => {
    if (cashReceived <= 0) return totalDue;
    return totalDue.toNearest(new Decimal("0.05"), Decimal.ROUND_HALF_UP);
  }, [totalDue, cashReceived]);

  const taxAmount = useMemo(() => {
    const taxableGoods = exactDue.mul(taxableRatio);
    const taxableSurcharge = creditSurchargeAmount.mul(taxableRatio);
    return taxableGoods.add(taxableSurcharge).div(11);
  }, [exactDue, taxableRatio, creditSurchargeAmount]);

  const cashRounding = useMemo(
    () => roundedTotalDue.sub(totalDue),
    [roundedTotalDue, totalDue],
  );

  const remaining = useMemo(() => {
    return roundedTotalDue
      .sub(new Decimal(cashReceived))
      .sub(new Decimal(creditReceived));
  }, [roundedTotalDue, cashReceived, creditReceived]);

  const lineDiscountAmount = useMemo(() => {
    const originalSubTotal = lines.reduce((acc, line) => {
      const originalTotal = new Decimal(line.unit_price_original).mul(line.qty);
      return acc.add(originalTotal);
    }, new Decimal(0));

    return originalSubTotal.sub(subTotal);
  }, [lines, subTotal]);

  const totalDiscountAmount = useMemo(() => {
    return lineDiscountAmount.add(documentDiscountAmount);
  }, [lineDiscountAmount, documentDiscountAmount]);

  return <div>index</div>;
}
