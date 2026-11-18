import { describe, expect, it } from "vitest";
import {
  clampNormRect,
  clientToNorm,
  displayPointToPdf,
  displaySize,
  fitContain,
  normRectToPdf,
  normalizeRotation,
  visibleBox,
  type PdfBox,
} from "@/lib/pdf/coordinates";

const letter: PdfBox = { x0: 0, y0: 0, x1: 612, y1: 792 };

describe("normalizeRotation", () => {
  it.each([
    [0, 0], [90, 90], [180, 180], [270, 270], [360, 0], [-90, 270], [450, 90], [45, 0], [undefined, 0],
  ])("%s -> %s", (input, expected) => {
    expect(normalizeRotation(input as number | undefined)).toBe(expected);
  });
});

describe("displayPointToPdf", () => {
  it("rotation 0 flips the y axis", () => {
    expect(displayPointToPdf({ x: 0, y: 0 }, letter, 0)).toEqual({ x: 0, y: 792 });
    expect(displayPointToPdf({ x: 612, y: 792 }, letter, 0)).toEqual({ x: 612, y: 0 });
  });
  it("respects a crop box offset", () => {
    const box = { x0: 50, y0: 100, x1: 550, y1: 700 };
    expect(displayPointToPdf({ x: 10, y: 20 }, box, 0)).toEqual({ x: 60, y: 680 });
  });
  it("rotation 90: displayed top-left is the PDF bottom-left", () => {
    expect(displayPointToPdf({ x: 0, y: 0 }, letter, 90)).toEqual({ x: 0, y: 0 });
    // Moving right on screen walks up the original left edge.
    expect(displayPointToPdf({ x: 792, y: 0 }, letter, 90)).toEqual({ x: 0, y: 792 });
    expect(displayPointToPdf({ x: 0, y: 612 }, letter, 90)).toEqual({ x: 612, y: 0 });
  });
  it("rotation 180 and 270 map corners correctly", () => {
    expect(displayPointToPdf({ x: 0, y: 0 }, letter, 180)).toEqual({ x: 612, y: 0 });
    expect(displayPointToPdf({ x: 0, y: 0 }, letter, 270)).toEqual({ x: 612, y: 792 });
    expect(displayPointToPdf({ x: 792, y: 612 }, letter, 270)).toEqual({ x: 0, y: 0 });
  });
});

describe("normRectToPdf", () => {
  it("maps a field on an unrotated page", () => {
    const p = normRectToPdf({ x: 0.5, y: 0.25, width: 0.25, height: 0.125 }, letter, 0);
    expect(p.rect).toEqual({ x: 306, y: 495, width: 153, height: 99 });
    expect(p.anchor).toEqual({ x: 306, y: 495 });
    expect(p.drawWidth).toBe(153);
    expect(p.drawHeight).toBe(99);
  });

  it("maps a field on a landscape-displayed (90°) page and keeps draw size in displayed units", () => {
    // Displayed page is 792 wide x 612 tall.
    expect(displaySize(letter, 90)).toEqual({ width: 792, height: 612 });
    const p = normRectToPdf({ x: 0.5, y: 0.5, width: 0.25, height: 0.1 }, letter, 90);
    expect(p.drawWidth).toBeCloseTo(198);
    expect(p.drawHeight).toBeCloseTo(61.2);
    // In PDF space the rectangle is tall and narrow.
    expect(p.rect.width).toBeCloseTo(61.2);
    expect(p.rect.height).toBeCloseTo(198);
    expect(p.rect.x).toBeCloseTo(306);
    expect(p.rect.y).toBeCloseTo(396);
    // Displayed bottom-left corner -> PDF (x = top+h, y = left).
    expect(p.anchor.x).toBeCloseTo(367.2);
    expect(p.anchor.y).toBeCloseTo(396);
  });

  it("round-trips all rotations: rect contains the anchor corner", () => {
    for (const r of [0, 90, 180, 270] as const) {
      const p = normRectToPdf({ x: 0.1, y: 0.2, width: 0.3, height: 0.1 }, letter, r);
      const xs = [p.rect.x, p.rect.x + p.rect.width];
      const ys = [p.rect.y, p.rect.y + p.rect.height];
      expect(xs.some((v) => Math.abs(v - p.anchor.x) < 1e-9)).toBe(true);
      expect(ys.some((v) => Math.abs(v - p.anchor.y) < 1e-9)).toBe(true);
    }
  });
});

describe("visibleBox", () => {
  it("intersects crop and media boxes", () => {
    expect(visibleBox(letter, { x0: -10, y0: 20, x1: 500, y1: 900 })).toEqual({ x0: 0, y0: 20, x1: 500, y1: 792 });
  });
  it("falls back to media box for a degenerate crop box", () => {
    expect(visibleBox(letter, { x0: 700, y0: 0, x1: 800, y1: 10 })).toEqual(letter);
  });
});

describe("browser helpers", () => {
  it("clientToNorm uses the rendered page rect (scroll and zoom independent)", () => {
    const rect = { left: 100, top: -500, width: 800, height: 1035 };
    const p = clientToNorm(500, 0, rect);
    expect(p.x).toBeCloseTo(0.5);
    expect(p.y).toBeCloseTo(500 / 1035);
  });
  it("clampNormRect keeps fields inside the page", () => {
    expect(clampNormRect({ x: 0.9, y: -0.2, width: 0.3, height: 0.1 })).toEqual({ x: 0.7, y: 0, width: 0.3, height: 0.1 });
  });
  it("fitContain centres an image", () => {
    expect(fitContain(200, 50, 400, 200)).toEqual({ offsetX: 50, offsetY: 0, width: 100, height: 50 });
  });
});
