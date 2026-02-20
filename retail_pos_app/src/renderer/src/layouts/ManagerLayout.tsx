import { Outlet } from "react-router-dom";
import { UserProvider } from "../contexts/UserContext";
import AuthGateway from "../components/AuthGateway";

export default function ManagerLayout() {
  return (
    <UserProvider>
      <AuthGateway>
        <Outlet />
      </AuthGateway>
    </UserProvider>
  );
}
