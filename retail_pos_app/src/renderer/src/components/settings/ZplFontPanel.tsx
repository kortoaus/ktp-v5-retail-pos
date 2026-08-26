/**
 * Korean font install controls for one network ZPL printer.
 *
 * Self-contained on purpose: the settings screen only decides whether to render
 * it. Everything it knows about fonts goes through window.electronAPI, so the
 * coming label rewrite can move or delete this file without touching anything
 * else.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MediaSize,
  ZplFontInstallProgress,
  ZplFontStatus,
} from "../../../../preload/index.d";

interface Props {
  host: string;
  port: number;
  mediaSize?: MediaSize;
}

/** Label dimensions in millimetres for each configured media size. */
const MEDIA_MM: Record<MediaSize, { widthMm: number; heightMm: number }> = {
  "7030": { widthMm: 70, heightMm: 30 },
  "7090": { widthMm: 70, heightMm: 90 },
  "100100": { widthMm: 100, heightMm: 100 },
};

/** What the printer runs at when it will not say — every unit seen so far. */
const DEFAULT_DPI = 203;

/**
 * Rough transfer rates, measured on hardware, used only for the button's
 * time estimate. A Bixolon is about a third the speed of a Zebra.
 */
const BYTES_PER_SEC = { responds: 600_000, blind: 195_000 };

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

