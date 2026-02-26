import { useCallback, useEffect, useState } from "react";
import {
  getStoreSetting,
  updateStoreSetting,
} from "../../service/store.service";
import { StoreSetting } from "../../types/models";
import OnScreenKeyboard from "../../components/OnScreenKeyboard";
import { cn } from "../../libs/cn";
import { Link } from "react-router-dom";
import { useUser } from "../../contexts/UserContext";
import BlockScreen from "../../components/BlockScreen";
import hasScope from "../../libs/scope-utils";

const FIELDS = [
  { key: "name", label: "Store Name", layout: "korean" as const },
  { key: "phone", label: "Phone", layout: "numpad" as const },
  { key: "address1", label: "Address 1", layout: "english" as const },
  { key: "address2", label: "Address 2", layout: "english" as const },
  { key: "suburb", label: "Suburb", layout: "english" as const },
  { key: "state", label: "State", layout: "english" as const },
  { key: "postcode", label: "Postcode", layout: "numpad" as const },
  { key: "country", label: "Country", layout: "english" as const },
  { key: "abn", label: "ABN", layout: "numpad" as const },
  { key: "website", label: "Website", layout: "english" as const },
  { key: "email", label: "Email", layout: "english" as const },
  {
    key: "credit_surcharge_rate",
    label: "Credit Surcharge (%)",
    layout: "numpad" as const,
  },
  {
    key: "receipt_below_text",
    label: "Receipt Footer",
    layout: "korean" as const,
  },
] as const;

type FieldKey = (typeof FIELDS)[number]["key"];

type FormState = Record<FieldKey, string>;

function settingToForm(s: StoreSetting): FormState {
  return {
    name: s.name ?? "",
    phone: s.phone ?? "",
    address1: s.address1 ?? "",
    address2: s.address2 ?? "",
    suburb: s.suburb ?? "",
    state: s.state ?? "",
    postcode: s.postcode ?? "",
    country: s.country ?? "",
    abn: s.abn ?? "",
    website: s.website ?? "",
    email: s.email ?? "",
    // Server stores decimal (0.015), display as percent (1.5)
    credit_surcharge_rate:
      s.credit_surcharge_rate != null
        ? String(+(s.credit_surcharge_rate * 100).toFixed(4))
        : "",
    receipt_below_text: s.receipt_below_text ?? "",
  };
}

function formToPayload(form: FormState) {
  const rate = parseFloat(form.credit_surcharge_rate);
  return {
    name: form.name,
    phone: form.phone || undefined,
    address1: form.address1,
    address2: form.address2 || undefined,
    suburb: form.suburb,
    state: form.state,
    postcode: form.postcode,
    country: form.country,
    abn: form.abn || undefined,
    website: form.website || undefined,
    email: form.email || undefined,
    // Convert percent back to decimal for server
    credit_surcharge_rate: isNaN(rate) ? undefined : rate / 100,
    receipt_below_text: form.receipt_below_text || undefined,
  };
}

export default function StoreSettingScreen() {
  const { user, loading: userLoading } = useUser();
  const [form, setForm] = useState<FormState | null>(null);
  const [activeField, setActiveField] = useState<FieldKey>("name");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const fetchSetting = useCallback(async () => {
    setLoading(true);
    try {
      const res = await getStoreSetting();
      if (res.ok && res.result) {
        setForm(settingToForm(res.result));
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchSetting();
  }, [fetchSetting]);

  const handleKeyboardChange = (newValue: string) => {
    if (!form) return;
    if (activeField === "credit_surcharge_rate") {
      if (/^[0-9]*\.?[0-9]{0,4}$/.test(newValue)) {
        setForm({ ...form, [activeField]: newValue });
      }
    } else if (
      activeField === "phone" ||
      activeField === "postcode" ||
      activeField === "abn"
    ) {
      if (/^[0-9 ]*$/.test(newValue)) {
        setForm({ ...form, [activeField]: newValue });
      }
    } else {
      setForm({ ...form, [activeField]: newValue });
    }
  };

  const onSubmit = async () => {
    if (!form) return;
    if (!form.name.trim()) {
      window.alert("Store name is required");
      return;
    }

    setSaving(true);
    try {
      const { ok, msg } = await updateStoreSetting(formToPayload(form));
      if (ok) {
        window.alert("Store settings saved");
      } else {
        window.alert(msg || "Failed to save settings");
      }
    } catch (err) {
      console.error(err);
      window.alert("Failed to save settings");
    } finally {
      setSaving(false);
    }
  };

  if (userLoading || loading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Loading...
      </div>
    );
  }

  if (!user || !hasScope(user.scope, ["store"])) {
    return (
      <BlockScreen
        label="You are not authorized to access this page"
        link="/"
      />
    );
  }

  if (!form) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Failed to load store settings
      </div>
    );
  }

  const activeFieldDef = FIELDS.find((f) => f.key === activeField)!;

  const inputClass = (field: FieldKey) =>
    cn(
      "w-full rounded-lg border px-3 py-2 text-sm outline-none",
      activeField === field
        ? "border-blue-500 ring-1 ring-blue-500"
        : "border-gray-300",
    );

  return (
    <div className="h-full flex flex-col">
      <div className="h-12 flex items-center justify-between px-4 border-b border-gray-200 shrink-0">
        <div className="flex items-center gap-3">
          <Link
            to="/"
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            &larr; Back
          </Link>
          <h2 className="text-lg font-bold">Store Settings</h2>
        </div>
        <button
          type="button"
          onClick={onSubmit}
          disabled={saving}
          className="rounded-lg bg-blue-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 transition-colors"
        >
          {saving ? "Saving..." : "Save"}
        </button>
      </div>

      <div className="flex-1 flex min-h-0">
        <div className="flex-1 grid grid-cols-2 gap-x-4 gap-y-2 p-4 content-start">
          {FIELDS.map((f) => (
            <div key={f.key} className="flex flex-col gap-0.5">
              <label className="text-xs font-medium text-gray-500">
                {f.label}
              </label>
              <input
                type="text"
                readOnly
                value={form[f.key]}
                onPointerDown={() => setActiveField(f.key)}
                className={inputClass(f.key)}
              />
            </div>
          ))}
        </div>

        <div className="w-[600px] flex flex-col border-l border-gray-200 p-3 shrink-0">
          <div className="mb-1 text-sm font-medium text-gray-500">
            {activeFieldDef.label}
          </div>
          <div className="flex-1 min-h-0">
            {FIELDS.map((f) => (
              <div
                key={f.key}
                className={cn(activeField === f.key ? "h-full" : "hidden")}
              >
                <OnScreenKeyboard
                  value={form[f.key]}
                  onChange={handleKeyboardChange}
                  initialLayout={f.layout}
                />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
