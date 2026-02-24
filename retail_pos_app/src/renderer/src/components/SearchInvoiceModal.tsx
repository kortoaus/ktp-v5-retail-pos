import { SaleInvoice } from "../types/models";
import InvoiceSearchPanel from "./InvoiceSearchPanel";

interface SearchInvoiceModalProps {
  open: boolean;
  onClose: () => void;
  onSelect?: (invoice: SaleInvoice) => void;
}

export default function SearchInvoiceModal({
  open,
  onClose,
  onSelect,
}: SearchInvoiceModalProps) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center"
      style={{ zIndex: 999 }}
    >
      <div className="w-[95%] h-[95%] bg-white rounded-2xl shadow-2xl overflow-hidden">
        <InvoiceSearchPanel
          headerLeft={
            <button
              type="button"
              onPointerDown={onClose}
              className="text-sm text-red-600 active:text-red-800 font-medium"
            >
              Cancel
            </button>
          }
          onSelect={onSelect}
          scanEnabled={open}
        />
      </div>
    </div>
  );
}
