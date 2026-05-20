import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import bwipjs from "bwip-js/browser";
import QRCode from "qrcode";
import { cn } from "../libs/cn";
import {
  BARCODE_TYPES,
  buildBarcodeSlipEscpos,
  normalizeBarcodeValue,
  type BarcodeSlipType,
} from "../libs/printer/barcode-slip-escpos";
import { printESCPOS } from "../libs/printer/print.service";

const TYPE_LABEL: Record<BarcodeSlipType, string> = {
  datamatrix: "DataMatrix",
  qrcode: "QR Code",
  code128: "Code128",
};

export default function BarcodePrintScreen() {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [value, setValue] = useState("");
  const [type, setType] = useState<BarcodeSlipType>("qrcode");
  const [previewError, setPreviewError] = useState("");
  const [printing, setPrinting] = useState(false);

  const normalizedValue = useMemo(() => normalizeBarcodeValue(value), [value]);
  const canPrint = normalizedValue.length > 0 && !previewError && !printing;

  useEffect(() => {
    let cancelled = false;

    async function renderPreview() {
      const canvas = canvasRef.current;
      if (!canvas) return;

      const ctx = canvas.getContext("2d");
      if (!ctx) return;

      canvas.width = 320;
      canvas.height = 260;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      setPreviewError("");

      if (!normalizedValue) {
        ctx.fillStyle = "#9ca3af";
        ctx.font = "18px sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          "Enter text to preview",
          canvas.width / 2,
          canvas.height / 2,
        );
        return;
      }

      try {
        if (type === "qrcode") {
          await QRCode.toCanvas(canvas, normalizedValue, {
            errorCorrectionLevel: "M",
            margin: 2,
            width: 260,
            color: { dark: "#000000", light: "#ffffff" },
          });
        } else {
          await bwipjs.toCanvas(canvas, {
            bcid: type === "datamatrix" ? "datamatrix" : "code128",
            text: normalizedValue,
            scale: type === "datamatrix" ? 5 : 3,
            height: type === "code128" ? 26 : 18,
            includetext: false,
            paddingwidth: 8,
            paddingheight: 8,
            backgroundcolor: "FFFFFF",
          });
        }

        if (!cancelled) setPreviewError("");
      } catch (err) {
        if (!cancelled) {
          setPreviewError(
            err instanceof Error ? err.message : "Failed to render preview",
          );
        }
      }
    }

    renderPreview();

    return () => {
      cancelled = true;
    };
  }, [normalizedValue, type]);

  const handlePrint = async () => {
    if (!canPrint) return;

    setPrinting(true);
    try {
      const data = buildBarcodeSlipEscpos({ type, value: normalizedValue });
      await printESCPOS(data);
    } catch (err) {
      window.alert(
        err instanceof Error ? err.message : "Failed to print barcode",
      );
    } finally {
      setPrinting(false);
    }
  };

  return (
    <div className="h-full w-full bg-gray-100 flex flex-col">
      <div className="h-16 flex items-center gap-4 px-4 border-b border-gray-200 bg-white">
        <Link
          to="/"
          className="text-sm text-blue-600 hover:text-blue-800 font-medium"
        >
          &larr; Back
        </Link>
        <h1 className="text-lg font-semibold text-gray-900">Barcode Print</h1>
      </div>

      <div className="flex-1 grid grid-cols-[minmax(320px,420px)_1fr] gap-4 p-4">
        <section className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-4">
          <label className="flex flex-col gap-2">
            <span className="text-xs font-bold text-gray-500 uppercase">
              Text
            </span>
            <textarea
              value={value}
              onChange={(event) => setValue(event.target.value)}
              className="min-h-36 rounded-lg border border-gray-300 px-3 py-2 text-lg text-gray-900 outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 resize-none"
              autoFocus
            />
          </label>

          <div className="flex flex-col gap-2">
            <span className="text-xs font-bold text-gray-500 uppercase">
              Barcode Type
            </span>
            <div className="grid grid-cols-3 gap-2">
              {BARCODE_TYPES.map((item) => (
                <button
                  key={item}
                  type="button"
                  onPointerDown={() => setType(item)}
                  className={cn(
                    "h-12 rounded-lg border text-sm font-semibold transition-colors",
                    type === item
                      ? "border-blue-500 bg-blue-50 text-blue-700"
                      : "border-gray-200 bg-white text-gray-600 hover:bg-gray-50",
                  )}
                >
                  {TYPE_LABEL[item]}
                </button>
              ))}
            </div>
          </div>

          <button
            type="button"
            disabled={!canPrint}
            onPointerDown={handlePrint}
            className={cn(
              "mt-auto h-14 rounded-lg text-base font-bold transition-colors",
              canPrint
                ? "bg-blue-600 text-white hover:bg-blue-700"
                : "bg-gray-200 text-gray-400",
            )}
          >
            {printing ? "Printing..." : "Print"}
          </button>
        </section>

        <section className="bg-white border border-gray-200 rounded-lg p-4 flex flex-col gap-3">
          <div className="flex items-center justify-between">
            <span className="text-xs font-bold text-gray-500 uppercase">
              Preview
            </span>
            <span className="text-sm font-medium text-gray-500">
              {TYPE_LABEL[type]}
            </span>
          </div>

          <div className="flex-1 min-h-0 rounded-lg border border-gray-200 bg-gray-50 flex items-center justify-center p-6">
            <div className="bg-white border border-gray-200 rounded-lg p-8 flex flex-col items-center gap-5">
              <canvas
                ref={canvasRef}
                width={320}
                height={260}
                className="max-w-full h-auto"
              />
              <div className="w-80 max-w-full text-center text-base font-medium text-gray-900 break-words">
                {normalizedValue || "-"}
              </div>
            </div>
          </div>

          {previewError && (
            <div className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
              {previewError}
            </div>
          )}
        </section>
      </div>
    </div>
  );
}
