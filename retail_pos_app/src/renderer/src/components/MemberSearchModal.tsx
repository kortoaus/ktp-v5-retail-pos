import { useCallback, useEffect, useState } from "react";
import { Member } from "../types/models";
import { searchMember, createMember } from "../service/crm.service";
import OnScreenKeyboard from "./OnScreenKeyboard";
import { cn } from "../libs/cn";
import { sanitizePhone } from "../libs/phone-utils";

type Tab = "search" | "create";

interface MemberSearchModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (member: Member) => void;
}

export default function MemberSearchModal({
  open,
  onClose,
  onSelect,
}: MemberSearchModalProps) {
  const [tab, setTab] = useState<Tab>("search");

  const [searchPhone, setSearchPhone] = useState("");
  const [foundMember, setFoundMember] = useState<Member | null>(null);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searched, setSearched] = useState(false);

  const [createPhone, setCreatePhone] = useState("");
  const [createName, setCreateName] = useState("");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState("");
  const [nameFieldFocused, setNameFieldFocused] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab("search");
    setSearchPhone("");
    setFoundMember(null);
    setSearchLoading(false);
    setSearchError("");
    setSearched(false);
    setCreatePhone("");
    setCreateName("");
    setCreateLoading(false);
    setCreateError("");
    setNameFieldFocused(false);
  }, [open]);

  const handleSearch = useCallback(async () => {
    const phone = sanitizePhone(searchPhone);
    if (!phone) {
      setSearchError("Invalid Australian mobile number");
      setSearched(true);
      return;
    }

    setSearchLoading(true);
    setSearchError("");
    setFoundMember(null);
    setSearched(true);
    try {
      const res = await searchMember(phone);
      if (res.ok && res.result) {
        setFoundMember(res.result);
      } else {
        setSearchError(res.msg || "Member not found");
      }
    } catch {
      setSearchError("Network error");
    } finally {
      setSearchLoading(false);
    }
  }, [searchPhone]);

  const handleConfirm = useCallback(() => {
    if (!foundMember) return;
    onSelect(foundMember);
  }, [foundMember, onSelect]);

  const handleCreate = useCallback(async () => {
    const phone = sanitizePhone(createPhone);
    const name = createName.trim();
    if (!name) return;
    if (!phone) {
      setCreateError("Invalid Australian mobile number");
      return;
    }

    setCreateLoading(true);
    setCreateError("");
    try {
      const res = await createMember({ phone, name });
      if (res.ok && res.result) {
        onSelect(res.result);
      } else {
        setCreateError(res.msg || "Failed to create member");
      }
    } catch {
      setCreateError("Network error");
    } finally {
      setCreateLoading(false);
    }
  }, [createPhone, createName, onSelect]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: 999 }}
    >
      <div className="bg-white rounded-2xl w-full max-w-lg flex flex-col overflow-hidden shadow-2xl">
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
          <h2 className="text-lg font-bold">Member</h2>
          <button
            type="button"
            onPointerDown={handleClose}
            className="w-10 h-10 flex items-center justify-center rounded-lg text-gray-500 active:bg-gray-200 text-xl"
          >
            ✕
          </button>
        </div>

        <div className="flex border-b border-gray-200">
          {(["search", "create"] as const).map((t) => (
            <button
              key={t}
              type="button"
              onPointerDown={() => {
                setTab(t);
                if (t === "create") {
                  setNameFieldFocused(true);
                } else {
                  setNameFieldFocused(false);
                }
              }}
              className={cn(
                "flex-1 py-3 text-sm font-semibold transition-colors",
                tab === t
                  ? "text-blue-600 border-b-2 border-blue-600"
                  : "text-gray-400 active:bg-gray-50",
              )}
            >
              {t === "search" ? "Search" : "New Member"}
            </button>
          ))}
        </div>

        <div className="flex-1">
          {tab === "search" ? (
            <SearchTab
              phone={searchPhone}
              setPhone={setSearchPhone}
              loading={searchLoading}
              error={searchError}
              searched={searched}
              foundMember={foundMember}
              onSearch={handleSearch}
              onConfirm={handleConfirm}
            />
          ) : (
            <CreateTab
              phone={createPhone}
              setPhone={setCreatePhone}
              name={createName}
              setName={setCreateName}
              loading={createLoading}
              error={createError}
              nameFieldFocused={nameFieldFocused}
              setNameFieldFocused={setNameFieldFocused}
              onCreate={handleCreate}
            />
          )}
        </div>

        <div className="border-t border-gray-200 p-2">
          {tab === "search" ? (
            <OnScreenKeyboard
              key="search-phone"
              value={searchPhone}
              onChange={(v) => setSearchPhone(v.replace(/[^0-9]/g, ""))}
              onEnter={handleSearch}
              initialLayout="numpad"
            />
          ) : nameFieldFocused ? (
            <OnScreenKeyboard
              key="create-name"
              value={createName}
              onChange={setCreateName}
              onEnter={() => setNameFieldFocused(false)}
              initialLayout="korean"
            />
          ) : (
            <OnScreenKeyboard
              key="create-phone"
              value={createPhone}
              onChange={(v) => setCreatePhone(v.replace(/[^0-9]/g, ""))}
              onEnter={handleCreate}
              initialLayout="numpad"
            />
          )}
        </div>
      </div>
    </div>
  );
}

