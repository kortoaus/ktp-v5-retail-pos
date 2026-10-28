import { useEffect, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import apiService from "../libs/api";
import { useShift } from "../contexts/ShiftContext";
import { SHIFT_STATUS_UNKNOWN_MESSAGE, homeShiftRow } from "../libs/shift-close";
import {
  IoPlayCircleOutline,
  IoStopCircleOutline,
  IoCartOutline,
  IoCashOutline,
  IoSettingsOutline,
  IoPeopleOutline,
  IoStorefrontOutline,
  IoServerOutline,
  IoExpandOutline,
  IoTvOutline,
  IoPrintOutline,
  IoReceiptOutline,
  IoBarcodeOutline,
  IoNotificationsOutline,
  IoScaleOutline,
  IoRefreshOutline,
  IoCardOutline,
} from "react-icons/io5";

const btn =
  "w-full h-full rounded-xl font-semibold text-sm transition-colors active:scale-[0.98] flex flex-col items-center justify-center gap-1.5";

export default function HomeScreen() {
  const { shift, loading: shiftLoading, shiftKnown, retryShiftReload } = useShift();
  const [retrying, setRetrying] = useState(false);
  useEffect(() => {
    apiService.logout();
  }, []);

  const loading = shiftLoading;
  if (loading) return <div>loading...</div>;

  // T-10 review round 5 — an unknown shift (its read failed) is not "no
  // shift": offer the same in-place Retry as the Close Shift banner.
  const { row, showShiftActions } = homeShiftRow({ hasShift: shift != null, shiftKnown });
  const handleRetry = async () => {
    setRetrying(true);
    try {
      await retryShiftReload();
    } finally {
      setRetrying(false);
    }
  };

  return (
    <div className="h-full flex flex-col gap-5 p-6">
      {/* Shift */}
      <Section label="Shift">
        {row === "unknown" && (
          <div className="flex-1 min-w-0">
            <button
              className={`${btn} bg-red-50 text-red-800 hover:bg-red-100 disabled:opacity-50`}
              onClick={handleRetry}
              disabled={retrying}
            >
              <IoRefreshOutline size={24} />
              {retrying ? "Retrying..." : SHIFT_STATUS_UNKNOWN_MESSAGE}
            </button>
          </div>
        )}
        {row === "open-shift" && (
          <NavBtn
            to="/shift/open"
            icon={<IoPlayCircleOutline size={24} />}
            className="bg-green-100 text-green-800 hover:bg-green-200"
          >
            Open Shift
          </NavBtn>
        )}
        {row === "close-shift" && (
          <NavBtn
            to="/shift/close"
            icon={<IoStopCircleOutline size={24} />}
            className="bg-red-100 text-red-800 hover:bg-red-200"
          >
            Close Shift
          </NavBtn>
        )}
      </Section>

      {/* Sales */}
      <Section label="Sales">
        {showShiftActions && (
          <>
            <NavBtn
              to="/sale"
              icon={<IoCartOutline size={24} />}
              className="bg-blue-100 text-blue-800 hover:bg-blue-200"
            >
              Sale
            </NavBtn>
            <NavBtn
              to="/manager/cashio"
              icon={<IoCashOutline size={24} />}
              className="bg-blue-50 text-blue-700 hover:bg-blue-100"
            >
              Cash In / Out
            </NavBtn>
          </>
        )}
        <NavBtn
          to="/manager/orders?bucket=new"
          icon={<IoNotificationsOutline size={24} />}
          className="bg-blue-50 text-blue-700 hover:bg-blue-100"
        >
          Orders
        </NavBtn>
        <NavBtn
          to="/manager/invoices"
          icon={<IoReceiptOutline size={24} />}
          className="bg-blue-50 text-blue-700 hover:bg-blue-100"
        >
          Invoice Search
        </NavBtn>
        <NavBtn
          to="/manager/refund"
          icon={<IoReceiptOutline size={24} />}
          className="bg-blue-50 text-blue-700 hover:bg-blue-100"
        >
          Refund
        </NavBtn>
      </Section>

      {/* Tools */}
      <Section label="Tools">
        <NavBtn
          to="/price-tag"
          icon={<IoPrintOutline size={24} />}
          className="bg-amber-50 text-amber-800 hover:bg-amber-100"
        >
          Price Tag
        </NavBtn>
        <NavBtn
          to="/barcode-print"
          icon={<IoBarcodeOutline size={24} />}
          className="bg-amber-50 text-amber-800 hover:bg-amber-100"
        >
          Barcode Print
        </NavBtn>
        {/* The weighing station. The label-core bench it replaced is still
            reachable, from a button in the station's own header. */}
        <NavBtn
          to="/scale"
          icon={<IoScaleOutline size={24} />}
          className="bg-amber-50 text-amber-800 hover:bg-amber-100"
        >
          Scale
        </NavBtn>
        <div className="flex-1 min-w-0">
          <button
            className={`${btn} bg-amber-50 text-amber-800 hover:bg-amber-100`}
            onClick={() => window.electronAPI.toggleFullscreen()}
          >
            <IoExpandOutline size={24} />
            Fullscreen
          </button>
        </div>
        <div className="flex-1 min-w-0">
          <button
            className={`${btn} bg-amber-50 text-amber-800 hover:bg-amber-100`}
            onClick={() => window.electronAPI.toggleCustomerDisplay()}
          >
            <IoTvOutline size={24} />
            Customer Display
          </button>
        </div>
        {/* <SyncPostButton /> */}
        {/* <NavBtn to="/manager/hotkey" icon={<IoGridOutline size={24} />} className="bg-amber-50 text-amber-800 hover:bg-amber-100">
          Hotkey Manager
        </NavBtn> */}
      </Section>

      {/* Settings */}
      <Section label="Settings">
        <NavBtn
          to="/manager/settings"
          icon={<IoSettingsOutline size={24} />}
          className="bg-gray-100 text-gray-700 hover:bg-gray-200"
        >
          Interface Settings
        </NavBtn>
        <NavBtn
          to="/manager/user"
          icon={<IoPeopleOutline size={24} />}
          className="bg-gray-100 text-gray-700 hover:bg-gray-200"
        >
          User Management
        </NavBtn>
        <NavBtn
          to="/manager/store"
          icon={<IoStorefrontOutline size={24} />}
          className="bg-gray-100 text-gray-700 hover:bg-gray-200"
        >
          Store Settings
        </NavBtn>
        <NavBtn
          to="/manager/payments"
          icon={<IoCardOutline size={24} />}
          className="bg-gray-100 text-gray-700 hover:bg-gray-200"
        >
          Payments
        </NavBtn>
        <NavBtn
          to="/server-setup"
          icon={<IoServerOutline size={24} />}
          className="bg-gray-100 text-gray-700 hover:bg-gray-200"
        >
          Server Setup
        </NavBtn>
      </Section>
    </div>
  );
}

function Section({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-bold text-gray-400 uppercase tracking-wide">
        {label}
      </span>
      <div className="flex gap-3 h-28">{children}</div>
    </div>
  );
}

function NavBtn({
  to,
  icon,
  className = "",
  children,
}: {
  to: string;
  icon: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <Link to={to} className="flex-1 min-w-0">
      <button className={`${btn} ${className}`}>
        {icon}
        {children}
      </button>
    </Link>
  );
}
