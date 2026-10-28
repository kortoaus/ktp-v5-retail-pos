// Settings → Payments (retail-eftpos T-7): the integrated card terminal for
// this lane. Two tabs, full width (1366×768):
//   Terminal    — SCI pairing (certification rules: the "Simple Cloud
//                 Integration" name + SCI logo, Pairing Code, optional
//                 Nickname, Pair / Test / Cancel, paired state, Unpair; the
//                 operator picks this lane's terminal — never auto-assigned)
//   Diagnostics — read-only (D-5): GET /api/eft/lanes + the last transaction's
//                 events, with a Refresh button.
// Every call is the store server's lane API (staff session, scope "sale").
import { useState } from "react";
import { Link } from "react-router-dom";
import { useUser } from "../../contexts/UserContext";
import BlockScreen from "../../components/BlockScreen";
import { cn } from "../../libs/cn";
import hasScope from "../../libs/scope-utils";
import SciPairingTab from "./SciPairingTab";
import EftDiagnosticsTab from "./EftDiagnosticsTab";

type Tab = "terminal" | "diagnostics";

export default function PaymentSettingsScreen() {
  const { user, loading } = useUser();
  const [tab, setTab] = useState<Tab>("terminal");

  if (loading) {
    return <div className="flex items-center justify-center h-full text-gray-400">Loading...</div>;
  }
  if (!user || !hasScope(user.scope, ["sale"])) {
    return <BlockScreen label="You are not authorized to access this page" link="/" />;
  }

  return (
    <div className="h-full flex flex-col bg-gray-50">
      <div className="h-12 shrink-0 flex items-center gap-4 px-4 border-b border-gray-200 bg-white">
        <Link to="/" className="text-sm text-blue-600 hover:text-blue-800 font-medium">
          &larr; Back
        </Link>
        <span className="text-base font-bold text-gray-900">Payments</span>
        <div className="flex gap-1 ml-4">
          {(
            [
              ["terminal", "Card terminal"],
              ["diagnostics", "Diagnostics"],
            ] as const
          ).map(([key, label]) => (
            <button
              key={key}
              type="button"
              onClick={() => setTab(key)}
              className={cn(
                "h-9 px-4 rounded-md text-sm font-semibold",
                tab === key ? "bg-blue-600 text-white" : "bg-gray-100 text-gray-700 hover:bg-gray-200",
              )}
            >
              {label}
            </button>
          ))}
        </div>
      </div>
      <div className="flex-1 min-h-0">{tab === "terminal" ? <SciPairingTab /> : <EftDiagnosticsTab />}</div>
    </div>
  );
}
