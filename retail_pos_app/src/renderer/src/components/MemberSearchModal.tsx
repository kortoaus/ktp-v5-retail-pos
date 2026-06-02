import { useCallback, useEffect, useState } from "react";
import {
  MemberSearchResult,
  requestMemberSignupOtp,
  searchMembersByKeyword,
  stageMemberSignup,
  verifyMemberSignup,
} from "../service/crm.service";
import OnScreenKeyboard from "./OnScreenKeyboard";
import { cn } from "../libs/cn";
import { sanitizePhone } from "../libs/phone-utils";

type Tab = "search" | "create";
type CreateStep = "form" | "otp";
const SEARCH_PAGE_SIZE = 5;

export interface MemberSearchSelection {
  id: string;
  name: string;
  level: number;
  points: number;
  phone_last4: string | null;
}

interface MemberSearchModalProps {
  open: boolean;
  onClose: () => void;
  onSelect: (member: MemberSearchSelection) => void;
}

export default function MemberSearchModal({
  open,
  onClose,
  onSelect,
}: MemberSearchModalProps) {
  const [tab, setTab] = useState<Tab>("search");

  const [searchKeyword, setSearchKeyword] = useState("");
  const [searchResults, setSearchResults] = useState<MemberSearchResult[]>([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const [searchError, setSearchError] = useState("");
  const [searched, setSearched] = useState(false);

  const [createPhone, setCreatePhone] = useState("");
  const [createName, setCreateName] = useState("");
  const [createOtp, setCreateOtp] = useState("");
  const [createStep, setCreateStep] = useState<CreateStep>("form");
  const [createLoading, setCreateLoading] = useState(false);
  const [createError, setCreateError] = useState("");
  const [nameFieldFocused, setNameFieldFocused] = useState(false);

  useEffect(() => {
    if (!open) return;
    setTab("search");
    setSearchKeyword("");
    setSearchResults([]);
    setSearchLoading(false);
    setSearchError("");
    setSearched(false);
    setCreatePhone("");
    setCreateName("");
    setCreateOtp("");
    setCreateStep("form");
    setCreateLoading(false);
    setCreateError("");
    setNameFieldFocused(false);
  }, [open]);

  const handleSearch = useCallback(async () => {
    const keyword = searchKeyword.trim().replace(/\s+/g, " ");
    setSearchKeyword(keyword);
    if (!keyword) {
      setSearchResults([]);
      setSearchError("Enter member name or phone digits");
      setSearched(true);
      return;
    }

    setSearchLoading(true);
    setSearchError("");
    setSearchResults([]);
    setSearched(true);
    try {
      const res = await searchMembersByKeyword(keyword);
      if (res.ok && Array.isArray(res.result) && res.result.length > 0) {
        setSearchResults(res.result);
      } else if (res.ok && Array.isArray(res.result)) {
        setSearchResults([]);
        setSearchError("Member not found");
      } else {
        setSearchError(res.msg || "Member not found");
      }
    } catch {
      setSearchError("Network error");
    } finally {
      setSearchLoading(false);
    }
  }, [searchKeyword]);

  const handleSelectSearchResult = useCallback(
    (member: MemberSearchResult) => {
      onSelect({
        id: member.id,
        name: member.name,
        level: member.level,
        points: member.points,
        phone_last4: member.phoneLast3,
      });
    },
    [onSelect],
  );

  const handleStartSignup = useCallback(async () => {
    const phone = sanitizePhone(createPhone);
    const name = createName.trim();
    if (!name) return;
    if (!phone) {
      setCreateError("Enter a valid phone number");
      return;
    }

    setCreateLoading(true);
    setCreateError("");
    try {
      const stageRes = await stageMemberSignup({ phone, name });
      if (!stageRes.ok) {
        setCreateError(stageRes.msg || "Failed to start member signup");
        return;
      }

      const otpRes = await requestMemberSignupOtp(phone);
      if (otpRes.ok) {
        setCreateStep("otp");
        setCreateOtp("");
        setNameFieldFocused(false);
      } else {
        setCreateError(otpRes.msg || "Failed to send verification code");
      }
    } catch {
      setCreateError("Network error");
    } finally {
      setCreateLoading(false);
    }
  }, [createPhone, createName]);

  const handleVerifySignup = useCallback(async () => {
    const phone = sanitizePhone(createPhone);
    const code = createOtp.trim();
    if (!phone || !code) return;

    setCreateLoading(true);
    setCreateError("");
    try {
      const res = await verifyMemberSignup({ phone, code });
      if (res.ok && res.result) {
        onSelect({
          id: res.result.id,
          name: res.result.name,
          level: res.result.level,
          points: res.result.points,
          phone_last4: res.result.phone_last4,
        });
      } else {
        setCreateError(res.msg || "Failed to verify member signup");
      }
    } catch {
      setCreateError("Network error");
    } finally {
      setCreateLoading(false);
    }
  }, [createPhone, createOtp, onSelect]);

  const handleClose = useCallback(() => {
    onClose();
  }, [onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 bg-black/50 flex items-center justify-center p-4"
      style={{ zIndex: 999 }}
    >
      <div
        className={cn(
          "bg-white rounded-2xl w-full flex flex-col overflow-hidden shadow-2xl",
          tab === "search" ? "max-w-[1120px]" : "max-w-lg",
        )}
      >
        <div className="flex items-center justify-between px-4 py-2 border-b border-gray-200">
          <h2 className="text-lg font-bold">Customer Search</h2>
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
              keyword={searchKeyword}
              setKeyword={setSearchKeyword}
              loading={searchLoading}
              error={searchError}
              searched={searched}
              searchResults={searchResults}
              onSearch={handleSearch}
              onSelect={handleSelectSearchResult}
            />
          ) : (
            <CreateTab
              phone={createPhone}
              setPhone={setCreatePhone}
              name={createName}
              setName={setCreateName}
              otp={createOtp}
              setOtp={setCreateOtp}
              step={createStep}
              loading={createLoading}
              error={createError}
              nameFieldFocused={nameFieldFocused}
              setNameFieldFocused={setNameFieldFocused}
              onBackToForm={() => {
                setCreateStep("form");
                setCreateOtp("");
                setCreateError("");
              }}
              onStartSignup={handleStartSignup}
              onVerifySignup={handleVerifySignup}
            />
          )}
        </div>

        {tab === "create" && (
          <div className="border-t border-gray-200 p-2">
            {createStep === "otp" ? (
              <OnScreenKeyboard
                key="create-otp"
                value={createOtp}
                onChange={(v) => setCreateOtp(v.replace(/[^0-9]/g, ""))}
                onEnter={handleVerifySignup}
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
                onEnter={handleStartSignup}
                initialLayout="numpad"
              />
            )}
          </div>
        )}
      </div>
    </div>
  );
}

interface SearchTabProps {
  keyword: string;
  setKeyword: (v: string) => void;
  loading: boolean;
  error: string;
  searched: boolean;
  searchResults: MemberSearchResult[];
  onSearch: () => void;
  onSelect: (member: MemberSearchResult) => void;
}

function SearchTab({
  keyword,
  setKeyword,
  loading,
  error,
  searched,
  searchResults,
  onSearch,
  onSelect,
}: SearchTabProps) {
  const [page, setPage] = useState(0);
  const totalPages = Math.max(
    1,
    Math.ceil(searchResults.length / SEARCH_PAGE_SIZE),
  );
  const currentPage = Math.min(page, totalPages - 1);
  const pageResults = searchResults.slice(
    currentPage * SEARCH_PAGE_SIZE,
    currentPage * SEARCH_PAGE_SIZE + SEARCH_PAGE_SIZE,
  );

  useEffect(() => {
    setPage(0);
  }, [searchResults]);

  return (
    <div className="grid grid-cols-[360px_minmax(560px,1fr)] gap-4 p-4">
      <div className="min-w-0 space-y-3">
        <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 h-12">
          <span className="text-gray-400 text-lg">🔎</span>
          <div className="flex-1 text-lg min-h-[28px] truncate">
            {keyword || (
              <span className="text-gray-400">Name or phone digits</span>
            )}
          </div>
          {keyword && (
            <button
              type="button"
              onPointerDown={() => setKeyword("")}
              className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 active:bg-gray-300 text-sm"
            >
              ✕
            </button>
          )}
        </div>

        <button
          type="button"
          onPointerDown={onSearch}
          disabled={!keyword.trim() || loading}
          className="w-full h-12 rounded-lg bg-blue-600 text-white font-semibold active:bg-blue-700 disabled:opacity-40 text-sm"
        >
          {loading ? "Searching..." : "Search"}
        </button>

        <div className="h-[360px] flex items-center justify-center">
          {!searched && (
            <span className="text-gray-400 text-sm">
              Enter customer name or phone digits
            </span>
          )}
          {searched && loading && (
            <span className="text-gray-400 text-sm">Searching...</span>
          )}
          {searched && !loading && error && searchResults.length === 0 && (
            <span className="text-red-500 text-sm">{error}</span>
          )}
          {searchResults.length > 0 && (
            <div className="w-full h-full overflow-y-auto space-y-2 pr-1">
              {pageResults.map((member) => (
                <button
                  key={member.id}
                  type="button"
                  onPointerDown={() => onSelect(member)}
                  className="w-full bg-gray-50 rounded-xl p-4 flex items-center gap-4 text-left active:bg-blue-50"
                >
                  <div className="w-12 h-12 rounded-full bg-blue-100 text-blue-600 flex items-center justify-center text-lg font-bold shrink-0">
                    {member.name.charAt(0)}
                  </div>
                  <div className="flex-1 min-w-0">
                    <div className="font-bold text-base truncate">
                      {member.name}
                    </div>
                    <div className="text-sm text-gray-500">
                      ***{member.phoneLast3 ?? ""}
                    </div>
                  </div>
                  <div className="text-right shrink-0">
                    <div className="text-xs text-gray-400">Level</div>
                    <div className="font-bold text-sm">{member.level}</div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="h-10 flex items-center justify-between gap-2">
          <button
            type="button"
            onPointerDown={() => setPage((p) => Math.max(0, p - 1))}
            disabled={currentPage === 0 || searchResults.length === 0}
            className="h-9 px-4 rounded-lg bg-gray-100 active:bg-gray-300 disabled:opacity-30 text-sm"
          >
            Prev
          </button>
          <span className="text-sm text-gray-500">
            {currentPage + 1} / {totalPages}
          </span>
          <button
            type="button"
            onPointerDown={() =>
              setPage((p) => Math.min(totalPages - 1, p + 1))
            }
            disabled={
              currentPage >= totalPages - 1 || searchResults.length === 0
            }
            className="h-9 px-4 rounded-lg bg-gray-100 active:bg-gray-300 disabled:opacity-30 text-sm"
          >
            Next
          </button>
        </div>
      </div>

      <div className="border-l border-gray-200 pl-4 flex items-start">
        <OnScreenKeyboard
          key="search-keyword"
          value={keyword}
          onChange={setKeyword}
          onEnter={onSearch}
          initialLayout="korean"
          className="shrink-0"
        />
      </div>
    </div>
  );
}

interface CreateTabProps {
  phone: string;
  setPhone: (v: string) => void;
  name: string;
  setName: (v: string) => void;
  otp: string;
  setOtp: (v: string) => void;
  step: CreateStep;
  loading: boolean;
  error: string;
  nameFieldFocused: boolean;
  setNameFieldFocused: (v: boolean) => void;
  onBackToForm: () => void;
  onStartSignup: () => void;
  onVerifySignup: () => void;
}

function CreateTab({
  phone,
  setPhone,
  name,
  setName,
  otp,
  setOtp,
  step,
  loading,
  error,
  nameFieldFocused,
  setNameFieldFocused,
  onBackToForm,
  onStartSignup,
  onVerifySignup,
}: CreateTabProps) {
  return (
    <div className="px-4 py-3 space-y-3">
      {step === "form" ? (
        <>
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
        </>
      ) : (
        <>
          <div className="text-sm text-gray-500 text-center">
            Enter the SMS code from the customer
          </div>
          <div className="flex items-center gap-2 bg-gray-100 rounded-lg px-3 h-12 ring-2 ring-blue-400">
            <span className="text-gray-400 text-lg">#</span>
            <div className="flex-1 text-lg min-h-[28px]">
              {otp || <span className="text-gray-400">OTP code</span>}
            </div>
            {otp && (
              <button
                type="button"
                onPointerDown={() => setOtp("")}
                className="w-8 h-8 flex items-center justify-center rounded-full text-gray-400 active:bg-gray-300 text-sm"
              >
                ✕
              </button>
            )}
          </div>
        </>
      )}

      {error && <div className="text-red-500 text-sm text-center">{error}</div>}

      {step === "form" ? (
        <button
          type="button"
          onPointerDown={onStartSignup}
          disabled={!phone.trim() || !name.trim() || loading}
          className="w-full h-12 rounded-lg bg-blue-600 text-white font-semibold active:bg-blue-700 disabled:opacity-40 text-sm"
        >
          {loading ? "Sending..." : "Send OTP"}
        </button>
      ) : (
        <div className="grid grid-cols-[120px_1fr] gap-2">
          <button
            type="button"
            onPointerDown={onBackToForm}
            disabled={loading}
            className="h-12 rounded-lg bg-gray-100 text-gray-700 font-semibold active:bg-gray-200 disabled:opacity-40 text-sm"
          >
            Back
          </button>
          <button
            type="button"
            onPointerDown={onVerifySignup}
            disabled={!otp.trim() || loading}
            className="h-12 rounded-lg bg-blue-600 text-white font-semibold active:bg-blue-700 disabled:opacity-40 text-sm"
          >
            {loading ? "Verifying..." : "Complete Signup"}
          </button>
        </div>
      )}
    </div>
  );
}
