import { upsertUser } from "../../service/user.service";
import { SCOPES, User } from "../../types/models";
import { useState } from "react";
import OnScreenKeyboard from "../OnScreenKeyboard";
import { cn } from "../../libs/cn";

interface UserFormProps {
  origin: User | null;
  onSave: () => void;
  onCancel: () => void;
}

type ActiveField = "name" | "code";

export default function UserForm({ origin, onSave, onCancel }: UserFormProps) {
  const isEdit = origin !== null;

  const [loading, setLoading] = useState(false);
  const [name, setName] = useState(origin?.name || "");
  const [code, setCode] = useState(origin?.code || "");
  const [scope, setScope] = useState<string[]>(origin?.scope || []);
  const [archived, setArchived] = useState(origin?.archived || false);
  const [activeField, setActiveField] = useState<ActiveField>("name");

  const toggleScope = (s: string) => {
    setScope((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s],
    );
  };

  const handleKeyboardChange = (newValue: string) => {
    if (activeField === "code") {
      if (/^[0-9]*$/.test(newValue)) {
        setCode(newValue);
      }
    } else {
      setName(newValue);
    }
  };

  const keyboardValue = activeField === "code" ? code : name;

  const onSubmit = async () => {
    if (!name.trim()) {
      window.alert("Name is required");
      return;
    }
    if (!code.trim()) {
      window.alert("Code is required");
      return;
    }

    setLoading(true);
    try {
      const payload = {
        id: origin?.id,
        name: name.trim(),
        code: code.trim(),
        scope,
        archived,
      };

      const { ok, msg } = await upsertUser(payload);
      if (ok) {
        onSave();
      } else {
        window.alert(msg || "Failed to save user");
      }
    } catch (err) {
      console.error(err);
      window.alert("Failed to save user");
    } finally {
      setLoading(false);
    }
  };

  const inputClass = (field: ActiveField) =>
    cn(
      "w-full rounded-lg border px-3 py-2 text-sm outline-none disabled:opacity-50 disabled:bg-gray-100",
      activeField === field
        ? "border-blue-500 ring-1 ring-blue-500"
        : "border-gray-300",
    );

  return (
    <div className="h-full flex flex-col p-4 gap-4">
      <div className="flex flex-col gap-4">
        <div className="flex items-center justify-between">
          <h2 className="text-xl font-bold">
            {isEdit ? "Edit User" : "Create User"}
          </h2>
          <div className="flex gap-3 justify-end">
            <button
              type="button"
              onClick={onCancel}
              disabled={loading}
              className="rounded-lg bg-gray-100 px-4 py-2 text-sm font-medium text-gray-700 hover:bg-gray-200 disabled:opacity-50 transition-colors"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={onSubmit}
              disabled={loading}
              className="rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
            >
              {loading ? "Saving..." : isEdit ? "Update" : "Create"}
            </button>
          </div>
        </div>

        <div className="flex gap-4">
          <div className="flex-1 flex flex-col gap-2">
            <label className="text-sm font-medium">Name</label>
            <input
              type="text"
              placeholder="Enter name"
              readOnly
              value={name}
              onPointerDown={() => setActiveField("name")}
              disabled={loading}
              className={inputClass("name")}
            />
          </div>

          <div className="flex-1 flex flex-col gap-2">
            <label className="text-sm font-medium">Code</label>
            <input
              type="text"
              placeholder="Enter code"
              readOnly
              value={code}
              onPointerDown={() => setActiveField("code")}
              disabled={loading}
              className={inputClass("code")}
            />
          </div>
        </div>

        <div className="flex items-center gap-6">
          <div className="flex flex-col gap-2">
            <label className="text-sm font-medium">Scope</label>
            <div className="flex gap-4">
              {SCOPES.map((s) => (
                <label key={s} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    checked={scope.includes(s)}
                    onChange={() => toggleScope(s)}
                    disabled={loading}
                    className="h-4 w-4 rounded border-gray-300 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                  />
                  {s}
                </label>
              ))}
            </div>
          </div>

          {isEdit && (
            <label className="flex items-center gap-2 text-sm font-medium">
              <button
                type="button"
                role="switch"
                aria-checked={archived}
                onClick={() => !loading && setArchived(!archived)}
                disabled={loading}
                className={`relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors disabled:opacity-50 disabled:cursor-not-allowed ${
                  archived ? "bg-blue-600" : "bg-gray-300"
                }`}
              >
                <span
                  className={`inline-block h-4 w-4 rounded-full bg-white shadow-sm transition-transform ${
                    archived ? "translate-x-4" : "translate-x-0.5"
                  }`}
                />
              </button>
              Archived
            </label>
          )}
        </div>
      </div>

      <div className="min-h-0 flex flex-col">
        <div className={cn(activeField === "code" ? "flex-1" : "hidden")}>
          <OnScreenKeyboard
            value={keyboardValue}
            onChange={handleKeyboardChange}
            initialLayout="numpad"
            className="flex-1"
          />
        </div>
        <div className={cn(activeField === "name" ? "flex-1" : "hidden")}>
          <OnScreenKeyboard
            value={keyboardValue}
            onChange={handleKeyboardChange}
            initialLayout="korean"
            className="flex-1"
          />
        </div>
      </div>
    </div>
  );
}
