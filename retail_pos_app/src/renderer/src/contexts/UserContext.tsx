import { User } from "../types/models";
import apiService from "../libs/api";
import { getMe, getUserByCode } from "../service/user.service";
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useEffect,
  ReactNode,
} from "react";

interface UserContextValue {
  user: User | null;
  isLoggedIn: boolean;
  loading: boolean;
  checking: boolean;
  error: string | null;
  login: (code: string) => Promise<User | null>;
  logout: () => void;
}

const UserContext = createContext<UserContextValue | null>(null);

interface UserProviderProps {
  children: ReactNode;
}

export function UserProvider({ children }: UserProviderProps) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(false);
  const [checking, setChecking] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const checkAuth = async () => {
      try {
        const response = await getMe();
        if (response.ok && response.result) {
          setUser(response.result);
        }
      } catch {
      } finally {
        setChecking(false);
      }
    };

    checkAuth();
  }, []);

  // A 401 staff-session rejection on any request (e.g. the staff was archived
  // while the till stayed open) drops the user → AuthGateway shows the code
  // login again.
  useEffect(() => {
    return apiService.onSessionLost(() => {
      setUser(null);
    });
  }, []);

  const login = useCallback(async (code: string): Promise<User | null> => {
    setLoading(true);
    setError(null);
    try {
      const response = await getUserByCode(code);
      if (response.ok && response.result) {
        setUser(response.result);
        return response.result ?? null;
      } else {
        setError(response.msg || "Invalid code");
        return null;
      }
    } catch {
      setError("Login failed");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  const logout = useCallback(() => {
    setUser(null);
    setError(null);
    apiService.logout();
  }, []);

  const value: UserContextValue = {
    user,
    isLoggedIn: user !== null,
    loading,
    checking,
    error,
    login,
    logout,
  };

  return <UserContext.Provider value={value}>{children}</UserContext.Provider>;
}

export function useUser(): UserContextValue {
  const context = useContext(UserContext);
  if (!context) {
    throw new Error("useUser must be used within a UserProvider");
  }
  return context;
}
