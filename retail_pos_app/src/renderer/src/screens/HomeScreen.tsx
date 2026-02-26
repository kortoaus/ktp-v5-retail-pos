import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import apiService from "../libs/api";
import { useShift } from "../contexts/ShiftContext";
import {
  IoPlayCircleOutline,
  IoStopCircleOutline,
  IoCartOutline,
  IoCashOutline,
  IoArrowUndoOutline,
  IoReceiptOutline,
  IoBarcodeOutline,
  IoGridOutline,
  IoSettingsOutline,
  IoPeopleOutline,
  IoStorefrontOutline,
  IoServerOutline,
  IoFlaskOutline,
} from "react-icons/io5";

const btn =
  "w-full h-full rounded-xl font-semibold text-sm transition-colors active:scale-[0.98] flex flex-col items-center justify-center gap-1.5";

export default function HomeScreen() {
  const { shift, loading: shiftLoading } = useShift();
  useEffect(() => {
    apiService.logout();
  }, []);

  const loading = shiftLoading;
  if (loading) return <div>loading...</div>;

  return (
    <div className="h-full flex flex-col gap-5 p-6">
      {/* Shift */}
      <Section label="Shift">
        {shift === null && (
          <NavBtn to="/shift/open" icon={<IoPlayCircleOutline size={24} />} className="bg-green-100 text-green-800 hover:bg-green-200">
            Open Shift
          </NavBtn>
        )}
        {shift !== null && (
          <NavBtn to="/shift/close" icon={<IoStopCircleOutline size={24} />} className="bg-red-100 text-red-800 hover:bg-red-200">
            Close Shift
          </NavBtn>
        )}
      </Section>

      {/* Sales */}
      <Section label="Sales">
        {shift !== null && (
          <>
            <NavBtn to="/sale" icon={<IoCartOutline size={24} />} className="bg-blue-100 text-blue-800 hover:bg-blue-200">
              Sale
            </NavBtn>
            <NavBtn to="/manager/cashio" icon={<IoCashOutline size={24} />} className="bg-blue-50 text-blue-700 hover:bg-blue-100">
              Cash In / Out
            </NavBtn>
            <NavBtn to="/manager/refund" icon={<IoArrowUndoOutline size={24} />} className="bg-blue-50 text-blue-700 hover:bg-blue-100">
              Refund
            </NavBtn>
          </>
        )}
        <NavBtn to="/manager/invoices" icon={<IoReceiptOutline size={24} />} className="bg-blue-50 text-blue-700 hover:bg-blue-100">
          Invoice Search
        </NavBtn>
      </Section>

      {/* Tools */}
      <Section label="Tools">
        <NavBtn to="/labeling" icon={<IoBarcodeOutline size={24} />} className="bg-amber-50 text-amber-800 hover:bg-amber-100">
          Labeling
        </NavBtn>
        <NavBtn to="/manager/hotkey" icon={<IoGridOutline size={24} />} className="bg-amber-50 text-amber-800 hover:bg-amber-100">
          Hotkey Manager
        </NavBtn>
      </Section>

      {/* Settings */}
      <Section label="Settings">
        <NavBtn to="/manager/settings" icon={<IoSettingsOutline size={24} />} className="bg-gray-100 text-gray-700 hover:bg-gray-200">
          Interface Settings
        </NavBtn>
        <NavBtn to="/manager/user" icon={<IoPeopleOutline size={24} />} className="bg-gray-100 text-gray-700 hover:bg-gray-200">
          User Management
        </NavBtn>
        <NavBtn to="/manager/store" icon={<IoStorefrontOutline size={24} />} className="bg-gray-100 text-gray-700 hover:bg-gray-200">
          Store Settings
        </NavBtn>
        <NavBtn to="/server-setup" icon={<IoServerOutline size={24} />} className="bg-gray-100 text-gray-700 hover:bg-gray-200">
          Server Setup
        </NavBtn>
        <NavBtn to="/manager/test" icon={<IoFlaskOutline size={24} />} className="bg-gray-100 text-gray-700 hover:bg-gray-200">
          Test
        </NavBtn>
      </Section>
    </div>
  );
}

function Section({
  label,
  children,
}: {
  label: string;
  children: ReactNode;
}) {
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
