import type { Item } from "../../types/models";
import { type LabelLanguage, type LabelOutput } from "../label-builder";
import {
  buildSlcsGraphicLabel,
  buildZplGraphicLabel,
  canvasToMonoRaster,
} from "./canvas-raster";
import { getPriceTag7090Model } from "./price-model";
import { renderPriceTag7090Canvas } from "./render";

export async function buildPriceTag7090V2(
  labelLanguage: LabelLanguage,
  item: Item,
): Promise<LabelOutput> {
  const model = getPriceTag7090Model(item);
  const canvas = await renderPriceTag7090Canvas(model);
  const raster = canvasToMonoRaster(canvas);

  if (labelLanguage === "zpl") {
    return { language: "zpl", data: buildZplGraphicLabel(raster) };
  }

  return { language: "slcs", parts: buildSlcsGraphicLabel(raster) };
}

export { getPriceTag7090Model, renderPriceTag7090Canvas };
