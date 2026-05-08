import { useEffect, useState, useCallback } from "react";
import { Link } from "react-router-dom";
import { IoPrintOutline } from "react-icons/io5";
import { useUser } from "../contexts/UserContext";
import hasScope from "../libs/scope-utils";
import BlockScreen from "../components/BlockScreen";
import {
  buildGraphicPriceTagSample7090,
  buildKoreanVectorFontTest7090,
} from "../libs/label-templates";
import { buildPriceTag7090V2 } from "../libs/label-7090-v2";
import type { Item } from "../types/models";
import { useStoreSetting } from "../hooks/useStoreSetting";

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
type MediaSize = "7030" | "7090";

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

interface EscposForm {
  enabled: boolean;
  type: EscposTransport;
  host: string;
  port: number;
  path: string;
  baudRate: number;
}

type LabelTestPrinter =
  | {
      type: "serial";
      name: string;
      language: LabelLanguage;
      path: string;
    }
  | {
      type: "net";
      name: string;
      language: LabelLanguage;
      host: string;
      port: number;
    };

const LABEL_V2_FIXTURE_DATE = "2026-05-06T00:00:00.000Z";

const LABEL_V2_FIXTURE_ITEMS = [
  {
    id: 9001,
    companyId: 1,
    name_en: "Premium Rice Crackers",
    name_ko: "프리미엄 쌀과자",
    name_invoice: null,
    barcode: "9300000000011",
    code: "V2-NG",
    thumb: null,
    barcodeGTIN: "9300000000011",
    barcodePLU: null,
    barcodeType: "GTIN",
    uom: "ea",
    defaultRFD: "R",
    isScale: false,
    isBundle: false,
    useBatch: false,
    archived: false,
    bundleQty: 1,
    parentId: null,
    brandId: null,
    brand: null,
    categoryIds: [],
    categoryMarks: [],
    taxable: true,
    wholesaleTaxable: true,
    isPointExcluded: false,
    scaleData: null,
    createdAt: LABEL_V2_FIXTURE_DATE,
    updatedAt: LABEL_V2_FIXTURE_DATE,
    isTemporary: false,
    price: {
      id: 9101,
      companyId: 1,
      itemId: 9001,
      priceType: "DEFAULT",
      prices: [499],
      createdAt: LABEL_V2_FIXTURE_DATE,
      updatedAt: LABEL_V2_FIXTURE_DATE,
      archived: false,
      markup: 0,
    },
    promoPrice: null,
  },
  {
    id: 9002,
    companyId: 1,
    name_en: "Roasted Seaweed Snack",
    name_ko: "구운 김스낵",
    name_invoice: null,
    barcode: "9300000000028",
    code: "V2-NM",
    thumb: null,
    barcodeGTIN: "9300000000028",
    barcodePLU: null,
    barcodeType: "GTIN",
    uom: "pack",
    defaultRFD: "R",
    isScale: false,
    isBundle: false,
    useBatch: false,
    archived: false,
    bundleQty: 1,
    parentId: null,
    brandId: 7101,
    brand: {
      id: 7101,
      name_en: "KTP Market",
      name_ko: "케이티피 마켓",
      archived: false,
      companyId: 1,
      createdAt: LABEL_V2_FIXTURE_DATE,
      updatedAt: LABEL_V2_FIXTURE_DATE,
      itemCount: 1,
    },
    categoryIds: [],
    categoryMarks: [],
    taxable: true,
    wholesaleTaxable: true,
    isPointExcluded: false,
    scaleData: null,
    createdAt: LABEL_V2_FIXTURE_DATE,
    updatedAt: LABEL_V2_FIXTURE_DATE,
    isTemporary: false,
    price: {
      id: 9102,
      companyId: 1,
      itemId: 9002,
      priceType: "DEFAULT",
      prices: [699, 599],
      createdAt: LABEL_V2_FIXTURE_DATE,
      updatedAt: LABEL_V2_FIXTURE_DATE,
      archived: false,
      markup: 0,
    },
    promoPrice: null,
  },
  {
    id: 9003,
    companyId: 1,
    name_en: "Honey Citron Tea",
    name_ko: "꿀 유자차",
    name_invoice: null,
    barcode: "9300000000035",
    code: "V2-PG",
    thumb: null,
    barcodeGTIN: "9300000000035",
    barcodePLU: null,
    barcodeType: "GTIN",
    uom: "jar",
    defaultRFD: "R",
    isScale: false,
    isBundle: false,
    useBatch: false,
    archived: false,
    bundleQty: 1,
    parentId: null,
    brandId: null,
    brand: null,
    categoryIds: [],
    categoryMarks: [],
    taxable: true,
    wholesaleTaxable: true,
    isPointExcluded: false,
    scaleData: null,
    createdAt: LABEL_V2_FIXTURE_DATE,
    updatedAt: LABEL_V2_FIXTURE_DATE,
    isTemporary: false,
    price: {
      id: 9103,
      companyId: 1,
      itemId: 9003,
      priceType: "DEFAULT",
      prices: [1299],
      createdAt: LABEL_V2_FIXTURE_DATE,
      updatedAt: LABEL_V2_FIXTURE_DATE,
      archived: false,
      markup: 0,
    },
    promoPrice: {
      id: 9203,
      companyId: 1,
      itemId: 9003,
      priceType: "PROMO",
      prices: [999],
      validFrom: "2026-05-01T00:00:00.000Z",
      validTo: "2026-05-31T23:59:59.000Z",
      archived: false,
      createdAt: LABEL_V2_FIXTURE_DATE,
      updatedAt: LABEL_V2_FIXTURE_DATE,
      name_en: "May Special",
      name_ko: "5월 특가",
    },
  },
  {
    id: 9004,
    companyId: 1,
    name_en: "Korean Pear Juice",
    name_ko: "배 주스",
    name_invoice: null,
    barcode: "9300000000042",
    code: "V2-PM",
    thumb: null,
    barcodeGTIN: "9300000000042",
    barcodePLU: null,
    barcodeType: "GTIN",
    uom: "box",
    defaultRFD: "R",
    isScale: false,
    isBundle: false,
    useBatch: false,
    archived: false,
    bundleQty: 1,
    parentId: null,
    brandId: null,
    brand: null,
    categoryIds: [],
    categoryMarks: [],
    taxable: true,
    wholesaleTaxable: true,
    isPointExcluded: false,
    scaleData: null,
    createdAt: LABEL_V2_FIXTURE_DATE,
    updatedAt: LABEL_V2_FIXTURE_DATE,
    isTemporary: false,
    price: {
      id: 9104,
      companyId: 1,
      itemId: 9004,
      priceType: "DEFAULT",
      prices: [1899, 1699],
      createdAt: LABEL_V2_FIXTURE_DATE,
      updatedAt: LABEL_V2_FIXTURE_DATE,
      archived: false,
      markup: 0,
    },
    promoPrice: {
      id: 9204,
      companyId: 1,
      itemId: 9004,
      priceType: "PROMO",
      prices: [1599, 1499],
      validFrom: "2026-05-01T00:00:00.000Z",
      validTo: "2026-05-31T23:59:59.000Z",
      archived: false,
      createdAt: LABEL_V2_FIXTURE_DATE,
      updatedAt: LABEL_V2_FIXTURE_DATE,
      name_en: "Member Promo",
      name_ko: "회원 특가",
    },
  },
] satisfies Item[];

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
  baudRate: 115200,
};

