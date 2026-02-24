import { Link } from "react-router-dom";
import InvoiceSearchPanel from "../../components/InvoiceSearchPanel";

export default function SaleInvoiceSearchScreen() {
  return (
    <InvoiceSearchPanel
      headerLeft={
        <Link
          to="/"
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          &larr; Back
        </Link>
      }
    />
  );
}
