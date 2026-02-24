import { useState } from "react";
import { Member, SaleInvoice, SaleInvoiceRow } from "../../types/models";
import SearchInvoiceModal from "../../components/SearchInvoiceModal";
import { Link } from "react-router-dom";
import SyncButton from "../../components/SyncButton";
import SaleInvoiceRowsViewer from "./SaleInvoiceRowsViewer";

type ModalTarget = null | "invoice" | "item-search" | "member-search";

export type RefundSaleInvoiceRow = Omit<SaleInvoiceRow, "id"> & {
  id: number | null;
};

export default function RefundScreen() {
  const [modalTarget, setModalTarget] = useState<ModalTarget | null>(null);
  const [originalInvoice, setOriginalInvoice] = useState<SaleInvoice | null>(
    null,
  );

  const [existRows, setExistRows] = useState<RefundSaleInvoiceRow[]>([]);
  const [newRows, setNewRows] = useState<RefundSaleInvoiceRow[]>([]);
  const [member, setMember] = useState<Member | null>(null);

  function handleSearchInvoice(invoice: SaleInvoice) {
    setOriginalInvoice(invoice);
    setExistRows(invoice.rows);
    setModalTarget(null);
  }

  return (
    <div className="h-full w-full bg-gray-50 flex flex-col">
      <div className="h-16 flex items-center gap-4 px-4 border-b border-gray-200">
        <Link to="/">
          <button className="text-sm text-blue-600 hover:text-blue-800 font-medium">
            &larr; Back
          </button>
        </Link>
        <button onClick={() => setModalTarget("invoice")}>
          search invoice
        </button>
        <button onClick={() => setModalTarget("item-search")}>
          search item
        </button>
        <button
          onClick={() => {
            if (member === null) {
              setModalTarget("member-search");
            } else {
              setMember(null);
            }
          }}
        >
          {member === null ? "search member" : member.name}
        </button>

        <SyncButton />
      </div>

      <div className="flex-1 flex divide-x divide-gray-200">
        <div className="flex-1 flex flex-col">
          <div className="bg-blue-500 text-white h-14 center">
            Invoice Lines
          </div>
          <div className="flex-1">
            <SaleInvoiceRowsViewer rows={existRows} onSelect={() => {}} />
          </div>
        </div>

        <div className="flex-1 flex flex-col">
          <div className="bg-blue-500 text-white h-14 center">
            Refunded Lines
          </div>
          <div className="flex-1">
            <SaleInvoiceRowsViewer rows={newRows} onSelect={() => {}} />
          </div>
        </div>

        <div className="flex-1 flex flex-col">function</div>
      </div>

      <SearchInvoiceModal
        open={modalTarget === "invoice"}
        onClose={() => setModalTarget(null)}
        onSelect={handleSearchInvoice}
      />
    </div>
  );
}
