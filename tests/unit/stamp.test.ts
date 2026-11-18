import { inflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { PDFDocument, PDFName, PDFRawStream, PDFArray, PDFRef, StandardFonts, degrees } from "pdf-lib";
import { inspectPdf, stampPdf } from "@/lib/pdf/stamp";

// 2x1 opaque PNG (generated once; any valid PNG works).
const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGNgYGD4z8DAwMAAAAgAAQ3cs1YAAAAASUVORK5CYII=",
  "base64",
);

async function makePdf(opts: { rotatePage2?: number; unbalancedCm?: boolean } = {}) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p1 = doc.addPage([612, 792]);
  p1.drawText("Page one", { x: 50, y: 700, font, size: 20 });
  const p2 = doc.addPage([842, 595]); // landscape A4, different size
  p2.drawText("Page two", { x: 50, y: 500, font, size: 20 });
  if (opts.rotatePage2) p2.setRotation(degrees(opts.rotatePage2));
  if (opts.unbalancedCm) {
    // Leave a translated CTM behind without restoring it (seen in real-world PDFs).
    const raw = doc.context.stream("1 0 0 1 100 100 cm");
    p2.node.addContentStream(doc.context.register(raw));
  }
  return doc.save();
}

async function contentOf(bytes: Uint8Array, pageIndex: number): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const page = doc.getPage(pageIndex);
  const contents = page.node.lookup(PDFName.of("Contents"));
  const refs: PDFRef[] = contents instanceof PDFArray ? (contents.asArray() as PDFRef[]) : [page.node.get(PDFName.of("Contents")) as PDFRef];
  return refs
    .map((ref) => {
      const s = doc.context.lookup(ref) as PDFRawStream;
      const raw = Buffer.from(s.getContents());
      const filter = s.dict.get(PDFName.of("Filter"));
      return filter ? inflateSync(raw).toString("latin1") : raw.toString("latin1");
    })
    .join("\n");
}

const baseInput = {
  signaturePng: PNG,
  signerName: "Taylor Example",
  dateText: "2026-11-18",
  certificate: { title: "Signing certificate", rows: [{ label: "Signer", value: "Taylor Example" }], events: [] },
};

describe("stampPdf", () => {
  it("embeds the signature on page 2 at the field coordinates (regression)", async () => {
    const original = await makePdf();
    // Field at 50%,50% of a 842x595 page, 20% x 10% in size, image aspect 2:1.
    const out = await stampPdf({
      ...baseInput,
      original,
      fields: [{ kind: "signature", pageIndex: 1, x: 0.5, y: 0.5, width: 0.2, height: 0.1 }],
    });
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBe(3); // 2 original pages + certificate
    const page1 = await contentOf(out, 0);
    expect(page1).not.toContain(" Do");
    const page2 = await contentOf(out, 1);
    // drawWidth = 168.4, drawHeight = 59.5; 2:1 image fits as 119 x 59.5, offsetX = 24.7.
    // Displayed bottom-left = (421, 297.5 + 59.5) -> PDF y = 595 - 357 = 238.
    expect(page2).toMatch(/1 0 0 1 445\.7 238 cm/);
    expect(page2).toMatch(/119 0 0 59\.5 0 0 cm/);
    expect(page2).toContain(" Do");
  });

  it("wraps existing content so an unbalanced CTM cannot shift the stamp", async () => {
    const original = await makePdf({ unbalancedCm: true });
    const out = await stampPdf({
      ...baseInput,
      original,
      fields: [{ kind: "signature", pageIndex: 1, x: 0.5, y: 0.5, width: 0.2, height: 0.1 }],
    });
    const page2 = await contentOf(out, 1);
    const qIndex = page2.lastIndexOf("1 0 0 1 100 100 cm");
    const restore = page2.indexOf("Q", qIndex);
    const draw = page2.indexOf("1 0 0 1 445.7 238 cm");
    expect(qIndex).toBeGreaterThan(-1);
    expect(restore).toBeGreaterThan(qIndex);
    expect(draw).toBeGreaterThan(restore);
  });

  it("draws upright on a rotated page (90°)", async () => {
    const original = await makePdf({ rotatePage2: 90 });
    const out = await stampPdf({
      ...baseInput,
      original,
      fields: [{ kind: "signature", pageIndex: 1, x: 0.1, y: 0.1, width: 0.2, height: 0.1 }],
    });
    const page2 = await contentOf(out, 1);
    // Rotation operator: cos(90)=~0, sin=1 -> "0 1 -1 0 0 0 cm" (allowing float noise).
    expect(page2).toMatch(/[-\d.e]+ 1 -1 [-\d.e]+ 0 0 cm/);
  });

  it("writes name and date text fields", async () => {
    const original = await makePdf();
    const out = await stampPdf({
      ...baseInput,
      signerName: "Zoë Ünicode 李",
      original,
      fields: [
        { kind: "signature", pageIndex: 0, x: 0.1, y: 0.8, width: 0.3, height: 0.08 },
        { kind: "name", pageIndex: 0, x: 0.5, y: 0.8, width: 0.3, height: 0.04 },
        { kind: "date", pageIndex: 1, x: 0.5, y: 0.9, width: 0.2, height: 0.04 },
      ],
    });
    const page1 = await contentOf(out, 0);
    expect(page1).toContain("Tj");
  });

  it("rejects a field on a page that does not exist", async () => {
    const original = await makePdf();
    await expect(
      stampPdf({ ...baseInput, original, fields: [{ kind: "signature", pageIndex: 5, x: 0, y: 0, width: 0.1, height: 0.1 }] }),
    ).rejects.toThrow(/page 6/);
  });
});

describe("inspectPdf", () => {
  it("counts pages", async () => {
    expect((await inspectPdf(await makePdf())).pageCount).toBe(2);
  });
  it("rejects non-PDF bytes", async () => {
    await expect(inspectPdf(new TextEncoder().encode("%PDF-1.7 not really"))).rejects.toThrow(/could not be read/);
  });
});
