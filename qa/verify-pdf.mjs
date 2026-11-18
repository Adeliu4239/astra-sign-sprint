import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";
const [, , file, orig] = process.argv;
const buf = readFileSync(file);
const doc = await pdfjs.getDocument({ data: new Uint8Array(buf), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/" }).promise;
console.log(file, "pages:", doc.numPages, "sha256:", createHash("sha256").update(buf).digest("hex"));
if (orig) console.log("original sha256:", createHash("sha256").update(readFileSync(orig)).digest("hex"));
for (let i = 1; i <= doc.numPages; i++) {
  const pg = await doc.getPage(i); const vp = pg.getViewport({ scale: 1 });
  const ops = await pg.getOperatorList();
  const imgs = ops.fnArray.filter((f) => f === pdfjs.OPS.paintImageXObject).length;
  console.log(` p${i} ${Math.round(vp.width)}x${Math.round(vp.height)} rotate=${pg.rotate} images=${imgs}`);
}
const last = await doc.getPage(doc.numPages);
const tc = await last.getTextContent();
console.log("--- last page text ---\n" + tc.items.map((t) => t.str).join(" ").replace(/\s+/g, " "));
