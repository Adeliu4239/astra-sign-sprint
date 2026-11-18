/* Dev helper: renders one page of a PDF to PNG for visual verification.
   Usage: node scripts/render-pdf-page.mjs in.pdf <pageNumber> out.png */
import { readFileSync, writeFileSync } from "node:fs";
import { createCanvas } from "@napi-rs/canvas";
import * as pdfjs from "pdfjs-dist/legacy/build/pdf.mjs";

const [, , input, pageArg = "1", output = "page.png"] = process.argv;
const doc = await pdfjs.getDocument({ data: new Uint8Array(readFileSync(input)), standardFontDataUrl: "node_modules/pdfjs-dist/standard_fonts/", cMapUrl: "node_modules/pdfjs-dist/cmaps/", cMapPacked: true, wasmUrl: "node_modules/pdfjs-dist/wasm/" }).promise;
const page = await doc.getPage(Number(pageArg));
const viewport = page.getViewport({ scale: 1.5 });
const canvas = createCanvas(viewport.width, viewport.height);
await page.render({ canvas, viewport }).promise;
writeFileSync(output, canvas.toBuffer("image/png"));
console.log(`rendered page ${pageArg}/${doc.numPages} -> ${output}`);
