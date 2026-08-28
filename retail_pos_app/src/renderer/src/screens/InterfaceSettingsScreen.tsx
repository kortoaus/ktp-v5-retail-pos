import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { IoPrintOutline } from "react-icons/io5";
import { useUser } from "../contexts/UserContext";
import hasScope from "../libs/scope-utils";
import BlockScreen from "../components/BlockScreen";
import { cutCommand, initPrinterCommand } from "../libs/printer/escpos";
import ZplFontPanel from "../components/settings/ZplFontPanel";

type ScaleType = "CAS" | "DATALOGIC";
type Parity = "none" | "even" | "odd" | "mark" | "space";

interface ScaleForm {
  enabled: boolean;
  type: ScaleType;
  path: string;
  baudRate: number;
  dataBits: number;
  stopBits: number;
  parity: Parity;
}

type LabelLanguage = "zpl" | "slcs";
/** Kept in step with `label-core/media.ts MediaId` and `preload/index.d.ts`. */
type MediaSize = "6040" | "58100" | "7030" | "7090" | "100100";

interface ZplSerialEntry {
  name: string;
  path: string;
  language: LabelLanguage;
  mediaSize?: MediaSize;
}

interface ZplNetEntry {
  name: string;
  host: string;
  port: number;
  language: LabelLanguage;
  mediaSize?: MediaSize;
}

type EscposTransport = "net" | "serial";
type EscposSerialParity = "none" | "even" | "odd" | "mark" | "space";
type EscposSerialHandshaking = "none" | "dtr-dsr" | "rts-cts" | "xon-xoff";
type ReceiptPrintMode = "raster" | "escpos";
type ReceiptTextEncoding = "ascii-replace" | "cp949" | "euc-kr";

interface EscposForm {
  enabled: boolean;
  type: EscposTransport;
  host: string;
  port: number;
  path: string;
  baudRate: number;
  dataBits: 7 | 8;
  parity: EscposSerialParity;
  stopBits: 1 | 2;
  handshaking: EscposSerialHandshaking;
  dtr: boolean;
  rts: boolean;
  receiptPrintMode: ReceiptPrintMode;
  receiptTextEncoding: ReceiptTextEncoding;
}

const SCALE_DEFAULTS: ScaleForm = {
  enabled: false,
  type: "CAS",
  path: "",
  baudRate: 9600,
  dataBits: 7,
  stopBits: 1,
  parity: "even",
};

const ESCPOS_DEFAULTS: EscposForm = {
  enabled: false,
  type: "net",
  host: "",
  port: 9100,
  path: "",
  baudRate: 38400,
  dataBits: 8,
  parity: "none",
  stopBits: 1,
  handshaking: "dtr-dsr",
  dtr: true,
  rts: true,
  receiptPrintMode: "raster",
  receiptTextEncoding: "ascii-replace",
};

const PARITIES: Parity[] = ["none", "even", "odd", "mark", "space"];
const ESCPOS_BAUD_RATES = [9600, 19200, 38400, 57600, 115200] as const;
const ESCPOS_DATA_BITS = [7, 8] as const;
const ESCPOS_STOP_BITS = [1, 2] as const;
const ESCPOS_PARITIES: EscposSerialParity[] = [
  "none",
  "even",
  "odd",
  "mark",
  "space",
];
const ESCPOS_HANDSHAKING: Array<{
  value: EscposSerialHandshaking;
  label: string;
}> = [
  { value: "none", label: "None" },
  { value: "dtr-dsr", label: "DTR/DSR" },
  { value: "rts-cts", label: "RTS/CTS" },
  { value: "xon-xoff", label: "XON/XOFF" },
];

const RECEIPT_PRINT_MODES: Array<{
  value: ReceiptPrintMode;
  label: string;
}> = [
  { value: "raster", label: "Raster Image" },
  { value: "escpos", label: "ESC/POS Command" },
];

