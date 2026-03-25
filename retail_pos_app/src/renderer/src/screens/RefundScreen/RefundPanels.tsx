import { useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { RefundableInvoice, RefundableRow } from "../../types/models";
import PagingRowList from "../../components/list/PagingRowList";
import { QTY_SCALE } from "../../libs/constants";
import RefundQtyModal from "./RefundQtyModal";
import RefundableRowCard from "./RefundableRowCard";
import RefundedRowCard from "./RefundedRowCard";
import RefundDocumentMonitor from "./RefundDocumentMonitor";
import RefundPaymentModal from "./RefundPaymentModal";
import { ClientRefundableRow } from "./refund.types";

type ModalTarget = null | "qty-input" | "refund-payment";

export default function RefundPanels({
  invoice,
}: {
  invoice: RefundableInvoice;
}) {
  const navigate = useNavigate();
  const [refundedRows, setRefundedRows] = useState<ClientRefundableRow[]>([]);
  const [modalTarget, setModalTarget] = useState<ModalTarget>(null);
  const pendingRowRef = useRef<RefundableRow | null>(null);

  function onSelectInvoiceRowHandler(row: RefundableRow) {
    if (refundedRows.find((r) => r.id === row.id)) {
      window.alert(
        "This item has already been placed for refund. Please remove it first to modify the quantity.",
      );
      return;
    }

    if (row.remainingQty === 0) {
      window.alert("This line is already fully refunded.");
      return;
    }

    if (
      row.type === "weight-prepacked" ||
      row.qty === QTY_SCALE ||
      row.remainingQty === QTY_SCALE
    ) {
      const newRow: ClientRefundableRow = {
        ...row,
        original_invoice_row_id: row.id,
        original_invoice_id: row.invoiceId,
        qty: row.remainingQty,
        total: row.remainingTotal,
        tax_amount_included: row.remainingIncludedTaxAmount,
        applyQty: row.remainingQty,
      };
      setRefundedRows([...refundedRows, newRow]);
      return;
    }

    pendingRowRef.current = row;
    setModalTarget("qty-input");
  }

  function onQtyConfirm(inputQtyInt: number) {
    const row = pendingRowRef.current;
    if (!row) return;

    if (row.qty === 0) {
      window.alert("Original quantity is 0. Please check the invoice.");
      return;
    }

    if (inputQtyInt > row.remainingQty) {
      window.alert(
        "Input quantity is greater than remaining quantity. Please check the invoice.",
      );
      return;
    }

    if (inputQtyInt === row.remainingQty) {
      const newRow: ClientRefundableRow = {
        ...row,
        qty: row.remainingQty,
        total: row.remainingTotal,
        tax_amount_included: row.remainingIncludedTaxAmount,
        applyQty: row.remainingQty,
        original_invoice_row_id: row.id,
        original_invoice_id: row.invoiceId,
      };
      setRefundedRows([...refundedRows, newRow]);
      pendingRowRef.current = null;
      setModalTarget(null);
      return;
    }

    const netTotal = row.total - row.discount_amount;
    const appliedTotal = Math.round((netTotal * inputQtyInt) / row.qty);
    const appliedTax = Math.round(
      (row.tax_amount_included * inputQtyInt) / row.qty,
    );

    const newRow: ClientRefundableRow = {
      ...row,
      qty: inputQtyInt,
      total: appliedTotal,
      tax_amount_included: appliedTax,
      applyQty: inputQtyInt,
      original_invoice_row_id: row.id,
      original_invoice_id: row.invoiceId,
    };

    setRefundedRows([...refundedRows, newRow]);
    pendingRowRef.current = null;
    setModalTarget(null);
  }

  function onRemoveRefundedRowHandler(row: ClientRefundableRow) {
    if (
      window.confirm(
        "Are you sure you want to remove this item from the refund list?",
      )
    ) {
      setRefundedRows(refundedRows.filter((r) => r.id !== row.id));
    }
  }

  return (
    <div className="flex-1 flex divide-x divide-gray-200">
      <div className="flex-1 flex flex-col">
        <div className="bg-blue-500 text-white h-14 center">Invoice Lines</div>
        <div className="flex-1">
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="text-xs bg-gray-100 border-b border-b-gray-200 h-8 divide-x divide-gray-200 flex *:flex *:justify-center *:items-center">
              <div className="w-10">No.</div>
              <div className="flex-1">Item</div>
              <div className="w-20">Price</div>
              <div className="w-14">Qty</div>
              <div className="w-20">Total</div>
            </div>
            <PagingRowList
              pageSize={5}
              rows={invoice.rows}
              Renderer={(row: { item: RefundableRow; index: number }) => (
                <RefundableRowCard
                  row={row.item}
                  index={row.index}
                  onClick={() => onSelectInvoiceRowHandler(row.item)}
                  appliedQty={
                    refundedRows.find((r) => r.id === row.item.id)?.applyQty ??
                    0
                  }
                />
              )}
            />
          </div>
        </div>
      </div>

      <div className="flex-1 flex flex-col">
        <div className="bg-blue-500 text-white h-14 center">Refunded Lines</div>
        <div className="flex-1">
          <div className="h-full flex flex-col">
            {/* Header */}
            <div className="text-xs bg-gray-100 border-b border-b-gray-200 h-8 divide-x divide-gray-200 flex *:flex *:justify-center *:items-center">
              <div className="w-10">No.</div>
              <div className="flex-1">Item</div>
              <div className="w-14">Qty</div>
              <div className="w-20">Total</div>
            </div>
            <PagingRowList
              pageSize={5}
              rows={refundedRows}
              Renderer={(row: { item: ClientRefundableRow; index: number }) => (
                <RefundedRowCard
                  row={row.item}
                  index={row.index}
                  onClick={() => onRemoveRefundedRowHandler(row.item)}
                />
              )}
            />
          </div>
        </div>
      </div>

      <div className="w-[400px] flex flex-col shrink-0">
        <div className="bg-blue-500 text-white h-14 center">Summary</div>
        <div className="flex-1">
          <RefundDocumentMonitor
            rows={refundedRows}
            onRefund={() => setModalTarget("refund-payment")}
          />
        </div>
      </div>

      <RefundQtyModal
        open={modalTarget === "qty-input"}
        onClose={() => {
          pendingRowRef.current = null;
          setModalTarget(null);
        }}
        row={pendingRowRef.current}
        onConfirm={onQtyConfirm}
      />

      <RefundPaymentModal
        open={modalTarget === "refund-payment"}
        onClose={() => setModalTarget(null)}
        onComplete={() => navigate("/")}
        invoice={invoice}
        refundedRows={refundedRows}
      />
    </div>
  );
}
