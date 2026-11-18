/**
 * Coordinate contract (shared by the browser editor, signer view and server stamper).
 *
 * Fields are stored as a normalised rectangle {x, y, width, height} in [0, 1], measured in the
 * page's *displayed* space: the page as a viewer shows it after applying the PDF /Rotate entry,
 * with a TOP-LEFT origin, x to the right and y downwards. Normalised units make the stored value
 * independent of zoom, CSS size, devicePixelRatio and scroll position.
 *
 * The server converts that rectangle to PDF user space (points, BOTTOM-LEFT origin, unrotated
 * page) using the page's visible box (CropBox ∩ MediaBox, matching PDF.js) and its rotation.
 */

export type Rotation = 0 | 90 | 180 | 270;

export interface NormRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** A PDF box in user space, as [x0, y0, x1, y1] with x0 < x1 and y0 < y1. */
export interface PdfBox {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
}

export interface Point {
  x: number;
  y: number;
}

export const MIN_FIELD_SIZE = 0.01;

export function normalizeRotation(raw: number | undefined | null): Rotation {
  if (raw === undefined || raw === null || !Number.isFinite(raw)) return 0;
  // PDF.js ignores rotations that are not multiples of 90; mirror that behaviour.
  if (raw % 90 !== 0) return 0;
  const r = ((raw % 360) + 360) % 360;
  return r as Rotation;
}

/** Builds a well-ordered box from an {x, y, width, height} rectangle (widths may be negative). */
export function boxFromRect(r: { x: number; y: number; width: number; height: number }): PdfBox {
  return {
    x0: Math.min(r.x, r.x + r.width),
    y0: Math.min(r.y, r.y + r.height),
    x1: Math.max(r.x, r.x + r.width),
    y1: Math.max(r.y, r.y + r.height),
  };
}

/** PDF.js renders the intersection of CropBox and MediaBox. */
export function visibleBox(mediaBox: PdfBox, cropBox: PdfBox | null): PdfBox {
  if (!cropBox) return mediaBox;
  const box = {
    x0: Math.max(mediaBox.x0, cropBox.x0),
    y0: Math.max(mediaBox.y0, cropBox.y0),
    x1: Math.min(mediaBox.x1, cropBox.x1),
    y1: Math.min(mediaBox.y1, cropBox.y1),
  };
  // Degenerate crop boxes fall back to the media box, as PDF.js does.
  if (box.x1 <= box.x0 || box.y1 <= box.y0) return mediaBox;
  return box;
}

/** Size of the page as displayed (rotation applied), in PDF points. */
export function displaySize(box: PdfBox, rotation: Rotation): { width: number; height: number } {
  const w = box.x1 - box.x0;
  const h = box.y1 - box.y0;
  return rotation === 90 || rotation === 270 ? { width: h, height: w } : { width: w, height: h };
}

/**
 * Converts a point in displayed space (points, top-left origin) to PDF user space.
 * Rotation is clockwise, as defined by the PDF spec for /Rotate.
 */
export function displayPointToPdf(p: Point, box: PdfBox, rotation: Rotation): Point {
  const { x0, y0, x1, y1 } = box;
  switch (rotation) {
    case 0:
      return { x: x0 + p.x, y: y1 - p.y };
    case 90:
      return { x: x0 + p.y, y: y0 + p.x };
    case 180:
      return { x: x1 - p.x, y: y0 + p.y };
    case 270:
      return { x: x1 - p.y, y: y1 - p.x };
  }
}

export interface PdfPlacement {
  /** Axis-aligned rectangle in PDF user space (bottom-left origin). */
  rect: { x: number; y: number; width: number; height: number };
  /**
   * Anchor for drawing content that must look upright to the reader: the displayed bottom-left
   * corner of the field, in PDF user space. Draw with `rotate = rotation` (counter-clockwise
   * degrees in PDF space) and width/height equal to `drawWidth`/`drawHeight`.
   */
  anchor: Point;
  drawWidth: number;
  drawHeight: number;
  rotation: Rotation;
}

/** Maps a stored normalised field to PDF user space for stamping. */
export function normRectToPdf(field: NormRect, box: PdfBox, rotation: Rotation): PdfPlacement {
  const size = displaySize(box, rotation);
  const left = field.x * size.width;
  const top = field.y * size.height;
  const w = field.width * size.width;
  const h = field.height * size.height;

  const a = displayPointToPdf({ x: left, y: top }, box, rotation);
  const b = displayPointToPdf({ x: left + w, y: top + h }, box, rotation);
  const anchor = displayPointToPdf({ x: left, y: top + h }, box, rotation);

  return {
    rect: {
      x: Math.min(a.x, b.x),
      y: Math.min(a.y, b.y),
      width: Math.abs(a.x - b.x),
      height: Math.abs(a.y - b.y),
    },
    anchor,
    drawWidth: w,
    drawHeight: h,
    rotation,
  };
}

/**
 * Converts a pointer position (client/viewport pixels) into normalised page coordinates using the
 * page element's bounding rect. getBoundingClientRect already reflects scroll, CSS zoom and layout
 * scaling, so this is the only conversion the browser needs.
 */
export function clientToNorm(
  clientX: number,
  clientY: number,
  pageRect: { left: number; top: number; width: number; height: number },
): Point {
  return {
    x: (clientX - pageRect.left) / pageRect.width,
    y: (clientY - pageRect.top) / pageRect.height,
  };
}

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));

/** Keeps a field fully inside the page and above a minimum size. */
export function clampNormRect(r: NormRect): NormRect {
  const width = clamp(r.width, MIN_FIELD_SIZE, 1);
  const height = clamp(r.height, MIN_FIELD_SIZE, 1);
  return {
    x: clamp(r.x, 0, 1 - width),
    y: clamp(r.y, 0, 1 - height),
    width,
    height,
  };
}

/** Fits an image of the given aspect ratio inside a box, centred ("contain"). */
export function fitContain(
  boxW: number,
  boxH: number,
  imgW: number,
  imgH: number,
): { offsetX: number; offsetY: number; width: number; height: number } {
  const scale = Math.min(boxW / imgW, boxH / imgH);
  const width = imgW * scale;
  const height = imgH * scale;
  return { offsetX: (boxW - width) / 2, offsetY: (boxH - height) / 2, width, height };
}
