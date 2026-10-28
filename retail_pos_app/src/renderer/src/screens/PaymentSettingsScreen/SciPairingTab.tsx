// SCI pairing for this lane (retail-eftpos T-7, certification UI rules).
// Errors are the lane API's text verbatim (invalid code, network, externally
// unpaired); the till never sees a key or secret. The operator picks the
// terminal for this lane (POST /pairings/:id/select) — a new pairing is not
// selected automatically. An unpaired row can be deleted from the list
// (DELETE /pairings/:id, confirm first; T-9).
import { useCallback, useEffect, useState } from "react";
import OnScreenKeyboard from "../../components/OnScreenKeyboard";
import SciLogo from "../../components/eft/SciLogo";
import { cn } from "../../libs/cn";
import { eftErrorText, pairingStateText } from "../../libs/eft/eft-flow";
import type { EftPairing, EftPairResult } from "../../libs/eft/eft-types";
import dayjsAU from "../../libs/dayjsAU";
import {
  deleteEftPairing,
  listEftPairings,
  pairEftTerminal,
  selectEftPairing,
  testEftPairing,
  unpairEftPairing,
} from "../../service/eft.service";

type Field = "code" | "nickname";
type Line = { tone: "ok" | "error"; text: string } | null;

const fmtAt = (iso: string | null) => (iso ? dayjsAU(iso).format("DD/MM/YYYY HH:mm:ss") : "—");

