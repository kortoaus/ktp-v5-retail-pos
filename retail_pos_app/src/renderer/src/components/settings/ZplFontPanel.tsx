/**
 * Korean font install controls for one ZPL printer, network or serial.
 *
 * Self-contained on purpose: the settings screen only decides whether to render
 * it. Everything it knows about fonts goes through window.electronAPI, so the
 * coming label rewrite can move or delete this file without touching anything
 * else.
 *
 * The two transports differ in one way the user has to feel: over TCP the whole
 * install is about thirteen seconds, over serial it is closer to eleven
 * minutes. Every affordance below that mentions time, or that would touch the
 * port without being asked, is conditioned on that.
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type {
  MediaSize,
  ZplFontInstallProgress,
  ZplFontStatus,
  ZplFontTarget,
} from "../../../../preload/index.d";

interface Props {
  target: ZplFontTarget;
  mediaSize?: MediaSize;
}

/** Label dimensions in millimetres for each configured media size. */
const MEDIA_MM: Record<MediaSize, { widthMm: number; heightMm: number }> = {
  "6040": { widthMm: 60, heightMm: 40 },
  "58100": { widthMm: 58, heightMm: 100 },
  "7030": { widthMm: 70, heightMm: 30 },
  "7090": { widthMm: 70, heightMm: 90 },
  "100100": { widthMm: 100, heightMm: 100 },
};

/** What the printer runs at when it will not say — every unit seen so far. */
const DEFAULT_DPI = 203;

/**
 * Rough transfer rates, used only for the time estimate on the button.
 *
 * The first two were measured on hardware over TCP: a Bixolon is about a third
 * the speed of a Zebra. The serial figure is not a measurement but arithmetic —
 * 115200/8/N/1 is 11,520 bytes per second and the wire, not the printer, is the
 * limit there. It works out to roughly four minutes a font.
 */
const BYTES_PER_SEC = { responds: 600_000, blind: 195_000, serial: 11_520 };

function formatMb(bytes: number): string {
  return `${(bytes / 1024 / 1024).toFixed(1)}MB`;
}

/** Seconds up to a minute and a half, whole minutes after that. */
function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "";
  return seconds < 90 ? `~${Math.round(seconds)}s` : `~${Math.round(seconds / 60)}min`;
}

/** Identity for matching a progress tick to this row. Mirrors zpl-font/target.ts. */
function keyOf(target: ZplFontTarget): string {
  return target.type === "serial" ? `serial:${target.path}` : `net:${target.host}:${target.port}`;
}

function describe(target: ZplFontTarget): string {
  return target.type === "serial" ? target.path : `${target.host}:${target.port}`;
}

