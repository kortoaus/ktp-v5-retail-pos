import bwipjs from "bwip-js/browser";
import { DATAMATRIX_SIZE_PX } from "./types";

export async function drawDataMatrix(
  ctx: CanvasRenderingContext2D,
  data: string,
  x: number,
  y: number,
  size = DATAMATRIX_SIZE_PX,
): Promise<void> {
  const matrixCanvas = document.createElement("canvas");
  matrixCanvas.width = size;
  matrixCanvas.height = size;

  await bwipjs.toCanvas(matrixCanvas, {
    bcid: "datamatrix",
    text: data,
    scale: 4,
    width: size,
    height: size,
    paddingwidth: 0,
    paddingheight: 0,
    backgroundcolor: "FFFFFF",
  });

  ctx.imageSmoothingEnabled = false;
  ctx.drawImage(matrixCanvas, x, y, size, size);
}
