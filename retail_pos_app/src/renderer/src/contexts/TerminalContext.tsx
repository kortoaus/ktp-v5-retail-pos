import {
  createContext,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";
import { apiService } from "../libs/api";
import { Company } from "../types/models";

export interface Terminal {
  id: number;
  name: string;
  ipAddress: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
}

interface TerminalContextValue {
  terminal: Terminal | null;
  company: Company | null;
  loading: boolean;
  error: string | null;
  serverConfigured: boolean;
  refetch: () => Promise<void>;
}

const TerminalContext = createContext<TerminalContextValue | null>(null);

export function TerminalProvider({ children }: { children: ReactNode }) {
  const [terminal, setTerminal] = useState<Terminal | null>(null);
  const [company, setCompany] = useState<Company | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [serverConfigured, setServerConfigured] = useState(false);

  const fetchTerminal = async () => {
    setLoading(true);
    setError(null);

    const config = await window.electronAPI.getConfig();

    if (!config.server) {
      setServerConfigured(false);
      setLoading(false);
      return;
    }

    setServerConfigured(true);
    apiService.setBaseURL(`http://${config.server.host}:${config.server.port}`);

    const ip = await window.electronAPI.getNetworkIp();
    if (ip) {
      apiService.setHeader("ip-address", ip);
    }

    const res = await apiService.get<{
      terminal: Terminal;
      company: Company;
    }>("/api/terminal/me");

    if (res.ok && res.result) {
      setTerminal(res.result.terminal);
      setCompany(res.result.company);
    } else {
      setError(res.msg);
    }

    setLoading(false);
  };

  useEffect(() => {
    fetchTerminal();
  }, []);

  return (
    <TerminalContext.Provider
      value={{
        terminal,
        company,
        loading,
        error,
        serverConfigured,
        refetch: fetchTerminal,
      }}
    >
      {children}
    </TerminalContext.Provider>
  );
}

export function useTerminal(): TerminalContextValue {
  const ctx = useContext(TerminalContext);
  if (!ctx) {
    throw new Error("useTerminal must be used within TerminalProvider");
  }
  return ctx;
}
