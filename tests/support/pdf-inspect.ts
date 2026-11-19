import { inflateSync } from "node:zlib";
import { PDFArray, PDFDocument, PDFName, PDFRawStream, type PDFRef } from "pdf-lib";

/** Decoded content stream(s) of one page. */
export async function pageContent(bytes: Uint8Array, pageIndex: number): Promise<string> {
  const doc = await PDFDocument.load(bytes);
  const node = doc.getPage(pageIndex).node;
  const contents = node.lookup(PDFName.of("Contents"));
  const refs = contents instanceof PDFArray ? (contents.asArray() as PDFRef[]) : [node.get(PDFName.of("Contents")) as PDFRef];
  return refs
    .map((ref) => {
      const s = doc.context.lookup(ref) as PDFRawStream;
      const raw = Buffer.from(s.getContents());
      return s.dict.get(PDFName.of("Filter")) ? inflateSync(raw).toString("latin1") : raw.toString("latin1");
    })
    .join("\n");
}

/** Rectangle (PDF points) where pdf-lib drew the signature image on an unrotated page, or null. */
export async function signatureImageRect(bytes: Uint8Array, pageIndex: number) {
  const c = await pageContent(bytes, pageIndex);
  const m = c.match(/1 0 0 1 ([\d.]+) ([\d.]+) cm\s+1 0 0 1 0 0 cm\s+([\d.]+) 0 0 ([\d.]+) 0 0 cm\s+1 0 0 1 0 0 cm\s+\/Image\S* Do/);
  if (!m) return null;
  const [x, y, w, h] = m.slice(1).map(Number) as [number, number, number, number];
  return { x, y, w, h };
}
