import { useState } from "react";
import { cn } from "../libs/cn";
import { getLatestSaleInvoice } from "../service/sale.service";
import { printSaleInvoiceReceipt } from "../libs/printer/sale-invoice-receipt";

// 현재 terminal 의 마지막 invoice 를 조회해서 재출력. 모든 type (SALE/REFUND/
// SPEND) 대상. 출력물은 항상 "** COPY **" 표기.
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
      const res = await getLatestSaleInvoice();
      if (!res.ok) {
        window.alert(res.msg || "Failed to fetch latest invoice");
        return;
      }
      if (!res.result) {
        window.alert("No invoice on this terminal yet");
        return;
      }
      await printSaleInvoiceReceipt(res.result, true);
    } catch (e) {
      console.error("print latest failed:", e);
      window.alert("Failed to print");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div
      className={cn(
        "center cursor-pointer select-none",
        loading && "opacity-50 pointer-events-none",
        className,
      )}
      onClick={handlePrint}
    >
      <div>Print</div>
      <div>Latest</div>
    </div>
  );
}