const PARITIES: Parity[] = ["none", "even", "odd", "mark", "space"];

const inputClass =
  "w-full border border-gray-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent disabled:bg-gray-100 disabled:text-gray-400";
const selectClass = inputClass;
const labelClass = "block text-sm font-medium text-gray-700 mb-1";
const btnSmClass =
  "text-xs font-medium px-3 py-1.5 rounded-lg transition-colors";

export default function InterfaceSettingsScreen() {
  const { user, loading: userLoading } = useUser();
  const { storeSetting } = useStoreSetting();
  const [ports, setPorts] = useState<string[]>([]);
  const [scale, setScale] = useState<ScaleForm>(SCALE_DEFAULTS);
  const [zplSerial, setZplSerial] = useState<ZplSerialEntry[]>([]);
  const [zplNet, setZplNet] = useState<ZplNetEntry[]>([]);
  const [escpos, setEscpos] = useState<EscposForm>(ESCPOS_DEFAULTS);
  const [appVersion, setAppVersion] = useState("");
  const [saved, setSaved] = useState(false);
  const [labelTestPrinting, setLabelTestPrinting] = useState(false);
  const [labelTestMessage, setLabelTestMessage] = useState("");
  const [graphicTestPrinting, setGraphicTestPrinting] = useState(false);
  const [graphicTestMessage, setGraphicTestMessage] = useState("");
  const [graphicV2TestPrinting, setGraphicV2TestPrinting] = useState(false);
  const [graphicV2TestMessage, setGraphicV2TestMessage] = useState("");
  const isDiagnosticPrinting =
    labelTestPrinting || graphicTestPrinting || graphicV2TestPrinting;
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
          enabled: true,
          type: printer.type,
          ...(printer.type === "net"
            ? { host: printer.host, port: printer.port }
            : { path: printer.path, baudRate: printer.baudRate }),
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
      | { type: "serial"; path: string; baudRate: number }
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
      },
    });

    await window.electronAPI.scaleDisconnect();
    if (scale.enabled) {
      await window.electronAPI.scaleConnect();
    }

    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
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

  const getKoreanVectorTestPrinter = (): LabelTestPrinter | null => {
    const serialTargets: LabelTestPrinter[] = zplSerial
      .filter(
        (entry) =>
          entry.language === "slcs" &&
          entry.mediaSize === "7090" &&
          entry.path.trim() !== "",
      )
      .map((entry) => ({
        type: "serial",
        name: entry.name || entry.path,
        language: entry.language,
        path: entry.path,
      }));

    const netTargets: LabelTestPrinter[] = zplNet
      .filter(
        (entry) =>
          entry.language === "slcs" &&
          entry.mediaSize === "7090" &&
          entry.host.trim() !== "",
      )
      .map((entry) => ({
        type: "net",
        name: entry.name || `${entry.host}:${entry.port}`,
        language: entry.language,
        host: entry.host,
        port: entry.port,
      }));

    return [...serialTargets, ...netTargets][0] ?? null;
  };

  const getGraphicTestPrinter = (): LabelTestPrinter | null => {
    const serialTargets: LabelTestPrinter[] = zplSerial
      .filter((entry) => entry.mediaSize === "7090" && entry.path.trim() !== "")
      .map((entry) => ({
        type: "serial",
        name: entry.name || entry.path,
        language: entry.language,
        path: entry.path,
      }));

    const netTargets: LabelTestPrinter[] = zplNet
      .filter((entry) => entry.mediaSize === "7090" && entry.host.trim() !== "")
      .map((entry) => ({
        type: "net",
        name: entry.name || `${entry.host}:${entry.port}`,
        language: entry.language,
        host: entry.host,
        port: entry.port,
      }));

    return [...serialTargets, ...netTargets][0] ?? null;
  };

  const handleKoreanVectorTestPrint = async () => {
    if (isDiagnosticPrinting) return;

    const printer = getKoreanVectorTestPrinter();
    if (!printer) {
      setLabelTestMessage("No 70x90 SLCS printer found for destination [0].");
      return;
    }

    setLabelTestPrinting(true);
    setLabelTestMessage("");

    try {
      const result = await window.electronAPI.printLabel({
        printer: {
          type: printer.type,
          path: printer.type === "serial" ? printer.path : undefined,
          host: printer.type === "net" ? printer.host : undefined,
          port: printer.type === "net" ? printer.port : undefined,
        },
        label: buildKoreanVectorFontTest7090(),
      });

      setLabelTestMessage(
        result.ok
          ? `Sent 70x90 price tag samples to ${printer.name}.`
          : result.message,
      );
    } catch (err) {
      setLabelTestMessage(err instanceof Error ? err.message : "Print failed.");
    } finally {
      setLabelTestPrinting(false);
    }
  };

  const handleGraphicTestPrint = async () => {
    if (isDiagnosticPrinting) return;

    const printer = getGraphicTestPrinter();
    if (!printer) {
      setGraphicTestMessage("No 70x90 printer found for destination [0].");
      return;
    }

    setGraphicTestPrinting(true);
    setGraphicTestMessage("");

    const printerTarget = {
      type: printer.type,
      path: printer.type === "serial" ? printer.path : undefined,
      host: printer.type === "net" ? printer.host : undefined,
      port: printer.type === "net" ? printer.port : undefined,
    };

    try {
      const zplLabel = await buildGraphicPriceTagSample7090("zpl");
      const zplResult = await window.electronAPI.printLabel({
        printer: printerTarget,
        label: zplLabel,
      });
      if (!zplResult.ok) {
        setGraphicTestMessage(`ZPL failed: ${zplResult.message}`);
        return;
      }

      const slcsLabel = await buildGraphicPriceTagSample7090("slcs");
      const slcsResult = await window.electronAPI.printLabel({
        printer: printerTarget,
        label: slcsLabel,
      });
      if (!slcsResult.ok) {
        setGraphicTestMessage(`SLCS failed: ${slcsResult.message}`);
        return;
      }

      setGraphicTestMessage(`Sent graphic ZPL + SLCS samples to ${printer.name}.`);
    } catch (err) {
      setGraphicTestMessage(err instanceof Error ? err.message : "Print failed.");
    } finally {
      setGraphicTestPrinting(false);
    }
  };

  const handleGraphicV2TestPrint = async () => {
    if (isDiagnosticPrinting) return;

    const printer = getGraphicTestPrinter();
    if (!printer) {
      setGraphicV2TestMessage("No 70x90 printer found for destination [0].");
      return;
    }

    setGraphicV2TestPrinting(true);
    setGraphicV2TestMessage("");

    const printerTarget = {
      type: printer.type,
      path: printer.type === "serial" ? printer.path : undefined,
      host: printer.type === "net" ? printer.host : undefined,
      port: printer.type === "net" ? printer.port : undefined,
    };

    try {
      for (const fixture of LABEL_V2_FIXTURE_ITEMS) {
        const label = await buildPriceTag7090V2(printer.language, fixture, {
          storeName: storeSetting?.name,
        });
        const result = await window.electronAPI.printLabel({
          printer: printerTarget,
          label,
        });

        if (!result.ok) {
          setGraphicV2TestMessage(`${fixture.code ?? fixture.barcode} failed: ${result.message}`);
          return;
        }
      }

      setGraphicV2TestMessage(
        `Sent 4 graphic v2 labels to ${printer.name}.`,
      );
    } catch (err) {
      setGraphicV2TestMessage(err instanceof Error ? err.message : "Print failed.");
    } finally {
      setGraphicV2TestPrinting(false);
    }
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
                <div key={i} className="flex items-end gap-3">
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
                      <option value="7030">70×30</option>
                      <option value="7090">70×90</option>
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
                <div key={i} className="flex items-end gap-3">
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
                      <option value="7030">70×30</option>
                      <option value="7090">70×90</option>
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
              ))}
            </div>
          )}
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <div className="flex items-center justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-gray-900">
                Label Printer Test
              </h2>
              <p className="mt-1 text-sm text-gray-500">
                Prints 70x90 SLCS price tag samples on the first 70x90 SLCS printer.
              </p>
            </div>
            <button
              type="button"
              onClick={handleKoreanVectorTestPrint}
              disabled={isDiagnosticPrinting}
              className="inline-flex items-center gap-2 rounded-lg bg-slate-800 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-slate-900 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              <IoPrintOutline size={18} />
              {labelTestPrinting ? "Printing..." : "Print 70x90 Samples [0]"}
            </button>
          </div>
          {labelTestMessage && (
            <p className="mt-3 text-sm font-medium text-gray-600">
              {labelTestMessage}
            </p>
          )}
          <div className="mt-4 flex items-center justify-between gap-4 border-t border-gray-100 pt-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                Graphic Raster Test
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                Prints one ZPL graphic label and one SLCS graphic label to the first 70x90 printer.
              </p>
            </div>
            <button
              type="button"
              onClick={handleGraphicTestPrint}
              disabled={isDiagnosticPrinting}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              <IoPrintOutline size={18} />
              {graphicTestPrinting ? "Printing..." : "Print Graphic ZPL+SLCS [0]"}
            </button>
          </div>
          {graphicTestMessage && (
            <p className="mt-3 text-sm font-medium text-gray-600">
              {graphicTestMessage}
            </p>
          )}
          <div className="mt-4 flex items-center justify-between gap-4 border-t border-gray-100 pt-4">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">
                Graphic Raster V2 Test
              </h3>
              <p className="mt-1 text-sm text-gray-500">
                Prints four data-driven 70x90 labels with a real 54px Data Matrix to the first 70x90 printer.
              </p>
            </div>
            <button
              type="button"
              onClick={handleGraphicV2TestPrint}
              disabled={isDiagnosticPrinting}
              className="inline-flex items-center gap-2 rounded-lg bg-emerald-700 px-4 py-2.5 text-sm font-medium text-white transition-colors hover:bg-emerald-800 disabled:cursor-not-allowed disabled:bg-gray-300"
            >
              <IoPrintOutline size={18} />
              {graphicV2TestPrinting ? "Printing..." : "Print 70x90 V2 [0]"}
            </button>
          </div>
          {graphicV2TestMessage && (
            <p className="mt-3 text-sm font-medium text-gray-600">
              {graphicV2TestMessage}
            </p>
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
                <input
                  type="number"
                  min={1}
                  max={1000000}
                  step={1}
                  className={inputClass}
                  disabled={!escpos.enabled}
                  value={escpos.baudRate}
                  onChange={(e) =>
                    setEscpos((s) => ({
                      ...s,
                      baudRate: Number(e.target.value),
                    }))
                  }
                />
              </div>
            </div>
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
