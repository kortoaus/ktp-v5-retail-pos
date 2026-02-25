import { useRef, useState } from "react";
import { RefundableInvoice, RefundableRow } from "../../types/models";
import PagingRowList from "../../components/list/PagingRowList";
import Decimal from "decimal.js";
import RefundQtyModal from "./RefundQtyModal";
import RefundableRowCard from "./RefundableRowCard";
import RefundedRowCard from "./RefundedRowCard";
import { ClientRefundableRow } from "./refund.types";

type ModalTarget = null | "qty-input";

export default function RefundPanels({
  invoice,
}: {
  invoice: RefundableInvoice;
}) {
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

    // all or nothing, weight-prepacked qty is actually 1 always.
    if (row.type === "weight-prepacked" || row.qty === 1) {
      if (row.remainingQty === 0) {
        window.alert("This line is already fully refunded.");
        return;
      }
      const newRow: ClientRefundableRow = {
        ...row,
        original_invoice_row_id: row.id,
        original_invoice_id: row.invoiceId,
        qty: row.qty,
        applyQty: row.qty,
      };
      setRefundedRows([...refundedRows, newRow]);
      return;
    }

    if (row.remainingQty === 0) {
      window.alert("This line is already fully refunded.");
      return;
    }

    pendingRowRef.current = row;
    setModalTarget("qty-input");
  }

  function onQtyConfirm(inputQtyNum: number) {
    const row = pendingRowRef.current;
    if (!row) return;

    const inputQty = new Decimal(inputQtyNum);
    const originalQty = new Decimal(row.qty);
    const remainingQty = new Decimal(row.remainingQty);

    if (originalQty.isZero()) {
      window.alert("Original quantity is 0. Please check the invoice.");
      return;
    }

    if (inputQty.gt(remainingQty)) {
      window.alert(
        "Input quantity is greater than remaining quantity. Please check the invoice.",
      );
      return;
    }

    const originalTotal = new Decimal(row.total);
    const appliedEffectiveUnitPrice = originalTotal.div(originalQty);
    const appliedTotal = appliedEffectiveUnitPrice.mul(inputQty);

    // all rest
    if (inputQty.eq(remainingQty)) {
      const newRow: ClientRefundableRow = {
        ...row,
        unit_price_effective: appliedEffectiveUnitPrice.toNumber(),
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

    const originalTaxAmount = new Decimal(row.tax_amount_included);
    const ratio = inputQty.div(originalQty);
    const appliedTaxAmount = originalTaxAmount.mul(ratio);

    // partial
    const newRow: ClientRefundableRow = {
      ...row,
      unit_price_effective: appliedEffectiveUnitPrice.toNumber(),
      qty: inputQty.toNumber(),
      total: appliedTotal.toNumber(),
      tax_amount_included: appliedTaxAmount.toNumber(),
      applyQty: inputQty.toNumber(),
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

      <div className="flex-1 flex flex-col">
        {/* {JSON.stringify(refundedRows, null, 2)} */}
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
    </div>
  );
}
