export interface CropTarget {
  /** Integer logical dimensions used by Android's crop editor. */
  aspect: [number, number];
  /** Exact physical-pixel output dimensions. */
  outputWidth: number;
  outputHeight: number;
}

export function createCropTarget(width: number, height: number, pixelRatio: number): CropTarget | null {
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) return null;
  const safeScale = Number.isFinite(pixelRatio) && pixelRatio > 0 ? pixelRatio : 1;
  const logicalWidth = Math.max(1, Math.round(width));
  const logicalHeight = Math.max(1, Math.round(height));
  return {
    aspect: [logicalWidth, logicalHeight],
    outputWidth: Math.max(1, Math.round(width * safeScale)),
    outputHeight: Math.max(1, Math.round(height * safeScale)),
  };
}
