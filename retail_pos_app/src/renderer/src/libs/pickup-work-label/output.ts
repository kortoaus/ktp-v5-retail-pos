import type { LabelLanguage, LabelOutput, SLCSPart } from "../label-builder";
import { type PickupWorkLabelModel } from "./model";
import {
  PICKUP_WORK_LABEL_CANVAS_SIZE,
  renderPickupWorkLabel,
} from "./render";

export const PICKUP_WORK_LABEL_BLACK_THRESHOLD = 220;
export const PICKUP_WORK_LABEL_SLCS_SLICE_HEIGHT = 256;

export interface PickupWorkLabelMonoRaster {
  width: number;
  height: number;
  widthBytes: number;
  data: Uint8Array;
}

export function canvasToPickupWorkLabelMonoRaster(
  canvas: HTMLCanvasElement,
): PickupWorkLabelMonoRaster {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas context");

  const width = canvas.width;
  const height = canvas.height;
  const widthBytes = Math.ceil(width / 8);
  const pixels = ctx.getImageData(0, 0, width, height).data;
  const data = new Uint8Array(widthBytes * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const alpha = pixels[idx + 3] / 255;
      const red = pixels[idx] * alpha + 255 * (1 - alpha);
      const green = pixels[idx + 1] * alpha + 255 * (1 - alpha);
      const blue = pixels[idx + 2] * alpha + 255 * (1 - alpha);
      const gray = 0.299 * red + 0.587 * green + 0.114 * blue;

      if (gray < PICKUP_WORK_LABEL_BLACK_THRESHOLD) {
        const byteIdx = y * widthBytes + Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        data[byteIdx] |= 1 << bitIdx;
      }
    }
  }

  return { width, height, widthBytes, data };
}

export function buildPickupWorkLabelZplGraphicLabel(
  raster: PickupWorkLabelMonoRaster,
): string {
  const totalBytes = raster.data.length;
  let hex = "";
  for (const byte of raster.data) {
    hex += byte.toString(16).padStart(2, "0").toUpperCase();
  }

  return `^XA^PW${raster.width}^LL${raster.height}^FO0,0^GFA,${totalBytes},${totalBytes},${raster.widthBytes},${hex}^FS^XZ`;
}

export function buildPickupWorkLabelSlcsGraphicLabel(
  raster: PickupWorkLabelMonoRaster,
): SLCSPart[] {
  const parts: SLCSPart[] = [
    {
      type: "raw",
      data: `@\r\nCB\r\nSW${raster.width}\r\nSL${raster.height}\r\n`,
    },
  ];

  for (
    let sliceTop = 0;
    sliceTop < raster.height;
    sliceTop += PICKUP_WORK_LABEL_SLCS_SLICE_HEIGHT
  ) {
    const sliceHeight = Math.min(
      PICKUP_WORK_LABEL_SLCS_SLICE_HEIGHT,
      raster.height - sliceTop,
    );
    const sliceStart = sliceTop * raster.widthBytes;
    const sliceEnd = sliceStart + sliceHeight * raster.widthBytes;
    const header = [
      0x4c,
      0x44,
      0,
      0,
      sliceTop & 0xff,
      (sliceTop >> 8) & 0xff,
      raster.widthBytes & 0xff,
      (raster.widthBytes >> 8) & 0xff,
      sliceHeight & 0xff,
      (sliceHeight >> 8) & 0xff,
    ];

    parts.push({
      type: "bytes",
      data: [...header, ...Array.from(raster.data.slice(sliceStart, sliceEnd))],
    });
  }

  parts.push({ type: "raw", data: "P1\r\n" });
  return parts;
}

export async function buildPickupWorkLabelOutput(
  labelLanguage: LabelLanguage,
  model: PickupWorkLabelModel,
): Promise<LabelOutput> {
  const canvas = document.createElement("canvas");
  canvas.width = PICKUP_WORK_LABEL_CANVAS_SIZE;
  canvas.height = PICKUP_WORK_LABEL_CANVAS_SIZE;

  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas context");

  await renderPickupWorkLabel(ctx, model);
  const raster = canvasToPickupWorkLabelMonoRaster(canvas);

  if (labelLanguage === "zpl") {
    return {
      language: "zpl",
      data: buildPickupWorkLabelZplGraphicLabel(raster),
    };
  }

  return {
    language: "slcs",
    parts: buildPickupWorkLabelSlcsGraphicLabel(raster),
  };
}
