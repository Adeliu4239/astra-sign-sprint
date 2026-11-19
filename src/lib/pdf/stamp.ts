import { PDFDocument, PDFFont, PDFPage, StandardFonts, degrees, rgb } from "pdf-lib";
import {
  boxFromRect,
  fitContain,
  normRectToPdf,
  normalizeRotation,
  visibleBox,
  type NormRect,
  type PdfBox,
  type Point,
  type Rotation,
} from "./coordinates";
import { TextFonts, type StyledText } from "./unicode-fonts";

export type FieldKind = "signature" | "name" | "date";

export interface StampField extends NormRect {
  kind: FieldKind;
  pageIndex: number;
}

export interface AuditLine {
  label: string;
  value: string;
}

export interface StampInput {
  original: Uint8Array;
  fields: StampField[];
  signaturePng: Uint8Array;
  signerName: string;
  /** Text written into "date" fields, e.g. "2026-11-18". */
  dateText: string;
  /** Rows printed on the appended signing certificate page. */
  certificate: { title: string; rows: AuditLine[]; events: AuditLine[] };
}

export function pageGeometry(page: PDFPage): { box: PdfBox; rotation: Rotation } {
  const media = boxFromRect(page.getMediaBox());
  const cropRaw = page.node.CropBox() ? boxFromRect(page.getCropBox()) : null;
  return { box: visibleBox(media, cropRaw), rotation: normalizeRotation(page.getRotation().angle) };
}

/** Moves `p` by (dx, dy) expressed in a frame rotated counter-clockwise by `rotation`. */
function offsetRotated(p: Point, dx: number, dy: number, rotation: Rotation): Point {
  const rad = (rotation * Math.PI) / 180;
  const cos = Math.round(Math.cos(rad));
  const sin = Math.round(Math.sin(rad));
  return { x: p.x + dx * cos - dy * sin, y: p.y + dx * sin + dy * cos };
}

/** Replaces characters the standard font cannot encode, so odd names never crash stamping. */
export function encodableText(font: PDFFont, text: string): string {
  let out = "";
  for (const ch of text) {
    try {
      font.encodeText(ch);
      out += ch;
    } catch {
      out += "?";
    }
  }
  return out;
}

/**
 * Isolates the page's existing content in its own graphics state (q … Q), so an unbalanced
 * transformation matrix left by the original content stream cannot shift our stamp.
 */
function isolateExistingContent(doc: PDFDocument, page: PDFPage) {
  page.node.normalize();
  const start = doc.context.register(doc.context.stream("q"));
  const end = doc.context.register(doc.context.stream("Q"));
  page.node.wrapContentStreams(start, end);
}

function drawFittedText(page: PDFPage, styled: StyledText, field: ReturnType<typeof normRectToPdf>) {
  const text = styled.text;
  const pad = Math.min(field.drawHeight * 0.15, 4);
  const availW = Math.max(field.drawWidth - pad * 2, 1);
  const unitWidth = styled.widthOf(text || " ", 1);
  const size = Math.max(4, Math.min(field.drawHeight * 0.6, availW / Math.max(unitWidth, 0.01)));
  const textHeight = styled.primary.heightAtSize(size, { descender: false });
  const baselineY = (field.drawHeight - textHeight) / 2;
  // One run per font; each run starts where the previous one ended along the (rotated) baseline.
  let advance = 0;
  for (const run of styled.segment(text)) {
    const origin = offsetRotated(field.anchor, pad + advance, baselineY, field.rotation);
    page.drawText(run.text, {
      x: origin.x,
      y: origin.y,
      size,
      font: run.font,
      color: rgb(0.05, 0.1, 0.3),
      rotate: degrees(field.rotation),
    });
    advance += run.font.widthOfTextAtSize(run.text, size);
  }
}

function wrap(font: PDFFont, text: string, size: number, maxWidth: number): string[] {
  return wrapMeasured(encodableText(font, text), (s) => font.widthOfTextAtSize(s, size), maxWidth);
}

function wrapMeasured(text: string, width: (s: string) => number, maxWidth: number): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const word of words) {
    const candidate = line ? `${line} ${word}` : word;
    if (width(candidate) <= maxWidth || !line) {
      line = candidate;
    } else {
      lines.push(line);
      line = word;
    }
  }
  if (line) lines.push(line);
  // Hard-break any single token that is still too long (e.g. hashes, or CJK without spaces).
  return lines.flatMap((l) => {
    if (width(l) <= maxWidth) return [l];
    const parts: string[] = [];
    let cur = "";
    for (const ch of l) {
      if (width(cur + ch) > maxWidth) {
        parts.push(cur);
        cur = ch;
      } else cur += ch;
    }
    if (cur) parts.push(cur);
    return parts;
  });
}

