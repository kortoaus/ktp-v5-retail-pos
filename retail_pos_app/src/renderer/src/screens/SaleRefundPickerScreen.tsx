// SaleRefundPickerScreen — `/manager/refund` entry.
// SALE invoice 를 골라서 `/manager/refund/:invoiceId` 로 이동시키는 래퍼.
// QR 스캔 / row 클릭 모두 onSelect 에서 navigate.

import { useNavigate } from "react-router-dom";
import SaleInvoiceSearchPanel from "../components/SaleInvoiceSearchPanel";

export default function SaleRefundPickerScreen() {
  const navigate = useNavigate();

  return (
    <div className="flex flex-col h-full bg-white">
      {/* Header */}
      <div className="h-14 px-4 flex items-center gap-4 border-b border-gray-200">
        <button
          type="button"
          onPointerDown={() => navigate("/")}
          className="px-4 py-2 rounded-lg bg-gray-100 active:bg-gray-200 text-sm font-medium"
        >
          ← Back
        </button>
        <h1 className="text-lg font-bold">Refund — Select Invoice</h1>
        <div className="text-xs text-gray-400">
          SALE invoice 만 환불 가능 (SPEND / REFUND 제외)
        </div>
      </div>

      <div className="flex-1 min-h-0">
        <SaleInvoiceSearchPanel
          onSelect={(inv) => navigate(`/manager/refund/${inv.id}`)}
          lockedTypeFilter="SALE"
          emptyLabel="No sale invoices"
        />
      </div>
    </div>
  );
}
