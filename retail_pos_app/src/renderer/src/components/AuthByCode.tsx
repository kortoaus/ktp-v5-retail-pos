import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useUser } from "../contexts/UserContext";
import Numpad from "./Numpads/Numpad";
import { User } from "../types/models";

interface AuthByCodeProps {
  onSuccess?: (user: User) => void;
}

export default function AuthByCode({ onSuccess }: AuthByCodeProps) {
  const navigate = useNavigate();
  const { login, loading, error } = useUser();
  const [code, setCode] = useState("");

  const handleSubmit = async () => {
    if (!code) return;

    const success = await login(code);
    if (success) {
      setCode("");
      onSuccess?.(success);
    }
  };

  return (
    <div className="h-full flex items-center justify-center p-4">
      <div className="w-full max-w-xs flex flex-col gap-4">
        <h2 className="text-xl font-bold text-center text-gray-900">
          Enter Code
        </h2>

        <Numpad val={code} setVal={setCode} useDot={false} />

        {error && (
          <p className="text-base font-bold text-center text-red-600">
            {error}
          </p>
        )}

        <button
          disabled={!code || loading}
          onClick={handleSubmit}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400 text-white font-medium text-base px-4 py-3 rounded-lg transition-colors"
        >
          {loading ? "Logging in..." : "Login"}
        </button>

        <button
          disabled={loading}
          onClick={() => navigate("/")}
          className="w-full bg-red-600 hover:bg-red-700 disabled:bg-red-400 text-white font-medium text-base px-4 py-3 rounded-lg transition-colors"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
