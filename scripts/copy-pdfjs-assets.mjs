/* Copies PDF.js worker + runtime assets (fonts, CMaps, wasm decoders, ICC) into public/pdfjs. */
import { cpSync, mkdirSync, rmSync } from "node:fs";

const src = "node_modules/pdfjs-dist";
const dest = "public/pdfjs";
rmSync(dest, { recursive: true, force: true });
mkdirSync(dest, { recursive: true });
cpSync(`${src}/legacy/build/pdf.worker.min.mjs`, `${dest}/pdf.worker.min.mjs`);
for (const dir of ["cmaps", "standard_fonts", "wasm", "iccs"]) {
  cpSync(`${src}/${dir}`, `${dest}/${dir}`, { recursive: true });
}
console.log("pdf.js assets copied to public/pdfjs");