const RECEIPT_TEXT_ENCODINGS: Array<{
  value: ReceiptTextEncoding;
  label: string;
}> = [
  { value: "ascii-replace", label: "ASCII replace" },
  { value: "cp949", label: "CP949" },
  { value: "euc-kr", label: "EUC-KR" },
];

const inputClass =
  "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-400";
const selectClass = inputClass;
const labelClass = "block text-sm font-medium text-gray-700 mb-1";
const btnSmClass =
  "text-xs font-medium px-3 py-1.5 rounded-lg transition-colors";

function concatBytes(parts: Uint8Array[]): Uint8Array {
  const totalLength = parts.reduce((sum, part) => sum + part.length, 0);
  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const part of parts) {
    buffer.set(part, offset);
    offset += part.length;
  }
  return buffer;
}

function buildEscposSerialTestBuffer(): Uint8Array {
  const text = "Hello World\n\n\n";
  const textBytes = new Uint8Array([...text].map((char) => char.charCodeAt(0)));
  return concatBytes([initPrinterCommand(), textBytes, cutCommand(3)]);
}

export default function InterfaceSettingsScreen() {
  const { user, loading: userLoading } = useUser();
  const [ports, setPorts] = useState<string[]>([]);
  const [scale, setScale] = useState<ScaleForm>(SCALE_DEFAULTS);
  const [zplSerial, setZplSerial] = useState<ZplSerialEntry[]>([]);
  const [zplNet, setZplNet] = useState<ZplNetEntry[]>([]);
  const [escpos, setEscpos] = useState<EscposForm>(ESCPOS_DEFAULTS);
  const [appVersion, setAppVersion] = useState("");
  const [saved, setSaved] = useState(false);
  const [escposTestPrinting, setEscposTestPrinting] = useState(false);
  const [escposTestMessage, setEscposTestMessage] = useState("");
  const [escposMatrixTesting, setEscposMatrixTesting] = useState(false);
  const isDiagnosticPrinting = escposTestPrinting || escposMatrixTesting;
  const [loading, setLoading] = useState(true);

  const fetchPorts = useCallback(async () => {
    const result = await window.electronAPI.getSerialPorts();
    setPorts(result);
  }, []);

  useEffect(() => {
    async function init() {
      const [config, version] = await Promise.all([
        window.electronAPI.getConfig(),
        window.electronAPI.getAppVersion(),
        fetchPorts(),
      ]);

      setAppVersion(version);

      if (config.devices.scale) {
        setScale({ enabled: true, ...config.devices.scale });
      }
      if (config.devices.zplSerial.length > 0) {
        setZplSerial(config.devices.zplSerial);
      }
      if (config.devices.zplNet.length > 0) {
        setZplNet(config.devices.zplNet);
      }
      if (config.devices.escposPrinter) {
        const printer = config.devices.escposPrinter;
        setEscpos((prev) => ({
          ...prev,
          receiptPrintMode: config.devices.receiptPrintMode ?? "raster",
          receiptTextEncoding:
            config.devices.receiptTextEncoding ?? "ascii-replace",
          enabled: true,
          type: printer.type,
          ...(printer.type === "net"
            ? { host: printer.host, port: printer.port }
            : {
                path: printer.path,
                baudRate: printer.baudRate,
                dataBits: printer.dataBits,
                parity: printer.parity,
                stopBits: printer.stopBits,
                handshaking: printer.handshaking,
                dtr: printer.dtr,
                rts: printer.rts,
              }),
        }));
      } else {
        setEscpos((prev) => ({
          ...prev,
          receiptPrintMode: config.devices.receiptPrintMode ?? "raster",
          receiptTextEncoding:
            config.devices.receiptTextEncoding ?? "ascii-replace",
        }));
      }

      setLoading(false);
    }
    init();
  }, [fetchPorts]);

  const handleSave = async () => {
    setSaved(false);

    let escposPrinter:
      | { type: "net"; host: string; port: number }
      | {
          type: "serial";
          path: string;
          baudRate: number;
          dataBits: 7 | 8;
          parity: EscposSerialParity;
          stopBits: 1 | 2;
          handshaking: EscposSerialHandshaking;
          dtr: boolean;
          rts: boolean;
        }
      | null = null;

    if (escpos.enabled) {
      if (escpos.type === "net") {
        const host = escpos.host.trim();
        if (host === "") {
          window.alert("Enter an ESC/POS printer host.");
          return;
        }
        if (
          !Number.isInteger(escpos.port) ||
          escpos.port < 1 ||
          escpos.port > 65535
        ) {
          window.alert("Enter an ESC/POS printer port from 1 to 65535.");
          return;
        }
        escposPrinter = { type: "net", host, port: escpos.port };
      } else {
        const path = escpos.path.trim();
        if (path === "") {
          window.alert("Select an ESC/POS serial port.");
          return;
        }
        if (
          !Number.isInteger(escpos.baudRate) ||
          escpos.baudRate < 1 ||
          escpos.baudRate > 1000000
        ) {
          window.alert("Enter an ESC/POS baud rate from 1 to 1000000.");
          return;
        }
        escposPrinter = {
          type: "serial",
          path,
          baudRate: escpos.baudRate,
          dataBits: escpos.dataBits,
          parity: escpos.parity,
          stopBits: escpos.stopBits,
          handshaking: escpos.handshaking,
          dtr: escpos.dtr,
          rts: escpos.rts,
        };
      }
    }

    const current = await window.electronAPI.getConfig();
    await window.electronAPI.setConfig({
      ...current,
      devices: {
        scale: scale.enabled
          ? {
              type: scale.type,
              path: scale.path,
              baudRate: scale.baudRate,
              dataBits: scale.dataBits,
              stopBits: scale.stopBits,
              parity: scale.parity,
            }
          : null,
        zplSerial: zplSerial
          .filter((e) => e.path.trim() !== "")
          .map((e) => ({
            name: e.name,
            path: e.path,
            language: e.language,
            ...(e.mediaSize ? { mediaSize: e.mediaSize } : {}),
          })),
        zplNet: zplNet
          .filter((e) => e.host.trim() !== "")
          .map((e) => ({
            name: e.name,
            host: e.host,
            port: e.port,
            language: e.language,
            ...(e.mediaSize ? { mediaSize: e.mediaSize } : {}),
          })),
        escposPrinter,
        receiptPrintMode: escpos.receiptPrintMode,
        receiptTextEncoding: escpos.receiptTextEncoding,
      },
    });

    setSaved(true);
    window.alert("Settings saved. The app will restart to apply changes.");
    await window.electronAPI.restartApp();
  };

  const getEscposSerialPrinter = (path: string) => ({
    type: "serial" as const,
    path,
    baudRate: escpos.baudRate,
    dataBits: escpos.dataBits,
    parity: escpos.parity,
    stopBits: escpos.stopBits,
    handshaking: escpos.handshaking,
    dtr: escpos.dtr,
    rts: escpos.rts,
  });

  const handleEscposSerialTestPrint = async () => {
    setEscposTestMessage("");
    const path = escpos.path.trim();

    if (!escpos.enabled || escpos.type !== "serial") {
      setEscposTestMessage("Select Serial transport first.");
      return;
    }
    if (path === "") {
      setEscposTestMessage("Select an ESC/POS serial port.");
      return;
    }
    if (
      !Number.isInteger(escpos.baudRate) ||
      escpos.baudRate < 1 ||
      escpos.baudRate > 1000000
    ) {
      setEscposTestMessage("Enter an ESC/POS baud rate from 1 to 1000000.");
      return;
    }

    setEscposTestPrinting(true);
    try {
      console.log(
        `[ESC/POS:SerialTest] Sending Hello World: path=${path}, baudRate=${escpos.baudRate}`,
      );
      const result = await window.electronAPI.printEscpos({
        printer: getEscposSerialPrinter(path),
        data: Array.from(buildEscposSerialTestBuffer()),
      });
      console.log("[ESC/POS:SerialTest] Result:", result);
      setEscposTestMessage(
        result.ok ? "Sent Hello World test." : result.message,
      );
    } catch (err) {
      console.error("[ESC/POS:SerialTest] IPC failed:", err);
      setEscposTestMessage("Print failed: cannot reach serial printer bridge.");
    } finally {
      setEscposTestPrinting(false);
    }
  };

  const handleEscposControlLineMatrixTest = async () => {
    setEscposTestMessage("");
    const path = escpos.path.trim();

    if (!escpos.enabled || escpos.type !== "serial") {
      setEscposTestMessage("Select Serial transport first.");
      return;
    }
    if (path === "") {
      setEscposTestMessage("Select an ESC/POS serial port.");
      return;
    }
    if (
      !Number.isInteger(escpos.baudRate) ||
      escpos.baudRate < 1 ||
      escpos.baudRate > 1000000
    ) {
      setEscposTestMessage("Enter an ESC/POS baud rate from 1 to 1000000.");
      return;
    }

    setEscposMatrixTesting(true);
    try {
      console.log(
        `[ESC/POS:SerialTest] Running control-line matrix: path=${path}, baudRate=${escpos.baudRate}`,
      );
      const result = await window.electronAPI.testEscposControlLines({
        printer: getEscposSerialPrinter(path),
        data: Array.from(buildEscposSerialTestBuffer()),
      });
      console.log("[ESC/POS:SerialTest] Control-line matrix result:", result);
      setEscposTestMessage(
        result.ok
          ? "Control-line matrix sent. Check logs and printer output."
          : `Control-line matrix failed: ${result.message}`,
      );
    } catch (err) {
      console.error("[ESC/POS:SerialTest] Control-line matrix IPC failed:", err);
      setEscposTestMessage("Matrix failed: cannot reach serial printer bridge.");
    } finally {
      setEscposMatrixTesting(false);
    }
  };

  const addZplSerial = () => {
    setZplSerial((prev) => [
      ...prev,
      { name: "", path: "", language: "zpl" },
    ]);
  };

  const updateZplSerial = (
    index: number,
    field: keyof ZplSerialEntry,
    value: string | undefined,
  ) => {
    setZplSerial((prev) =>
      prev.map((e, i) => (i === index ? { ...e, [field]: value } : e)),
    );
  };

  const removeZplSerial = (index: number) => {
    setZplSerial((prev) => prev.filter((_, i) => i !== index));
  };

  const addZplNet = () => {
    setZplNet((prev) => [
      ...prev,
      { name: "", host: "", port: 9100, language: "zpl" },
    ]);
  };

  const updateZplNet = (
    index: number,
    field: keyof ZplNetEntry,
    value: string | number | undefined,
  ) => {
    setZplNet((prev) =>
      prev.map((e, i) => (i === index ? { ...e, [field]: value } : e)),
    );
  };

  const removeZplNet = (index: number) => {
    setZplNet((prev) => prev.filter((_, i) => i !== index));
  };

  if (loading || userLoading) {
    return (
      <div className="flex items-center justify-center h-full text-gray-400">
        Loading...
      </div>
    );
  }

  if (!user || !hasScope(user.scope, ["interface"])) {
    return (
      <BlockScreen
        label="You are not authorized to access this page"
        link="/"
      />
    );
  }

  return (
    <div className="h-full overflow-y-auto bg-gray-50 p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Link
              to="/"
              className="text-sm text-blue-600 hover:text-blue-800 font-medium"
            >
              &larr; Back
            </Link>
            <h1 className="text-xl font-bold text-gray-900">
              Interface Settings
            </h1>
          </div>
          <button
            onClick={fetchPorts}
            className="text-sm text-blue-600 hover:text-blue-800 font-medium"
          >
            Refresh Ports
          </button>
        </div>

        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">Scale</h2>
            <Toggle
              checked={scale.enabled}
              onChange={(v) => setScale((s) => ({ ...s, enabled: v }))}
            />
          </div>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Type</label>
              <select
                className={selectClass}
                disabled={!scale.enabled}
                value={scale.type}
                onChange={(e) =>
                  setScale((s) => ({ ...s, type: e.target.value as ScaleType }))
                }
              >
                <option value="CAS">CAS</option>
                <option value="DATALOGIC">Datalogic (Scale + Scanner)</option>
              </select>
            </div>
            <div>
              <label className={labelClass}>Serial Port</label>
              <select
                className={selectClass}
                disabled={!scale.enabled}
                value={scale.path}
                onChange={(e) =>
                  setScale((s) => ({ ...s, path: e.target.value }))
                }
              >
                <option value="">Select port</option>
                {ports.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Baud Rate</label>
              <input
                type="number"
                className={inputClass}
                disabled={!scale.enabled}
                value={scale.baudRate}
                onChange={(e) =>
                  setScale((s) => ({ ...s, baudRate: Number(e.target.value) }))
                }
              />
            </div>
            <div>
              <label className={labelClass}>Data Bits</label>
              <input
                type="number"
                className={inputClass}
                disabled={!scale.enabled}
                value={scale.dataBits}
                onChange={(e) =>
                  setScale((s) => ({ ...s, dataBits: Number(e.target.value) }))
                }
              />
            </div>
            <div>
              <label className={labelClass}>Stop Bits</label>
              <input
                type="number"
                className={inputClass}
                disabled={!scale.enabled}
                value={scale.stopBits}
                onChange={(e) =>
                  setScale((s) => ({ ...s, stopBits: Number(e.target.value) }))
                }
              />
            </div>
            <div>
              <label className={labelClass}>Parity</label>
              <select
                className={selectClass}
                disabled={!scale.enabled}
                value={scale.parity}
                onChange={(e) =>
                  setScale((s) => ({ ...s, parity: e.target.value as Parity }))
                }
              >
                {PARITIES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">
              Label Printers (Serial)
            </h2>
            <button
              onClick={addZplSerial}
              className={`${btnSmClass} bg-blue-600 hover:bg-blue-700 text-white`}
            >
              + Add
            </button>
          </div>
          {zplSerial.length === 0 ? (
            <p className="text-sm text-gray-400">
              No serial label printers configured.
            </p>
          ) : (
            <div className="space-y-3">
              {zplSerial.map((entry, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex items-end gap-3">
                    <div className="w-24">
                      <label className={labelClass}>Language</label>
                      <select
                        className={selectClass}
                        value={entry.language}
                        onChange={(e) =>
                          updateZplSerial(i, "language", e.target.value)
                        }
                      >
                        <option value="zpl">ZPL</option>
                        <option value="slcs">SLCS</option>
                      </select>
                    </div>
                    <div className="w-24">
                      <label className={labelClass}>Media Size</label>
                      <select
                        className={selectClass}
                        value={entry.mediaSize ?? ""}
                        onChange={(e) =>
                          updateZplSerial(
                            i,
                            "mediaSize",
                            e.target.value || undefined,
                          )
                        }
                      >
                        <option value="">None</option>
                        <option value="6040">60×40</option>
                        <option value="58100">58×100</option>
                        <option value="7030">70×30</option>
                        <option value="7090">70×90</option>
                        <option value="100100">100x100</option>
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className={labelClass}>Name</label>
                      <input
                        type="text"
                        className={inputClass}
                        value={entry.name}
                        onChange={(e) =>
                          updateZplSerial(i, "name", e.target.value)
                        }
                        placeholder="Label printer 1"
                      />
                    </div>
                    <div className="flex-1">
                      <label className={labelClass}>Serial Port</label>
                      <select
                        className={selectClass}
                        value={entry.path}
                        onChange={(e) =>
                          updateZplSerial(i, "path", e.target.value)
                        }
                      >
                        <option value="">Select port</option>
                        {ports.map((p) => (
                          <option key={p} value={p}>
                            {p}
                          </option>
                        ))}
                      </select>
                    </div>
                    <button
                      onClick={() => removeZplSerial(i)}
                      className={`${btnSmClass} border border-gray-300 hover:border-red-400 hover:text-red-600 text-gray-500 mb-0.5`}
                    >
                      Remove
                    </button>
                  </div>
                  {/* Same install over the serial port — minutes rather than
                      seconds, and the port is locked for the duration, so the
                      panel never opens it without being asked. */}
                  {entry.language === "zpl" && entry.path.trim() !== "" && (
                    <ZplFontPanel
                      target={{ type: "serial", path: entry.path }}
                      mediaSize={entry.mediaSize}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">
              Label Printers (Network)
            </h2>
            <button
              onClick={addZplNet}
              className={`${btnSmClass} bg-blue-600 hover:bg-blue-700 text-white`}
            >
              + Add
            </button>
          </div>
          {zplNet.length === 0 ? (
            <p className="text-sm text-gray-400">
              No network label printers configured.
            </p>
          ) : (
            <div className="space-y-3">
              {zplNet.map((entry, i) => (
                <div key={i} className="space-y-2">
                  <div className="flex items-end gap-3">
                    <div className="w-24">
                      <label className={labelClass}>Language</label>
                      <select
                        className={selectClass}
                        value={entry.language}
                        onChange={(e) =>
                          updateZplNet(i, "language", e.target.value)
                        }
                      >
                        <option value="zpl">ZPL</option>
                        <option value="slcs">SLCS</option>
                      </select>
                    </div>
                    <div className="w-24">
                      <label className={labelClass}>Media Size</label>
                      <select
                        className={selectClass}
                        value={entry.mediaSize ?? ""}
                        onChange={(e) =>
                          updateZplNet(
                            i,
                            "mediaSize",
                            e.target.value || undefined,
                          )
                        }
                      >
                        <option value="">None</option>
                        <option value="6040">60×40</option>
                        <option value="58100">58×100</option>
                        <option value="7030">70×30</option>
                        <option value="7090">70×90</option>
                        <option value="100100">100x100</option>
                      </select>
                    </div>
                    <div className="flex-1">
                      <label className={labelClass}>Name</label>
                      <input
                        type="text"
                        className={inputClass}
                        value={entry.name}
                        onChange={(e) => updateZplNet(i, "name", e.target.value)}
                        placeholder="Label printer 1"
                      />
                    </div>
                    <div className="flex-1">
                      <label className={labelClass}>Host</label>
                      <input
                        type="text"
                        className={inputClass}
                        value={entry.host}
                        onChange={(e) => updateZplNet(i, "host", e.target.value)}
                        placeholder="192.168.1.50"
                      />
                    </div>
                    <div className="w-24">
                      <label className={labelClass}>Port</label>
                      <input
                        type="number"
                        className={inputClass}
                        value={entry.port}
                        onChange={(e) =>
                          updateZplNet(i, "port", Number(e.target.value))
                        }
                      />
                    </div>
                    <button
                      onClick={() => removeZplNet(i)}
                      className={`${btnSmClass} border border-gray-300 hover:border-red-400 hover:text-red-600 text-gray-500 mb-0.5`}
                    >
                      Remove
                    </button>
                  </div>
                  {/* Korean font install — ZPL text fields cannot print hangul
                      until the fonts are in the printer's flash. */}
                  {entry.language === "zpl" && entry.host.trim() !== "" && (
                    <ZplFontPanel
                      target={{ type: "net", host: entry.host, port: entry.port }}
                      mediaSize={entry.mediaSize}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-base font-semibold text-gray-900">
              ESC/POS Printer
            </h2>
            <Toggle
              checked={escpos.enabled}
              onChange={(v) => setEscpos((s) => ({ ...s, enabled: v }))}
            />
          </div>
          <div className="mb-4">
            <label className={labelClass}>Transport</label>
            <select
              className={selectClass}
              disabled={!escpos.enabled}
              value={escpos.type}
              onChange={(e) =>
                setEscpos((s) => ({
                  ...s,
                  type: e.target.value as EscposTransport,
                }))
              }
            >
              <option value="net">Network</option>
              <option value="serial">Serial</option>
            </select>
          </div>

          <div className="mb-4 grid grid-cols-2 gap-4">
            <div>
              <label className={labelClass}>Receipt Mode</label>
              <select
                className={selectClass}
                disabled={!escpos.enabled}
                value={escpos.receiptPrintMode}
                onChange={(e) =>
                  setEscpos((s) => ({
                    ...s,
                    receiptPrintMode: e.target.value as ReceiptPrintMode,
                  }))
                }
              >
                {RECEIPT_PRINT_MODES.map((mode) => (
                  <option key={mode.value} value={mode.value}>
                    {mode.label}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <label className={labelClass}>Text Encoding</label>
              <select
                className={selectClass}
                disabled={!escpos.enabled}
                value={escpos.receiptTextEncoding}
                onChange={(e) =>
                  setEscpos((s) => ({
                    ...s,
                    receiptTextEncoding: e.target.value as ReceiptTextEncoding,
                  }))
                }
              >
                {RECEIPT_TEXT_ENCODINGS.map((encoding) => (
                  <option key={encoding.value} value={encoding.value}>
                    {encoding.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {escpos.type === "net" ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Host</label>
                <input
                  type="text"
                  className={inputClass}
                  disabled={!escpos.enabled}
                  value={escpos.host}
                  onChange={(e) =>
                    setEscpos((s) => ({ ...s, host: e.target.value }))
                  }
                  placeholder="192.168.1.101"
                />
              </div>
              <div>
                <label className={labelClass}>Port</label>
                <input
                  type="number"
                  min={1}
                  max={65535}
                  step={1}
                  className={inputClass}
                  disabled={!escpos.enabled}
                  value={escpos.port}
                  onChange={(e) =>
                    setEscpos((s) => ({ ...s, port: Number(e.target.value) }))
                  }
                />
              </div>
            </div>
          ) : (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className={labelClass}>Serial Port</label>
                <select
                  className={selectClass}
                  disabled={!escpos.enabled}
                  value={escpos.path}
                  onChange={(e) =>
                    setEscpos((s) => ({ ...s, path: e.target.value }))
                  }
                >
                  <option value="">Select port</option>
                  {ports.map((p) => (
                    <option key={p} value={p}>
                      {p}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Baud Rate</label>
                <select
                  className={selectClass}
                  disabled={!escpos.enabled}
                  value={escpos.baudRate}
                  onChange={(e) =>
                    setEscpos((s) => ({
                      ...s,
                      baudRate: Number(e.target.value),
                    }))
                  }
                >
                  {!ESCPOS_BAUD_RATES.some(
                    (rate) => rate === escpos.baudRate,
                  ) && (
                    <option value={escpos.baudRate}>
                      {escpos.baudRate} (current)
                    </option>
                  )}
                  {ESCPOS_BAUD_RATES.map((rate) => (
                    <option key={rate} value={rate}>
                      {rate}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Data Bits</label>
                <select
                  className={selectClass}
                  disabled={!escpos.enabled}
                  value={escpos.dataBits}
                  onChange={(e) =>
                    setEscpos((s) => ({
                      ...s,
                      dataBits: Number(e.target.value) as 7 | 8,
                    }))
                  }
                >
                  {ESCPOS_DATA_BITS.map((bits) => (
                    <option key={bits} value={bits}>
                      {bits}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Parity</label>
                <select
                  className={selectClass}
                  disabled={!escpos.enabled}
                  value={escpos.parity}
                  onChange={(e) =>
                    setEscpos((s) => ({
                      ...s,
                      parity: e.target.value as EscposSerialParity,
                    }))
                  }
                >
                  {ESCPOS_PARITIES.map((parity) => (
                    <option key={parity} value={parity}>
                      {parity}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Stop Bits</label>
                <select
                  className={selectClass}
                  disabled={!escpos.enabled}
                  value={escpos.stopBits}
                  onChange={(e) =>
                    setEscpos((s) => ({
                      ...s,
                      stopBits: Number(e.target.value) as 1 | 2,
                    }))
                  }
                >
                  {ESCPOS_STOP_BITS.map((bits) => (
                    <option key={bits} value={bits}>
                      {bits}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className={labelClass}>Handshaking</label>
                <select
                  className={selectClass}
                  disabled={!escpos.enabled}
                  value={escpos.handshaking}
                  onChange={(e) =>
                    setEscpos((s) => ({
                      ...s,
                      handshaking: e.target.value as EscposSerialHandshaking,
                    }))
                  }
                >
                  {ESCPOS_HANDSHAKING.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
              <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
                <input
                  type="checkbox"
                  checked={escpos.dtr}
                  disabled={!escpos.enabled}
                  onChange={(e) =>
                    setEscpos((s) => ({ ...s, dtr: e.target.checked }))
                  }
                />
                <span className="text-sm font-medium text-gray-700">DTR on</span>
              </label>
              <label className="flex items-center gap-3 rounded-lg border border-gray-200 px-3 py-2">
                <input
                  type="checkbox"
                  checked={escpos.rts}
                  disabled={!escpos.enabled || escpos.handshaking === "rts-cts"}
                  onChange={(e) =>
                    setEscpos((s) => ({ ...s, rts: e.target.checked }))
                  }
                />
                <span className="text-sm font-medium text-gray-700">
                  RTS on
                </span>
              </label>
            </div>
          )}
          <div className="mt-4 flex items-center justify-between gap-4 border-t border-gray-100 pt-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                Serial Test
              </h3>
            </div>
            <div className="flex flex-wrap items-center justify-end gap-2">
              <button
                type="button"
                onClick={handleEscposControlLineMatrixTest}
                disabled={
                  isDiagnosticPrinting || !escpos.enabled || escpos.type !== "serial"
                }
                className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-4 py-2.5 text-sm font-medium text-slate-800 transition-colors hover:bg-slate-50 disabled:cursor-not-allowed disabled:border-gray-200 disabled:bg-gray-100 disabled:text-gray-400"
              >
                <IoPrintOutline size={18} />
                {escposMatrixTesting ? "Testing..." : "DTR/RTS Matrix"}
              </button>
              <button
                type="button"
                onClick={handleEscposSerialTestPrint}
                disabled={
                  isDiagnosticPrinting || !escpos.enabled || escpos.type !== "serial"
                }
                className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-gray-300"
              >
                <IoPrintOutline size={18} />
                {escposTestPrinting ? "Printing..." : "Print Hello World"}
              </button>
            </div>
          </div>
          {escposTestMessage && (
            <p className="mt-3 text-sm font-medium text-gray-600">
              {escposTestMessage}
            </p>
          )}
        </section>

        <div className="flex items-center gap-3">
          <button
            onClick={handleSave}
            className="bg-blue-600 hover:bg-blue-700 text-white font-medium text-sm px-6 py-2.5 rounded-lg transition-colors"
          >
            Save
          </button>
          {saved && (
            <span className="text-sm text-green-600 font-medium">Saved</span>
          )}
        </div>

        <div className="border-t border-gray-200 pt-4 text-xs text-gray-400">
          App version {appVersion || "-"}
        </div>
      </div>
    </div>
  );
}

function Toggle({
  checked,
  onChange,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-6 w-11 shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors ${checked ? "bg-blue-600" : "bg-gray-200"}`}
    >
      <span
        className={`pointer-events-none inline-block h-5 w-5 rounded-full bg-white shadow ring-0 transition-transform ${checked ? "translate-x-5" : "translate-x-0"}`}
      />
    </button>
  );
}