export default function ZplFontPanel({ host, port, mediaSize }: Props) {
  const [status, setStatus] = useState<ZplFontStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ZplFontInstallProgress | null>(null);
  const [message, setMessage] = useState("");
  // Only consulted for a printer that will not report its own resolution.
  const [dpi, setDpi] = useState(String(DEFAULT_DPI));

  const dpiValue = Number(dpi) >= 100 && Number(dpi) <= 1200 ? Number(dpi) : DEFAULT_DPI;

  /**
   * The printer answers no status query — a Bixolon XD3/XD5 in BPL-Z.
   *
   * It takes the fonts and prints hangul like any Zebra, it just never confirms
   * anything, so every certainty below has to come off a proof label instead.
   */
  const blind = status !== null && !status.capabilities.responds;

  // The row stays mounted while its host is edited, so identity is captured per
  // call rather than per render — a check started against one address must not
  // write its result into a row now pointing somewhere else.
  const targetRef = useRef({ host, port });
  targetRef.current = { host, port };

  // Read through a ref for the same reason: putting the dpi in `check`'s deps
  // would fire a connection attempt on every keystroke in the override box.
  const dpiRef = useRef(dpiValue);
  dpiRef.current = dpiValue;

  const check = useCallback(async (): Promise<void> => {
    const target = { ...targetRef.current };
    if (!target.host.trim()) return;

    setChecking(true);
    setMessage("");
    try {
      const result = await window.electronAPI.zplFontStatus(target, dpiRef.current);
      if (targetRef.current.host !== target.host || targetRef.current.port !== target.port) {
        return; // the row was repointed while this was in flight
      }
      if (result.ok) setStatus(result.data);
      else {
        setStatus(null);
        setMessage(result.message);
      }
    } finally {
      setChecking(false);
    }
  }, []);

  // Check once for the address that was already saved. Editing the host does
  // not retrigger it — that would fire a connection attempt per keystroke.
  useEffect(() => {
    void check();
  }, [check]);

  useEffect(() => {
    return window.electronAPI.onZplFontProgress((event) => {
      const target = targetRef.current;
      if (event.target.host !== target.host || event.target.port !== target.port) return;
      setProgress(event.progress);
    });
  }, []);

  const media = (): { widthMm: number; heightMm: number | undefined } =>
    mediaSize ? MEDIA_MM[mediaSize] : { widthMm: 100, heightMm: undefined };

  const install = async (force: boolean): Promise<void> => {
    const target = { ...targetRef.current };
    setBusy(true);
    setProgress(null);
    setMessage("");
    try {
      const size = media();
      const result = await window.electronAPI.zplFontInstall({
        target,
        force,
        // Carried for the proof label a printer that reports nothing prints
        // on its own. Never sent to one that answers ~HI: its own reading of
        // its resolution beats anything typed here.
        dpi: blind ? dpiValue : undefined,
        widthMm: size.widthMm,
        heightMm: size.heightMm,
      });
      if (result.ok) {
        setStatus(result.data.status);
        const sent = result.data.sent.length;
        setMessage(
          result.data.message ??
            (sent === 0
              ? "Already installed."
              : `Installed ${sent} font(s) in ${(result.data.elapsedMs / 1000).toFixed(1)}s.`),
        );
      } else {
        setMessage(result.message);
        await check();
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const testPrint = async (): Promise<void> => {
    const target = { ...targetRef.current };
    setBusy(true);
    setMessage("");
    try {
      const size = media();
      const result = await window.electronAPI.zplFontTestPrint({
        target,
        widthMm: size.widthMm,
        heightMm: size.heightMm,
        dpi: blind ? dpiValue : undefined,
      });
      setMessage(result.ok ? "Test label sent." : result.message);
    } finally {
      setBusy(false);
    }
  };

  const installed = status?.installedCount ?? 0;
  const total = status?.totalCount ?? 0;
  const complete = status !== null && !blind && installed === total;
  const bundledTotal = status?.fonts.reduce((n, f) => n + f.bundledSize, 0) ?? 0;
  const sentBlind = blind && (status?.fonts.some((f) => f.state === "unverified") ?? false);

  let dot = "bg-gray-300";
  let summary = "Not checked";
  if (checking) {
    summary = "Checking…";
  } else if (blind) {
    // Neutral, both before and after an install: green would be a claim this
    // printer has given nobody the right to make.
    dot = "bg-gray-300";
    summary = sentBlind ? "Sent · unverified" : "Status unknown";
    summary += ` · ${status?.capabilities.dpi ?? dpiValue}dpi assumed`;
  } else if (status) {
    if (complete) {
      dot = "bg-green-500";
      summary = `Installed ${installed}/${total}`;
    } else if (installed > 0 || status.fonts.some((f) => f.state === "mismatch")) {
      dot = "bg-amber-500";
      summary = `Incomplete ${installed}/${total}`;
    } else {
      dot = "bg-gray-300";
      summary = "Not installed";
    }
    if (status.freeBytes !== null) summary += ` · ${formatMb(status.freeBytes)} free`;
    if (status.identity) summary += ` · ${status.identity.dpi}dpi`;
  }

  const seconds = Math.round(
    bundledTotal / (blind ? BYTES_PER_SEC.blind : BYTES_PER_SEC.responds),
  );

  const pct = progress ? Math.floor((progress.sentBytes / progress.totalBytes) * 100) : 0;

  return (
    <div className="ml-1 rounded-lg border border-gray-200 bg-gray-50 px-3 py-2">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
        <span className="text-xs font-medium text-gray-700">Korean font</span>
        <span className={`h-2 w-2 rounded-full ${dot}`} />
        <span className="text-xs text-gray-500">{summary}</span>

        <div className="ml-auto flex items-center gap-2">
          <button
            onClick={() => void check()}
            disabled={checking || busy}
            className="rounded px-2 py-1 text-xs text-gray-500 hover:text-gray-800 disabled:opacity-40"
          >
            Refresh
          </button>
          {blind && (
            /* The printer will not report its resolution, so it has to be told
               one. 203 covers every unit seen so far; 300 dpi models exist. */
            <label className="flex items-center gap-1 text-[11px] text-gray-500">
              dpi
              <input
                value={dpi}
                onChange={(e) => setDpi(e.target.value)}
                inputMode="numeric"
                className="w-12 rounded border border-gray-300 px-1 py-0.5 text-right text-[11px] text-gray-700"
              />
            </label>
          )}
          <button
            onClick={() => void install(complete)}
            disabled={busy || checking}
            className="rounded bg-blue-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-blue-700 disabled:opacity-40"
          >
            {complete
              ? "Reinstall"
              : `Install${bundledTotal ? ` (${formatMb(bundledTotal)}, ~${seconds}s)` : ""}`}
          </button>
          <button
            onClick={() => void testPrint()}
            /* A blind printer can always be asked to print: the label is the
               only way to find out whether the fonts are there. */
            disabled={busy || checking || (!blind && (!status || installed === 0))}
            className="rounded border border-gray-300 px-2.5 py-1 text-xs text-gray-700 hover:border-gray-400 disabled:opacity-40"
          >
            Test print
          </button>
        </div>
      </div>

      {progress && (
        <div className="mt-2">
          <div className="mb-1 flex justify-between text-[11px] text-gray-500">
            <span>
              {progress.weight} ({progress.index}/{progress.count})
            </span>
            <span>{pct}%</span>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-200">
            <div className="h-full bg-blue-600 transition-all" style={{ width: `${pct}%` }} />
          </div>
          {/* A ~DY in flight eats everything else arriving on port 9100 until its
              byte count is met, so a label printed now is swallowed and lost. */}
          <p className="mt-1 text-[11px] text-amber-600">
            Do not print to this printer until the install finishes.
          </p>
        </div>
      )}

      {blind && !progress && (
        <p className="mt-1.5 text-[11px] text-gray-500">
          Printer does not report status (Bixolon) — verify by proof label. Install prints one
          automatically; Korean on it means the fonts are in.
        </p>
      )}

      {message && !progress && (
        <p className="mt-1.5 text-[11px] text-gray-600">{message}</p>
      )}
    </div>
  );
}
