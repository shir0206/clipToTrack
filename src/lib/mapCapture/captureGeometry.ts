/** Coordinates are relative to the map canvas, in CSS or backing pixels as specified. */
export type CaptureRect = {
  x: number;
  y: number;
  width: number;
  height: number;
};

function positive(...values: number[]) {
  if (values.some((value) => !Number.isFinite(value) || value <= 0))
    throw new RangeError('Capture dimensions must be finite and positive.');
}

export function getLandscapeFrame(
  availableWidth: number,
  availableHeight: number,
): CaptureRect {
  positive(availableWidth, availableHeight);
  const width = Math.min(availableWidth, (availableHeight * 16) / 9);
  const height = (width * 9) / 16;
  return {
    x: (availableWidth - width) / 2,
    y: (availableHeight - height) / 2,
    width,
    height,
  };
}

export function toCanvasCrop(
  frame: CaptureRect,
  canvasCssWidth: number,
  canvasCssHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): CaptureRect {
  positive(
    frame.width,
    frame.height,
    canvasCssWidth,
    canvasCssHeight,
    canvasWidth,
    canvasHeight,
  );
  if (!Number.isFinite(frame.x) || !Number.isFinite(frame.y))
    throw new RangeError('Capture position must be finite.');
  // Clamp edges independently: a frame entirely outside the map is invalid.
  const left = Math.max(0, frame.x);
  const top = Math.max(0, frame.y);
  const right = Math.min(canvasCssWidth, frame.x + frame.width);
  const bottom = Math.min(canvasCssHeight, frame.y + frame.height);
  positive(right - left, bottom - top);
  return {
    x: (left * canvasWidth) / canvasCssWidth,
    y: (top * canvasHeight) / canvasCssHeight,
    width: ((right - left) * canvasWidth) / canvasCssWidth,
    height: ((bottom - top) * canvasHeight) / canvasCssHeight,
  };
}
