import { useEffect, useMemo, useRef } from "react";

import {
  buildPickupWorkLabelModel,
  type PickupWorkLabelModel,
} from "../../libs/pickup-work-label/model";
import {
  PICKUP_WORK_LABEL_CANVAS_SIZE,
  renderPickupWorkLabel,
} from "../../libs/pickup-work-label/render";
import type {
  PickupOrderDetail,
  PickupOrderLine,
} from "./pickup-order-types";

type Props = {
  order: PickupOrderDetail;
  line: PickupOrderLine;
};

export default function PickupOrderWorkLabelPreview({ order, line }: Props) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const model = useMemo<PickupWorkLabelModel>(
    () => buildPickupWorkLabelModel(order, line),
    [order, line],
  );

  useEffect(() => {
    let cancelled = false;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!ctx) return undefined;

    const offscreenCanvas = document.createElement("canvas");
    offscreenCanvas.width = PICKUP_WORK_LABEL_CANVAS_SIZE;
    offscreenCanvas.height = PICKUP_WORK_LABEL_CANVAS_SIZE;
    const offscreenCtx = offscreenCanvas.getContext("2d");
    if (!offscreenCtx) return undefined;

    void renderPickupWorkLabel(offscreenCtx, model)
      .then(() => {
        if (cancelled) return;

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(
          0,
          0,
          PICKUP_WORK_LABEL_CANVAS_SIZE,
          PICKUP_WORK_LABEL_CANVAS_SIZE,
        );
        ctx.drawImage(offscreenCanvas, 0, 0);
      })
      .catch((error: unknown) => {
        if (cancelled) return;
        console.error("Failed to render pickup work label preview", error);

        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.clearRect(
          0,
          0,
          PICKUP_WORK_LABEL_CANVAS_SIZE,
          PICKUP_WORK_LABEL_CANVAS_SIZE,
        );
        ctx.fillStyle = "#ffffff";
        ctx.fillRect(
          0,
          0,
          PICKUP_WORK_LABEL_CANVAS_SIZE,
          PICKUP_WORK_LABEL_CANVAS_SIZE,
        );
        ctx.fillStyle = "#111827";
        ctx.font = "600 28px Arial, Helvetica, sans-serif";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(
          "Label preview unavailable",
          PICKUP_WORK_LABEL_CANVAS_SIZE / 2,
          PICKUP_WORK_LABEL_CANVAS_SIZE / 2,
        );
      });

    return () => {
      cancelled = true;
    };
  }, [model]);

  return (
    <canvas
      ref={canvasRef}
      width={PICKUP_WORK_LABEL_CANVAS_SIZE}
      height={PICKUP_WORK_LABEL_CANVAS_SIZE}
      aria-label={`Pickup work label preview for ${model.documentId}`}
      className="block max-w-full bg-white shadow-sm"
      style={{ width: "100mm", height: "100mm" }}
    />
  );
}