export default function SciPairingTab() {
  const [pairings, setPairings] = useState<EftPairing[] | null>(null);
  const [listError, setListError] = useState<string | null>(null);
  const [formOpen, setFormOpen] = useState(false);
  const [code, setCode] = useState("");
  const [nickname, setNickname] = useState("");
  const [field, setField] = useState<Field>("code");
  const [busy, setBusy] = useState(false);
  const [line, setLine] = useState<Line>(null);
  const [paired, setPaired] = useState<EftPairResult | null>(null);
  const [rowLine, setRowLine] = useState<Record<number, Line>>({});
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const res = await listEftPairings();
    if (res.ok && res.result) {
      setPairings(res.result);
      setListError(null);
    } else {
      setListError(eftErrorText(res));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  function openForm() {
    setFormOpen(true);
    setCode("");
    setNickname("");
    setField("code");
    setLine(null);
    setPaired(null);
  }

  function cancelForm() {
    setFormOpen(false);
    setCode("");
    setNickname("");
    setLine(null);
  }

  async function pair() {
    if (busy || !code.trim()) return;
    setBusy(true);
    setLine(null);
    try {
      const res = await pairEftTerminal({ pairingCode: code.trim(), ...(nickname.trim() ? { nickname: nickname.trim() } : {}) });
      if (res.ok && res.result) {
        setPaired(res.result);
        setFormOpen(false);
        setCode("");
        setNickname("");
        await load();
      } else {
        setLine({ tone: "error", text: eftErrorText(res) });
      }
    } finally {
      setBusy(false);
    }
  }

  async function rowAction(p: EftPairing, kind: "test" | "unpair" | "select" | "clear" | "delete") {
    if (busy) return;
    if (kind === "unpair" && !window.confirm(`Unpair ${p.nickname || p.pairingId}? The lane falls back to keyed card payments.`)) return;
    if (
      kind === "delete" &&
      !window.confirm(`Delete ${p.nickname || p.pairingId} from this list? Past card payments keep their records. To use this terminal again, pair it again.`)
    )
      return;
    setBusy(true);
    setNotice(null);
    setRowLine((m) => ({ ...m, [p.id]: null }));
    try {
      let next: Line = null;
      if (kind === "test") {
        const res = await testEftPairing(p.id);
        next = res.ok && res.result
          ? { tone: res.result.ok ? "ok" : "error", text: res.result.ok ? "Test OK — paired" : res.result.message }
          : { tone: "error", text: eftErrorText(res) };
      } else if (kind === "unpair") {
        const res = await unpairEftPairing(p.id);
        next = res.ok ? { tone: "ok", text: "Unpaired" } : { tone: "error", text: eftErrorText(res) };
        if (res.ok && paired?.id === p.id) setPaired(null);
      } else if (kind === "delete") {
        const res = await deleteEftPairing(p.id);
        if (res.ok) {
          if (paired?.id === p.id) setPaired(null);
          setNotice(`Deleted ${p.nickname || p.pairingId}`);
        } else {
          next = { tone: "error", text: eftErrorText(res) };
        }
      } else {
        const res = await selectEftPairing(kind === "select" ? p.id : null);
        next = res.ok
          ? { tone: "ok", text: kind === "select" ? "This lane uses this terminal" : "No terminal on this lane — keyed card payments" }
          : { tone: "error", text: eftErrorText(res) };
      }
      setRowLine((m) => ({ ...m, [p.id]: next }));
      await load();
    } finally {
      setBusy(false);
    }
  }

  const list = pairings ?? [];
  const activeCount = list.filter((p) => p.active).length;
  const laneHasOne = list.some((p) => p.selectedForThisTerminal && p.active);

  return (
    <div className="h-full flex min-h-0">
      <div className="flex-1 min-w-0 overflow-y-auto p-4 flex flex-col gap-4">
        <div className="flex items-center gap-3">
          <SciLogo className="h-10 text-lg" />
          <div>
            <div className="text-lg font-bold text-gray-900">Simple Cloud Integration</div>
            <div className="text-xs text-gray-500">Card terminal for this lane</div>
          </div>
          <div className="ml-auto flex gap-2">
            <button
              type="button"
              onClick={() => void load()}
              disabled={busy}
              className="h-10 px-4 rounded-md bg-gray-100 text-gray-700 text-sm font-semibold hover:bg-gray-200 disabled:opacity-50"
            >
              Refresh
            </button>
            {!formOpen && (
              <button
                type="button"
                onClick={openForm}
                disabled={busy}
                className="h-10 px-4 rounded-md bg-blue-600 text-white text-sm font-semibold hover:bg-blue-700 disabled:opacity-50"
              >
                Pair a terminal
              </button>
            )}
          </div>
        </div>

        {listError && <Banner tone="error" text={listError} />}
        {notice && <Banner tone="ok" text={notice} />}

        {paired && (
          <div className="rounded-md border border-emerald-300 bg-emerald-50 p-3 text-sm flex flex-col gap-1">
            <div className="font-bold text-emerald-800">
              Pairing successful — confirm code {paired.confirmationCode} on the terminal
            </div>
            <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-0.5 text-emerald-900">
              <span className="text-emerald-700">Nickname</span>
              <span>{paired.nickname || "—"}</span>
              <span className="text-emerald-700">Pairing ID</span>
              <span className="font-mono">{paired.pairingId}</span>
              <span className="text-emerald-700">TID</span>
              <span className="font-mono">{paired.tid || "—"}</span>
              <span className="text-emerald-700">Terminal nickname</span>
              <span>{paired.terminalNickname || "—"}</span>
            </div>
            {!paired.selectedForThisTerminal && (
              <div className="text-xs text-emerald-800">Use “Use on this lane” below to take card payments on this till with it.</div>
            )}
          </div>
        )}

        {formOpen && (
          <div className="rounded-md border border-gray-200 bg-white p-4 flex flex-col gap-3">
            <div className="text-sm text-gray-600">
              On the terminal, start pairing to show its Pairing Code, then enter it here.
            </div>
            <div className="grid grid-cols-2 gap-3">
              <FieldBox label="Pairing Code" value={code} active={field === "code"} onFocus={() => setField("code")} mono />
              <FieldBox
                label="Nickname (optional)"
                value={nickname}
                active={field === "nickname"}
                onFocus={() => setField("nickname")}
              />
            </div>
            {line && <Banner tone={line.tone} text={line.text} />}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => void pair()}
                disabled={busy || !code.trim()}
                className="h-11 px-6 rounded-md bg-blue-600 text-white text-sm font-bold hover:bg-blue-700 disabled:bg-gray-300"
              >
                {busy ? "Pairing…" : "Pair"}
              </button>
              <button
                type="button"
                onClick={cancelForm}
                disabled={busy}
                className="h-11 px-6 rounded-md bg-gray-100 text-gray-700 text-sm font-bold hover:bg-gray-200"
              >
                Cancel
              </button>
            </div>
          </div>
        )}

        {activeCount > 1 && !laneHasOne && (
          <Banner tone="error" text="More than one terminal is paired — pick the one for this lane." />
        )}

        <div className="rounded-md border border-gray-200 bg-white divide-y divide-gray-100">
          {pairings && list.length === 0 && (
            <div className="p-4 text-sm text-gray-500">No terminal paired. Card payments are keyed (external EFTPOS).</div>
          )}
          {list.map((p) => {
            const st = pairingStateText(p);
            const rl = rowLine[p.id];
            return (
              <div key={p.id} className="p-3 flex flex-col gap-2">
                <div className="flex items-start gap-4">
                  <div className="flex-1 min-w-0 grid grid-cols-[auto_1fr_auto_1fr] gap-x-4 gap-y-0.5 text-sm">
                    <span className="text-gray-500">Nickname</span>
                    <span className="font-semibold">{p.nickname || "—"}</span>
                    <span className="text-gray-500">Pairing ID</span>
                    <span className="font-mono">{p.pairingId}</span>
                    <span className="text-gray-500">TID</span>
                    <span className="font-mono">{p.tid || "—"}</span>
                    <span className="text-gray-500">Terminal</span>
                    <span>{p.terminalNickname || "—"}</span>
                    <span className="text-gray-500">State</span>
                    <span
                      className={cn(
                        "font-semibold",
                        st.tone === "ok" ? "text-emerald-700" : st.tone === "warn" ? "text-amber-700" : "text-gray-500",
                      )}
                    >
                      {st.text}
                    </span>
                    <span className="text-gray-500">Last test</span>
                    <span>{fmtAt(p.lastTestAt)}</span>
                  </div>
                  <div className="flex flex-wrap justify-end gap-2 shrink-0 max-w-[360px]">
                    {p.selectedForThisTerminal ? (
                      <button type="button" onClick={() => void rowAction(p, "clear")} disabled={busy} className={btn("ghost")}>
                        On this lane ✓ (clear)
                      </button>
                    ) : (
                      p.active && (
                        <button type="button" onClick={() => void rowAction(p, "select")} disabled={busy} className={btn("primary")}>
                          Use on this lane
                        </button>
                      )
                    )}
                    <button type="button" onClick={() => void rowAction(p, "test")} disabled={busy} className={btn("ghost")}>
                      Test
                    </button>
                    {p.active && (
                      <button type="button" onClick={() => void rowAction(p, "unpair")} disabled={busy} className={btn("danger")}>
                        Unpair
                      </button>
                    )}
                    {!p.active && (
                      <button type="button" onClick={() => void rowAction(p, "delete")} disabled={busy} className={btn("danger")}>
                        Delete
                      </button>
                    )}
                  </div>
                </div>
                {rl && <Banner tone={rl.tone} text={rl.text} />}
              </div>
            );
          })}
        </div>
      </div>

      {formOpen && (
        <div className="w-[600px] shrink-0 border-l border-gray-200 bg-white p-3 flex flex-col">
          <div className="mb-1 text-sm font-medium text-gray-500">{field === "code" ? "Pairing Code" : "Nickname"}</div>
          <div className="flex-1 min-h-0">
            {field === "code" ? (
              <OnScreenKeyboard key="code" value={code} onChange={(v) => setCode(v.replace(/\s+/g, "").slice(0, 32))} onEnter={() => void pair()} initialLayout="numpad" />
            ) : (
              <OnScreenKeyboard key="nickname" value={nickname} onChange={(v) => setNickname(v.slice(0, 64))} initialLayout="english" />
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function btn(kind: "primary" | "ghost" | "danger") {
  return cn(
    "h-10 px-4 rounded-md text-sm font-semibold disabled:opacity-50",
    kind === "primary" && "bg-blue-600 text-white hover:bg-blue-700",
    kind === "ghost" && "bg-gray-100 text-gray-800 hover:bg-gray-200",
    kind === "danger" && "bg-red-50 text-red-700 border border-red-200 hover:bg-red-100",
  );
}

function Banner({ tone, text }: { tone: "ok" | "error"; text: string }) {
  return (
    <div
      className={cn(
        "rounded-md border px-3 py-2 text-sm font-medium",
        tone === "ok" ? "bg-emerald-50 text-emerald-800 border-emerald-300" : "bg-red-50 text-red-700 border-red-300",
      )}
    >
      {text}
    </div>
  );
}

function FieldBox({
  label,
  value,
  active,
  onFocus,
  mono,
}: {
  label: string;
  value: string;
  active: boolean;
  onFocus: () => void;
  mono?: boolean;
}) {
  return (
    <div className="flex flex-col gap-1">
      <span className="text-xs font-medium text-gray-500">{label}</span>
      <div
        role="textbox"
        onClick={onFocus}
        className={cn(
          "h-11 rounded-md border px-3 flex items-center text-lg bg-white cursor-text",
          active ? "border-blue-500 ring-2 ring-blue-200" : "border-gray-300",
          mono && "font-mono tracking-widest",
        )}
      >
        {value || <span className="text-gray-300 text-sm">{active ? "Type on the keyboard" : "Tap to edit"}</span>}
      </div>
    </div>
  );
}
