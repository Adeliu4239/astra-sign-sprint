/**
 * Unicode-safe text in signed PDFs (FINAL_QA Q-1). Verifies, by extracting text with pdf.js:
 * Latin-1 keeps the original Helvetica path; Chinese, accented and extended Latin names render
 * as typed in the name field and on the certificate; long names fit their field; uncovered
 * scripts degrade to "?" without failing; rotation handling is unaffected.
 */
import { describe, expect, it } from "vitest";
import { PDFDict, PDFDocument, PDFName, StandardFonts, degrees } from "pdf-lib";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
import { stampPdf } from "@/lib/pdf/stamp";
import { subsetFont } from "@/lib/pdf/unicode-fonts";
import { readFileSync } from "node:fs";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGNgYGD4z8DAwMAAAAgAAQ3cs1YAAAAASUVORK5CYII=",
  "base64",
);

async function makePdf(rotatePage1 = 0) {
  const doc = await PDFDocument.create();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const p = doc.addPage([612, 792]);
  p.drawText("Agreement", { x: 50, y: 700, font, size: 20 });
  if (rotatePage1) p.setRotation(degrees(rotatePage1));
  return doc.save();
}

const NAME_FIELD = { kind: "name" as const, pageIndex: 0, x: 0.5, y: 0.8, width: 0.3, height: 0.04 };
const SIG_FIELD = { kind: "signature" as const, pageIndex: 0, x: 0.1, y: 0.8, width: 0.3, height: 0.08 };

async function sign(signerName: string, rotate = 0) {
  return stampPdf({
    original: await makePdf(rotate),
    fields: [SIG_FIELD, NAME_FIELD],
    signaturePng: PNG,
    signerName,
    dateText: "2026-11-19",
    certificate: {
      title: "Signing certificate",
      rows: [
        { label: "Signer name", value: signerName },
        { label: "Case", value: "Engagement — 2026" },
      ],
      events: [{ label: "2026-11-19 05:00:00 UTC", value: "Signer submitted signature" }],
    },
  });
}

async function pageText(bytes: Uint8Array, pageNo: number) {
  const doc = await pdfjs.getDocument({ data: new Uint8Array(bytes), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
  const page = await doc.getPage(pageNo);
  const tc = await page.getTextContent();
  const items = tc.items as { str: string; width: number; transform: number[] }[];
  return { text: items.map((i) => i.str).join(" "), items };
}

async function embeddedFontKinds(bytes: Uint8Array) {
  const doc = await PDFDocument.load(bytes);
  const kinds: string[] = [];
  for (const [, obj] of doc.context.enumerateIndirectObjects()) {
    if (obj instanceof PDFDict && obj.get(PDFName.of("Type")) === PDFName.of("Font")) {
      kinds.push(String(obj.get(PDFName.of("Subtype"))));
    }
  }
  return kinds;
}

describe("Unicode text in signed PDFs", () => {
  it("Latin-1 names keep the built-in Helvetica path (no extra fonts embedded)", async () => {
    const out = await sign("Zoë Ünicode-O'Brien");
    expect((await embeddedFontKinds(out)).every((k) => k === "/Type1")).toBe(true);
    expect((await pageText(out, 1)).text).toContain("Zoë Ünicode-O'Brien");
  });

  it.each([
    ["Chinese (Simplified)", "王小明"],
    ["Chinese (Traditional)", "李小龍"],
    ["rare-ish name characters", "張堃喆"],
    ["Japanese", "山田 太郎 やまだ"],
    ["mixed CJK and Latin", "李 Wei Zhang"],
    ["mixed CJK and extended Latin (two fonts in one string)", "李小龍 Łukasz Đặng-Nguyễn"],
    ["Latin Extended / Vietnamese", "Łukasz Đặng Nguyễn"],
    ["Turkish and Nordic", "Şahin Ğül Øyvind"],
    ["Greek and Cyrillic", "Ελένη Дмитрий"],
  ])("%s: %s prints as typed in the name field and on the certificate", async (_label, name) => {
    const out = await sign(name);
    // pdf.js splits text items at font changes, so compare without whitespace.
    const squash = (t: string) => t.replace(/\s+/g, "");
    const field = squash((await pageText(out, 1)).text);
    const cert = squash((await pageText(out, 2)).text);
    expect(field).toContain(squash(name));
    expect(cert).toContain(squash(name));
    expect(field).not.toContain("?");
    expect(await embeddedFontKinds(out)).toContain("/Type0"); // embedded Unicode (CID) font
    expect(out.byteLength).toBeLessThan(200_000); // subset, not the whole 7.5 MB font
  });

  it("a long full name shrinks to fit inside its field", async () => {
    const name = "Maria Fernanda de los Ángeles Rodríguez-Łopatyńska von Hohenberg-Nguyễn Thị Minh Khai";
    const out = await sign(name);
    const { items } = await pageText(out, 1);
    const run = items.find((i) => i.str.includes("Hohenberg"));
    expect(run).toBeDefined();
    const fieldWidthPt = NAME_FIELD.width * 612;
    expect(run!.width).toBeLessThanOrEqual(fieldWidthPt);
    expect(run!.transform[4]).toBeGreaterThanOrEqual(NAME_FIELD.x * 612 - 0.5); // starts inside the field
  });

  it("scripts no bundled font covers become '?' instead of failing", async () => {
    const out = await sign("김민준 🙂 Kim");
    const field = (await pageText(out, 1)).text;
    expect(field).toContain("Kim");
    expect(field).toContain("?");
  });

  it("CJK text on a rotated page is stamped without error and stays extractable", async () => {
    const out = await sign("陳美玲", 90);
    expect((await pageText(out, 1)).text).toContain("陳美玲");
  });

  it("HarfBuzz subset keeps only the requested glyphs", async () => {
    const full = new Uint8Array(readFileSync("assets/fonts/NotoSansSC-Regular.ttf"));
    const sub = await subsetFont(full, "王小明");
    expect(sub.byteLength).toBeGreaterThan(500);
    expect(sub.byteLength).toBeLessThan(20_000);
  });
});
