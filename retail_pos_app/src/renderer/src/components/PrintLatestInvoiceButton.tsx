import { useState } from "react";
import { getLatestSaleInvoice } from "../service/sale.service";
import { printSaleInvoiceReceipt } from "../libs/printer/sale-invoice-receipt";
import { cn } from "../libs/cn";

export default function PrintLatestInvoiceButton({
  className,
}: {
  className?: string;
}) {
  const [loading, setLoading] = useState(false);

  async function handlePrint() {
    if (loading) return;
    setLoading(true);
    try {
      const { ok, msg, result } = await getLatestSaleInvoice();
      console.log(result);
      if (!ok || !result) {
        window.alert(msg || "No invoice found");
        return;
      }

      await printSaleInvoiceReceipt(result, true);
    } catch (e) {
      console.error(e);
      window.alert("Failed to print latest invoice");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className={cn(
        "center cursor-pointer select-none",
        loading && "opacity-50",
        className,
      )}
      onClick={handlePrint}
    >
      <div>Print</div>
      <div>Latest</div>
    </div>
  );
}
