import { useEffect } from "react";
import { Link } from "react-router-dom";
import apiService from "../libs/api";
import { useShift } from "../contexts/ShiftContext";

export default function HomeScreen() {
  const { shift, loading: shiftLoading } = useShift();
  useEffect(() => {
    apiService.logout();
  }, []);

  const loading = shiftLoading;
  if (loading) return <div>loading...</div>;

  return (
    <div className="grid grid-cols-4 grid-rows-2 gap-4">
      {shift === null && (
        <>
          <Link to="/shift/open">
            <button className="w-full h-full bg-gray-100">Open Shift</button>
          </Link>
        </>
      )}

      {shift !== null && (
        <>
          <Link to="/sale">
            <button className="w-full h-full bg-gray-100">Sale</button>
          </Link>
        </>
      )}

      <Link to="/labeling">
        <button className="w-full h-full bg-gray-100">Labeling</button>
      </Link>
      <Link to="/manager/hotkey">
        <button className="w-full h-full bg-gray-100">Hotkey Manager</button>
      </Link>
      <Link to="/manager/test">
        <button className="w-full h-full bg-gray-100">Test</button>
      </Link>
      <Link to="/manager/settings">
        <button className="w-full h-full bg-gray-100">
          Interface Settings
        </button>
      </Link>
      <Link to="/manager/user">
        <button className="w-full h-full bg-gray-100">User Management</button>
      </Link>
      <Link to="/server-setup">
        <button className="w-full h-full bg-gray-100">Server Setup</button>
      </Link>
    </div>
  );
}
