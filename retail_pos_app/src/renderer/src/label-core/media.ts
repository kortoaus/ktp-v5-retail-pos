/**
 * Label media, in millimetres and in printer dots.
 *
 * One dpmm for the whole track: every label printer in the fleet is 203 dpi,
 * so dots are simply `mm * 8` and there is no per-printer scaling anywhere in
 * this library. If a 300 dpi head ever arrives it gets its own conversion at
 * the call site rather than a scale factor smuggled through every module.
 *
 * The dot figures here are the exact geometric ones. The legacy builders carry
 * hand-tuned numbers (440 / 550 / 812) that drifted from the media they claim
 * to describe; those are deliberately not reproduced — the template step tunes
 * against real stock instead of inheriting an unexplained offset.
 */

export const DPMM = 8;

export type MediaId = "6040" | "58100" | "7030" | "7090" | "100100";

export interface Media {
  id: MediaId;
  /** Physical size, `[width, height]` in millimetres. */
  mm: [number, number];
  /** Printable size, `[width, height]` in dots — what ^PW and ^LL are given. */
  dots: [number, number];
  /** Human label for pickers. */
  label: string;
}

export function mmToDots(mm: number): number {
  return Math.round(mm * DPMM);
}

function media(id: MediaId, widthMm: number, heightMm: number): Media {
  return {
    id,
    mm: [widthMm, heightMm],
    dots: [mmToDots(widthMm), mmToDots(heightMm)],
    label: `${widthMm} × ${heightMm} mm`,
  };
}

export const MEDIA: Record<MediaId, Media> = {
  "6040": media("6040", 60, 40),
  "58100": media("58100", 58, 100),
  "7030": media("7030", 70, 30),
  "7090": media("7090", 70, 90),
  "100100": media("100100", 100, 100),
};

/** Stable display order for pickers. */
export const MEDIA_IDS: MediaId[] = ["6040", "58100", "7030", "7090", "100100"];

export function getMedia(id: MediaId): Media {
  const found = MEDIA[id];
  if (!found) throw new Error(`unknown media ${JSON.stringify(id)}`);
  return found;
}
