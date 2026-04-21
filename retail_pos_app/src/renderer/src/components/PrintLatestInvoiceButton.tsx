import { useState } from "react";
// import { getLatestSaleInvoice } from "../service/sale.service";

import { cn } from "../libs/cn";

export default function PrintLatestInvoiceButton({
  className,
}: {
  className?: string;
}) {
  const [loading, setLoading] = useState(false);

  async function handlePrint() {}

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
