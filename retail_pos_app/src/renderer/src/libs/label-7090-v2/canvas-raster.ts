import type { SLCSPart } from "../label-builder";
import {
  LABEL_7090_BLACK_THRESHOLD,
  LABEL_7090_SLCS_SLICE_HEIGHT,
  type MonoRaster,
} from "./types";

export function canvasToMonoRaster(canvas: HTMLCanvasElement): MonoRaster {
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
      const gray =
        0.299 * red +
        0.587 * green +
        0.114 * blue;
      if (gray < LABEL_7090_BLACK_THRESHOLD) {
        const byteIdx = y * widthBytes + Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        data[byteIdx] |= 1 << bitIdx;
      }
    }
  }

  return { width, height, widthBytes, data };
}

export function buildZplGraphicLabel(raster: MonoRaster): string {
  const totalBytes = raster.data.length;
  let hex = "";
  for (const byte of raster.data) {
    hex += byte.toString(16).padStart(2, "0").toUpperCase();
  }

  return `^XA^PW${raster.width}^LL${raster.height}^FO0,0^GFA,${totalBytes},${totalBytes},${raster.widthBytes},${hex}^FS^XZ`;
}

export function buildSlcsGraphicLabel(raster: MonoRaster): SLCSPart[] {
  const parts: SLCSPart[] = [
    { type: "raw", data: "@\r\nCB\r\nSW560\r\nSL720\r\n" },
  ];

  for (
    let sliceTop = 0;
    sliceTop < raster.height;
    sliceTop += LABEL_7090_SLCS_SLICE_HEIGHT
  ) {
    const sliceHeight = Math.min(
      LABEL_7090_SLCS_SLICE_HEIGHT,
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
