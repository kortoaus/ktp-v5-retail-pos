/**
 * Temporary bench for the label-core rewrite.
 *
 * Pick a ZPL printer, pick media, print the diagnostic label, read the ZPL that
 * produced it. Nothing here computes a layout — every number comes from
 * `label-core`, so what is tuned on this screen is the library, not the screen.
 * It will be reshaped into the real /scale weighing page once the six templates
 * are settled; until then it is reachable from a temporary home-screen button.
 */

import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { cn } from "../libs/cn";
import { useZplPrinters, type LabelPrinter } from "../hooks/useZplPrinters";
import { MEDIA, MEDIA_IDS, buildDiagnosticLabel, renderLabel, type MediaId } from "../label-core";

function printerKey(printer: LabelPrinter): string {
  return printer.type === "serial"
    ? `serial:${printer.path}`
    : `net:${printer.host}:${printer.port}`;
}

function printerAddress(printer: LabelPrinter): string {
  return printer.type === "serial" ? printer.path : `${printer.host}:${printer.port}`;
}

export default function ScaleLabelTestScreen() {
  const { printers, printLabel } = useZplPrinters();
  const [selectedKey, setSelectedKey] = useState("");
  const [media, setMedia] = useState<MediaId>("6040");
  const [dbg, setDbg] = useState(false);
  const [printing, setPrinting] = useState(false);
  const [message, setMessage] = useState("");

  // SLCS is gone from this track; a printer still configured for it cannot
  // render the fonts this library addresses, so it is not offered.
  const zplPrinters = useMemo(
    () => printers.filter((printer) => printer.language === "zpl"),
    [printers],
  );

  const selected =
    zplPrinters.find((printer) => printerKey(printer) === selectedKey) ?? zplPrinters[0];

  const zpl = useMemo(
    () => renderLabel(buildDiagnosticLabel(media, { dbg })),
    [media, dbg],
  );

  const handlePrint = async (): Promise<void> => {
    if (!selected || printing) return;

    setPrinting(true);
    setMessage("");
    try {
      // A ~DY font transfer swallows everything arriving on the printer until
      // its declared byte count is satisfied, so a label sent mid-install is
      // eaten and lost. The service knows it is busy but exposes no IPC saying
      // so; what it does expose is a status query, and a printer part-way
      // through an install will not answer a second connection. A failed status
      // therefore means "busy or unreachable" — either way, do not print.
      if (selected.type === "net") {
        const status = await window.electronAPI.zplFontStatus({
          host: selected.host,
          port: selected.port,
        });
        if (!status.ok) {
          window.alert(
            `Printer is not answering — a font transfer may be running.\n\n${status.message}\n\nPrint cancelled.`,
          );
          setMessage("Print cancelled: printer busy or unreachable.");
          return;
        }
      }

      const result = await printLabel(selected, { language: "zpl", data: zpl });
      setMessage(result.ok ? "Sent." : result.message);
      if (!result.ok) window.alert(result.message);
    } catch (err) {
      const text = err instanceof Error ? err.message : "Failed to print";
      setMessage(text);
      window.alert(text);
    } finally {
      setPrinting(false);
    }
  };

  const dots = MEDIA[media].dots;

  return (
    <div className="h-full w-full bg-gray-100 flex flex-col">
      <div className="h-16 flex items-center gap-4 px-4 border-b border-gray-200 bg-white">
        <Link to="/" className="text-sm text-blue-600 hover:text-blue-800 font-medium">
          &larr; Back
        </Link>
        <h1 className="text-lg font-semibold text-gray-900">Scale / Label Test</h1>
        <span className="text-xs text-gray-400">label-core diagnostic</span>
      </div>

      <div className="flex-1 min-h-0 grid grid-cols-[minmax(320px,420px)_1fr] gap-4 p-4">
        <section className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-4 overflow-y-auto">
          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-gray-500 uppercase">ZPL Printer</span>
            {zplPrinters.length === 0 ? (
              <p className="text-sm text-gray-500">
                No ZPL printer configured. Add one in Interface Settings.
              </p>
            ) : (
              <div className="flex flex-col gap-2">
                {zplPrinters.map((printer) => {
                  const key = printerKey(printer);
                  const active = selected ? printerKey(selected) === key : false;
                  return (
                    <button
                      key={key}
                      type="button"
                      onPointerDown={() => setSelectedKey(key)}
                      className={cn(
                        "h-12 px-3 rounded-lg border text-sm font-semibold text-left transition-colors",
                        active
                          ? "border-blue-500 bg-blue-50 text-blue-700"
                          : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
                      )}
                    >
                      {printer.name}
                      <span className="ml-2 font-normal text-gray-400">
                        {printerAddress(printer)}
                      </span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-gray-500 uppercase">Media</span>
            <div className="grid grid-cols-3 gap-2">
              {MEDIA_IDS.map((id) => (
                <button
                  key={id}
                  type="button"
                  onPointerDown={() => setMedia(id)}
                  className={cn(
                    "h-12 rounded-lg border text-sm font-semibold transition-colors",
                    media === id
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
                  )}
                >
                  {MEDIA[id].label}
                </button>
              ))}
            </div>
            <span className="text-xs text-gray-400">
              {dots[0]} × {dots[1]} dots @ 203 dpi
            </span>
          </div>

          <button
            type="button"
            onPointerDown={() => setDbg((value) => !value)}
            className={cn(
              "h-12 rounded-lg border text-sm font-semibold transition-colors",
              dbg
                ? "border-amber-500 bg-amber-50 text-amber-700"
                : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
            )}
          >
            Debug outlines: {dbg ? "ON" : "OFF"}
          </button>

          <button
            type="button"
            disabled={!selected || printing}
            onPointerDown={handlePrint}
            className={cn(
              "mt-auto h-14 rounded-lg text-base font-bold transition-colors",
              selected && !printing
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-gray-200 text-gray-400",
            )}
          >
            {printing ? "Printing..." : "Print diagnostic label"}
          </button>

          {message && <p className="text-sm text-gray-600 break-words">{message}</p>}
        </section>

        <section className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-3 min-h-0">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500 uppercase">Generated ZPL</span>
            <span className="text-sm font-medium text-gray-500">
              {zpl.split("\n").length} lines · {zpl.length} bytes
            </span>
          </div>
          <textarea
            readOnly
            value={zpl}
            spellCheck={false}
            className="flex-1 min-h-0 rounded-lg border border-gray-200 bg-gray-50 p-3 font-mono text-xs text-gray-800 resize-none outline-none"
          />
        </section>
      </div>
    </div>
  );
}