interface SearchTabProps {
  phone: string;
  setPhone: (v: string) => void;
  loading: boolean;
  error: string;
  searched: boolean;
  foundMember: Member | null;
  onSearch: () => void;
  onConfirm: () => void;
}

function SearchTab({
  phone,
  setPhone,
  loading,
  error,
  searched,
  foundMember,
  onSearch,
  onConfirm,
}: SearchTabProps) {
  return (
    <div className="px-4 py-3 space-y-3">
      <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 h-12">
        <span className="text-gray-400 text-lg">📱</span>
        <div className="flex-1 text-lg min-h-[28px]">
          {phone || <span className="text-gray-400">Phone number</span>}
        </div>
        {phone && (
          <button
            type="button"
            onPointerDown={() => setPhone("")}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 active:bg-gray-300 text-sm"
          >
            ✕
          </button>
        )}
      </div>

      <button
        type="button"
        onPointerDown={onSearch}
        disabled={!phone.trim() || loading}
        className="w-full h-12 rounded-lg bg-blue-600 text-white font-semibold active:bg-blue-700 disabled:opacity-40 text-sm"
      >
        {loading ? "Searching..." : "Search"}
      </button>

      <div className="min-h-[100px] flex items-center justify-center">
        {!searched && (
          <span className="text-gray-400 text-sm">
            Enter phone number to search
          </span>
        )}
        {searched && loading && (
          <span className="text-gray-400 text-sm">Searching...</span>
        )}
        {searched && !loading && error && !foundMember && (
          <span className="text-red-500 text-sm">{error}</span>
        )}
        {foundMember && (
          <div className="w-full space-y-3">
            <div className="bg-gray-50 rounded-xl p-4 flex items-center gap-4">
              <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-lg font-bold">
                {foundMember.name.charAt(0)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="font-bold text-base truncate">
                  {foundMember.name}
                </div>
                <div className="text-sm text-gray-500">
                  ****{foundMember.phone_last4}
                </div>
              </div>
              <div className="text-right shrink-0">
                <div className="text-xs text-gray-400">Level</div>
                <div className="font-bold text-sm">{foundMember.level}</div>
              </div>
            </div>
            <button
              type="button"
              onPointerDown={onConfirm}
              className="w-full h-12 rounded-lg bg-green-600 text-white font-semibold active:bg-green-700 text-sm"
            >
              Confirm
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

interface CreateTabProps {
  phone: string;
  setPhone: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  loading: boolean;
  error: string;
  nameFieldFocused: boolean;
  setNameFieldFocused: (v: boolean) => void;
  onCreate: () => void;
}

function CreateTab({
  phone,
  setPhone,
  name,
  setName,
  loading,
  error,
  nameFieldFocused,
  setNameFieldFocused,
  onCreate,
}: CreateTabProps) {
  return (
    <div className="px-4 py-3 space-y-3">
      <div
        onPointerDown={() => setNameFieldFocused(true)}
        className={cn(
          "flex items-center gap-2 bg-gray-100 rounded-lg px-3 h-12 cursor-pointer",
          nameFieldFocused && "ring-2 ring-blue-400",
        )}
      >
        <span className="text-gray-400 text-lg">👤</span>
        <div className="flex-1 text-lg min-h-[28px]">
          {name || <span className="text-gray-400">Name</span>}
        </div>
        {name && (
          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              setName("");
            }}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 active:bg-gray-300 text-sm"
          >
            ✕
          </button>
        )}
      </div>

      <div
        onPointerDown={() => setNameFieldFocused(false)}
        className={cn(
          "flex items-center gap-2 bg-gray-100 rounded-lg px-3 h-12 cursor-pointer",
          !nameFieldFocused && "ring-2 ring-blue-400",
        )}
      >
        <span className="text-gray-400 text-lg">📱</span>
        <div className="flex-1 text-lg min-h-[28px]">
          {phone || <span className="text-gray-400">Phone number</span>}
        </div>
        {phone && (
          <button
            type="button"
            onPointerDown={(e) => {
              e.stopPropagation();
              setPhone("");
            }}
            className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 active:bg-gray-300 text-sm"
          >
            ✕
          </button>
        )}
      </div>

      {error && <div className="text-red-500 text-sm text-center">{error}</div>}

      <button
        type="button"
        onPointerDown={onCreate}
        disabled={!phone.trim() || !name.trim() || loading}
        className="w-full h-12 rounded-lg bg-blue-600 text-white font-semibold active:bg-blue-700 disabled:opacity-40 text-sm"
      >
        {loading ? "Creating..." : "Create Member"}
      </button>
    </div>
  );
}
