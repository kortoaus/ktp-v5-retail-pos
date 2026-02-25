const ESC = 0x1b;
const GS = 0x1d;

const BLACK_THRESHOLD = 220;

export const canvasToEscposRaster = (canvas: HTMLCanvasElement): Uint8Array => {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas context");

  const width = canvas.width;
  const height = canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;

  const widthBytes = Math.ceil(width / 8);
  const rasterData = new Uint8Array(widthBytes * height);

  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = (y * width + x) * 4;
      const r = pixels[idx];
      const g = pixels[idx + 1];
      const b = pixels[idx + 2];
      const gray = 0.299 * r + 0.587 * g + 0.114 * b;
      const isBlack = gray < BLACK_THRESHOLD;

      if (isBlack) {
        const byteIdx = y * widthBytes + Math.floor(x / 8);
        const bitIdx = 7 - (x % 8);
        rasterData[byteIdx] |= 1 << bitIdx;
      }
    }
  }

  const xL = widthBytes & 0xff;
  const xH = (widthBytes >> 8) & 0xff;
  const yL = height & 0xff;
  const yH = (height >> 8) & 0xff;

  const command = new Uint8Array(8 + rasterData.length);
  command[0] = GS;
  command[1] = 0x76;
  command[2] = 0x30;
  command[3] = 0;
  command[4] = xL;
  command[5] = xH;
  command[6] = yL;
  command[7] = yH;
  command.set(rasterData, 8);

  return command;
};

export const kickDrawerPin2 = (): Uint8Array => {
  return new Uint8Array([ESC, 0x70, 0x00, 0x19, 0xfa]);
};

export const kickDrawerPin5 = (): Uint8Array => {
  return new Uint8Array([ESC, 0x70, 0x01, 0x19, 0xfa]);
};

export const cutCommand = (feed: number = 3): Uint8Array => {
  return new Uint8Array([GS, 0x56, 0x42, feed]);
};

export const initPrinterCommand = (): Uint8Array => {
  return new Uint8Array([ESC, 0x40]);
};

export const buildPrintBuffer = (canvas: HTMLCanvasElement): Uint8Array => {
  const init = initPrinterCommand();
  const raster = canvasToEscposRaster(canvas);
  const cut = cutCommand(3);

  const buffer = new Uint8Array(init.length + raster.length + cut.length);
  let offset = 0;
  buffer.set(init, offset);
  offset += init.length;
  buffer.set(raster, offset);
  offset += raster.length;
  buffer.set(cut, offset);

  return buffer;
};

export const buildPrintBufferNoCut = (canvas: HTMLCanvasElement): Uint8Array => {
  const init = initPrinterCommand();
  const raster = canvasToEscposRaster(canvas);
  const buffer = new Uint8Array(init.length + raster.length);
  buffer.set(init, 0);
  buffer.set(raster, init.length);
  return buffer;
};
