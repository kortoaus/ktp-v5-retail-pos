import { useState } from "react";
import { RefundableInvoice } from "../../types/models";
import SearchInvoiceModal from "../../components/SearchInvoiceModal";
import { Link } from "react-router-dom";
import SyncButton from "../../components/SyncButton";
import RefundPanels from "./RefundPanels";
import { getRefundableInvoiceById } from "../../service/sale.service";

type ModalTarget = null | "invoice" | "item-search" | "member-search";

export default function RefundScreen() {
  const [modalTarget, setModalTarget] = useState<ModalTarget | null>(null);
  const [loading, setLoading] = useState(false);
  const [invoice, setInvoice] = useState<RefundableInvoice | null>(null);

  async function handleSearchInvoice(invoiceId: number) {
    if (loading) return;
    setLoading(true);

    try {
      const { ok, result, msg } = await getRefundableInvoiceById(invoiceId);
      if (ok && result) {
        setInvoice(result);
      } else {
        window.alert(msg);
      }
    } catch (e) {
      console.log(e);
      window.alert("Failed to search invoice");
    } finally {
      setLoading(false);
    }
  }

  if (loading) return <div>loading...</div>;

  return (
    <div className="h-full w-full bg-gray-50 flex flex-col">
      <div className="h-16 flex items-center gap-4 px-4 border-b border-gray-200">
        <Link to="/">
          <button className="text-sm text-blue-600 hover:text-blue-800 font-medium">
            &larr; Back
          </button>
        </Link>

        <SyncButton />
      </div>

      {invoice && <RefundPanels invoice={invoice} />}
      {!invoice && (
        <div className="flex-1 center gap-8">
          <h1>Please select an invoice to refund</h1>
          <button
            className="bg-blue-500 text-white px-4 py-2 rounded-md"
            onClick={() => setModalTarget("invoice")}
          >
            Search Invoice
          </button>
        </div>
      )}

      <SearchInvoiceModal
        open={modalTarget === "invoice"}
        onClose={() => setModalTarget(null)}
        onSelect={(invoice) => {
          if (invoice.type !== "sale") {
            window.alert("Only sale invoices can be refunded");
            return;
          }
          handleSearchInvoice(invoice.id);
          setModalTarget(null);
        }}
      />
    </div>
  );
}