export default function ZplFontPanel({ target, mediaSize }: Props) {
  const [status, setStatus] = useState<ZplFontStatus | null>(null);
  const [checking, setChecking] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<ZplFontInstallProgress | null>(null);
  const [message, setMessage] = useState("");
  // Only consulted for a printer that will not report its own resolution.
  const [dpi, setDpi] = useState(String(DEFAULT_DPI));

  const dpiValue = Number(dpi) >= 100 && Number(dpi) <= 1200 ? Number(dpi) : DEFAULT_DPI;

  const serial = target.type === "serial";

  /**
   * The printer answers no status query — a Bixolon XD3/XD5 in BPL-Z, or any
   * printer cabled without a return line, which is common on serial.
   *
   * It takes the fonts and prints hangul regardless, it just never confirms
   * anything, so every certainty below has to come off a proof label instead.
   * Blind is never assumed up front: ~HI is always tried first, on both
   * transports, and only silence switches this on.
   */
  const blind = status !== null && !status.capabilities.responds;

  // The row stays mounted while its address is edited, so identity is captured
  // per call rather than per render — a check started against one printer must
  // not write its result into a row now pointing somewhere else.
  const targetRef = useRef(target);
  targetRef.current = target;

  // Read through a ref for the same reason: putting the dpi in `check`'s deps
  // would fire a connection attempt on every keystroke in the override box.
  const dpiRef = useRef(dpiValue);
  dpiRef.current = dpiValue;

  const check = useCallback(async (): Promise<void> => {
    const current = targetRef.current;
    if (current.type === "net" && !current.host.trim()) return;
    if (current.type === "serial" && !current.path.trim()) return;
    const key = keyOf(current);

    setChecking(true);
    setMessage("");
    try {
      const result = await window.electronAPI.zplFontStatus(current, dpiRef.current);
      if (keyOf(targetRef.current) !== key) return; // repointed while in flight
      if (result.ok) setStatus(result.data);
      else {
        setStatus(null);
        setMessage(result.message);
      }
    } finally {
      setChecking(false);
    }
  }, []);

  /**
   * Check once, for network printers only.
   *
   * A serial check opens the physical port and can sit there for twelve seconds
   * waiting for a reply that a TX-only cable will never deliver — and while it
   * does, no label can print. Doing that unasked, once per configured row,
   * every time somebody opens this screen, is not worth a status dot. The
   * button is right there.
   */
  useEffect(() => {
    if (targetRef.current.type === "serial") return;
    void check();
  }, [check]);

  useEffect(() => {
    return window.electronAPI.onZplFontProgress((event) => {
      if (keyOf(event.target) !== keyOf(targetRef.current)) return;
      setProgress(event.progress);
    });
  }, []);

  const media = (): { widthMm: number; heightMm: number | undefined } =>
    mediaSize ? MEDIA_MM[mediaSize] : { widthMm: 100, heightMm: undefined };

  const install = async (force: boolean): Promise<void> => {
    setBusy(true);
    setProgress(null);
    setMessage("");
    try {
      const size = media();
      const result = await window.electronAPI.zplFontInstall({
        target: targetRef.current,
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
        // Re-reading a serial printer means opening the port again for another
        // ten-odd seconds, right after it just failed. Say what went wrong and
        // let the user press Refresh.
        if (!serial) await check();
      }
    } finally {
      setBusy(false);
      setProgress(null);
    }
  };

  const testPrint = async (): Promise<void> => {
    setBusy(true);
    setMessage("");
    try {
      const size = media();
      const result = await window.electronAPI.zplFontTestPrint({
        target: targetRef.current,
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

  // Serial is wire-limited, so its rate is known before the printer is: it does
  // not depend on which model answers. That is what lets the estimate show
  // before the first check, which on serial may never happen.
  const rate = serial
    ? BYTES_PER_SEC.serial
    : blind
      ? BYTES_PER_SEC.blind
      : BYTES_PER_SEC.responds;
  // Before a check there is no reported bundle size; three ~2.45MB faces is what
  // ships, and an estimate the user can see beforehand is the whole point.
  const estimateBytes = bundledTotal || (serial ? 3 * 2_450_000 : 0);
  const estimate = formatDuration(estimateBytes / rate);

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
            {status === null ? "Check" : "Refresh"}
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
              : `Install${estimateBytes ? ` (${formatMb(estimateBytes)}, ${estimate})` : ""}`}
          </button>
          <button
            onClick={() => void testPrint()}
            /* A blind printer can always be asked to print: the label is the
               only way to find out whether the fonts are there. Same for an
               unchecked serial printer, which is the normal state there. */
            disabled={busy || checking || (!serial && !blind && (!status || installed === 0))}
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
          {/* A ~DY in flight eats everything else arriving on the port until its
              byte count is met, so a label printed now is swallowed and lost. */}
          <p className="mt-1 text-[11px] text-amber-600">
            {serial
              ? `Do not print to ${describe(target)} until the install finishes — a label sent now is swallowed by the transfer. Serial is slow; ${estimate} is normal, do not power-cycle the printer.`
              : "Do not print to this printer until the install finishes."}
          </p>
        </div>
      )}

      {serial && !progress && (
        <p className="mt-1.5 text-[11px] text-gray-500">
          Serial 115200: about 4 minutes per font, {estimate} for all three. The port is locked for
          the whole transfer, so no label can print from {describe(target)} meanwhile.
        </p>
      )}

      {blind && !progress && (
        <p className="mt-1.5 text-[11px] text-gray-500">
          Printer does not report status (Bixolon, or a cable with no return line) — verify by proof
          label. Install prints one automatically; Korean on it means the fonts are in.
        </p>
      )}

      {message && !progress && <p className="mt-1.5 text-[11px] text-gray-600">{message}</p>}
    </div>
  );
}
