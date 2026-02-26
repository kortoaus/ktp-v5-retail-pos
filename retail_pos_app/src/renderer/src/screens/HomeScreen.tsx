import { useEffect } from "react";
import { Link } from "react-router-dom";
import apiService from "../libs/api";
import { useShift } from "../contexts/ShiftContext";

const btn =
  "w-full h-full rounded-xl font-semibold text-base transition-colors active:scale-[0.98] flex items-center justify-center";

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
          <NavBtn to="/shift/open" className="bg-green-100 text-green-800 hover:bg-green-200">
            Open Shift
          </NavBtn>
        )}
        {shift !== null && (
          <>
            <NavBtn to="/shift/close" className="bg-red-100 text-red-800 hover:bg-red-200">
              Close Shift
            </NavBtn>
          </>
        )}
      </Section>

      {/* Sales */}
      <Section label="Sales">
        {shift !== null && (
          <>
            <NavBtn to="/sale" className="bg-blue-100 text-blue-800 hover:bg-blue-200">
              Sale
            </NavBtn>
            <NavBtn to="/manager/cashio" className="bg-blue-50 text-blue-700 hover:bg-blue-100">
              Cash In / Out
            </NavBtn>
          </>
        )}
        <NavBtn to="/manager/invoices" className="bg-blue-50 text-blue-700 hover:bg-blue-100">
          Invoice Search
        </NavBtn>
        <NavBtn to="/manager/refund" className="bg-blue-50 text-blue-700 hover:bg-blue-100">
          Refund
        </NavBtn>
      </Section>

      {/* Tools */}
      <Section label="Tools">
        <NavBtn to="/labeling" className="bg-amber-50 text-amber-800 hover:bg-amber-100">
          Labeling
        </NavBtn>
        <NavBtn to="/manager/hotkey" className="bg-amber-50 text-amber-800 hover:bg-amber-100">
          Hotkey Manager
        </NavBtn>
      </Section>

      {/* Settings */}
      <Section label="Settings">
        <NavBtn to="/manager/settings" className="bg-gray-100 text-gray-700 hover:bg-gray-200">
          Interface Settings
        </NavBtn>
        <NavBtn to="/manager/user" className="bg-gray-100 text-gray-700 hover:bg-gray-200">
          User Management
        </NavBtn>
        <NavBtn to="/manager/store" className="bg-gray-100 text-gray-700 hover:bg-gray-200">
          Store Settings
        </NavBtn>
        <NavBtn to="/server-setup" className="bg-gray-100 text-gray-700 hover:bg-gray-200">
          Server Setup
        </NavBtn>
        <NavBtn to="/manager/test" className="bg-gray-100 text-gray-700 hover:bg-gray-200">
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
  children: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-bold text-gray-400 uppercase tracking-wide">
        {label}
      </span>
      <div className="flex gap-3 h-14">{children}</div>
    </div>
  );
}

function NavBtn({
  to,
  className = "",
  children,
}: {
  to: string;
  className?: string;
  children: React.ReactNode;
}) {
  return (
    <Link to={to} className="flex-1 min-w-0">
      <button className={`${btn} ${className}`}>{children}</button>
    </Link>
  );
}
