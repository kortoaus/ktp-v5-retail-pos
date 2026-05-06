const ESC = 0x1b;
const GS = 0x1d;

const BLACK_THRESHOLD = 220;
const MAX_RASTER_SLICE_HEIGHT = 512;

function buildRasterCommand(
  widthBytes: number,
  height: number,
  rasterData: Uint8Array,
): Uint8Array {
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
}

export const canvasToEscposRaster = (canvas: HTMLCanvasElement): Uint8Array => {
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("No canvas context");

  const width = canvas.width;
  const height = canvas.height;
  const imageData = ctx.getImageData(0, 0, width, height);
  const pixels = imageData.data;

  const widthBytes = Math.ceil(width / 8);
  const commands: Uint8Array[] = [];
  let totalLength = 0;

  for (
    let sliceTop = 0;
    sliceTop < height;
    sliceTop += MAX_RASTER_SLICE_HEIGHT
  ) {
    const sliceHeight = Math.min(MAX_RASTER_SLICE_HEIGHT, height - sliceTop);
    const rasterData = new Uint8Array(widthBytes * sliceHeight);

    for (let localY = 0; localY < sliceHeight; localY++) {
      const y = sliceTop + localY;
      for (let x = 0; x < width; x++) {
        const idx = (y * width + x) * 4;
        const r = pixels[idx];
        const g = pixels[idx + 1];
        const b = pixels[idx + 2];
        const gray = 0.299 * r + 0.587 * g + 0.114 * b;
        const isBlack = gray < BLACK_THRESHOLD;

        if (isBlack) {
          const byteIdx = localY * widthBytes + Math.floor(x / 8);
          const bitIdx = 7 - (x % 8);
          rasterData[byteIdx] |= 1 << bitIdx;
        }
      }
    }

    const command = buildRasterCommand(widthBytes, sliceHeight, rasterData);
    commands.push(command);
    totalLength += command.length;
  }

  const buffer = new Uint8Array(totalLength);
  let offset = 0;
  for (const command of commands) {
    buffer.set(command, offset);
    offset += command.length;
  }
  return buffer;
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

// 여러 canvas 를 **한 번의 전송**으로 연속 출력. 마지막에 cut 한 번만.
//   [init] [raster1] [raster2] ... [rasterN] [cut]
// 용도: 원본 SALE + 그 REFUND children 을 물리적으로 한 strip 으로 묶어
//       잘려 나오지 않게 출력. 별도 print 호출로 하면 서버 지연/feed 때문에
//       strip 이 분리될 수 있음.
export const buildMultiReceiptBuffer = (
  canvases: HTMLCanvasElement[],
): Uint8Array => {
  if (canvases.length === 0) return new Uint8Array(0);
  if (canvases.length === 1) return buildPrintBuffer(canvases[0]);

  const init = initPrinterCommand();
  const rasters = canvases.map(canvasToEscposRaster);
  const cut = cutCommand(3);

  const totalLen =
    init.length + rasters.reduce((s, r) => s + r.length, 0) + cut.length;
  const buffer = new Uint8Array(totalLen);
  let offset = 0;
  buffer.set(init, offset);
  offset += init.length;
  for (const raster of rasters) {
    buffer.set(raster, offset);
    offset += raster.length;
  }
  buffer.set(cut, offset);
  return buffer;
};