function appendCertificate(doc: PDFDocument, font: PDFFont, bold: PDFFont, cert: StampInput["certificate"], resolved: Map<string, StyledText>) {
  const W = 612;
  const H = 792;
  const margin = 54;
  let page = doc.addPage([W, H]);
  let y = H - margin;
  const ensure = (needed: number) => {
    if (y - needed < margin) {
      page = doc.addPage([W, H]);
      y = H - margin;
    }
  };
  page.drawText(encodableText(bold, cert.title), { x: margin, y: y - 16, size: 16, font: bold });
  y -= 36;
  const section = (heading: string, rows: AuditLine[]) => {
    ensure(30);
    page.drawText(heading, { x: margin, y: y - 11, size: 11, font: bold, color: rgb(0.2, 0.2, 0.2) });
    y -= 20;
    for (const row of rows) {
      const value = resolved.get(row.value);
      const lines = value ? wrapMeasured(value.text, (t) => value.widthOf(t, 9), W - margin * 2 - 150) : wrap(font, row.value, 9, W - margin * 2 - 150);
      ensure(lines.length * 12 + 4);
      page.drawText(encodableText(bold, row.label), { x: margin, y: y - 9, size: 9, font: bold });
      lines.forEach((l, i) => {
        let x = margin + 150;
        for (const run of value ? value.segment(l) : [{ font, text: l }]) {
          page.drawText(run.text, { x, y: y - 9 - i * 12, size: 9, font: run.font });
          x += run.font.widthOfTextAtSize(run.text, 9);
        }
      });
      y -= lines.length * 12 + 4;
    }
    y -= 10;
  };
  section("Summary", cert.rows);
  section("Event log (UTC)", cert.events);
  ensure(40);
  const note = wrap(
    font,
    "This certificate was generated by FileSign (prototype). It records the consent, signature image and server-side event log captured for this request. The SHA-256 value is an integrity fingerprint of the original file, not a cryptographic (certificate-based) PDF signature. This is not a qualified electronic signature, FileSign does not verify the signer's identity, and it makes no claim of legal or regulatory compliance.",
    8,
    W - margin * 2,
  );
  note.forEach((l, i) => page.drawText(l, { x: margin, y: y - 8 - i * 10, size: 8, font, color: rgb(0.4, 0.4, 0.4) }));
}

export async function stampPdf(input: StampInput): Promise<Uint8Array> {
  const doc = await PDFDocument.load(input.original, { updateMetadata: false });
  const pages = doc.getPages();
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const png = await doc.embedPng(input.signaturePng);
  // Unicode-safe text: Helvetica whenever it can encode the string (unchanged output), otherwise
  // a per-string Noto subset.
  const fonts = new TextFonts(doc, font);

  const isolated = new Set<number>();
  for (const field of input.fields) {
    const page = pages[field.pageIndex];
    if (!page) throw new Error(`Field references page ${field.pageIndex + 1}, but the PDF has ${pages.length} pages`);
    if (!isolated.has(field.pageIndex)) {
      isolateExistingContent(doc, page);
      isolated.add(field.pageIndex);
    }
    const { box, rotation } = pageGeometry(page);
    const placement = normRectToPdf(field, box, rotation);

    if (field.kind === "signature") {
      const fit = fitContain(placement.drawWidth, placement.drawHeight, png.width, png.height);
      const origin = offsetRotated(placement.anchor, fit.offsetX, fit.offsetY, rotation);
      page.drawImage(png, {
        x: origin.x,
        y: origin.y,
        width: fit.width,
        height: fit.height,
        rotate: degrees(rotation),
      });
    } else {
      drawFittedText(page, await fonts.resolve(field.kind === "name" ? input.signerName : input.dateText), placement);
    }
  }

  const resolved = new Map<string, StyledText>();
  for (const row of [...input.certificate.rows, ...input.certificate.events]) {
    if (!resolved.has(row.value)) resolved.set(row.value, await fonts.resolve(row.value));
  }
  appendCertificate(doc, font, bold, input.certificate, resolved);
  doc.setModificationDate(new Date());
  doc.setProducer("FileSign prototype (pdf-lib)");
  return doc.save({ useObjectStreams: false });
}

export interface PdfInspection {
  pageCount: number;
  encrypted: boolean;
}

/** Parses an uploaded PDF on the server; throws a user-facing message if it cannot be signed. */
export async function inspectPdf(bytes: Uint8Array): Promise<PdfInspection> {
  let doc: PDFDocument;
  let pageCount: number;
  try {
    doc = await PDFDocument.load(bytes, { ignoreEncryption: true, updateMetadata: false });
    pageCount = doc.getPageCount();
    // Touch every page so structural damage surfaces now, not at signing time.
    for (const page of doc.getPages()) pageGeometry(page);
  } catch {
    throw new Error("This file could not be read as a PDF. It may be corrupt or not a real PDF.");
  }
  if (pageCount < 1) throw new Error("This PDF has no pages.");
  return { pageCount, encrypted: doc.isEncrypted };
}
