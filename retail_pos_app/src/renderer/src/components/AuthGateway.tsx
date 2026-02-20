import { type ReactNode } from "react";
import { useUser } from "../contexts/UserContext";
import AuthByCode from "./AuthByCode";

export default function AuthGateway({ children }: { children: ReactNode }) {
  const { isLoggedIn, checking } = useUser();

  if (checking) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Loading...
      </div>
    );
  }

  if (!isLoggedIn) {
    return <AuthByCode onSuccess={() => {}} />;
  }

  return <>{children}</>;
}
