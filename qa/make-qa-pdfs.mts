/* Generates fresh QA PDFs unknown to the app (synthetic content only). */
import { writeFileSync, mkdirSync } from "node:fs";
import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { PDFDocument as Cantoo, StandardFonts as CF } from "@cantoo/pdf-lib";
import { chromium } from "@playwright/test";
const out = "qa/artifacts/pdfs"; mkdirSync(out, { recursive: true });
const stamp = new Date().toISOString();

// ---- PDF A: 5 pages, mixed sizes, CropBox-offset signature page (page 4) ----
{
  const d = await PDFDocument.create();
  const f = await d.embedFont(StandardFonts.TimesRoman);
  const fb = await d.embedFont(StandardFonts.TimesRomanBold);
  const sizes: [number, number][] = [[612, 792], [612, 1008], [842, 595], [612, 792], [612, 792]];
  sizes.forEach(([w, h], i) => {
    const p = d.addPage([w, h]);
    p.drawText(`Northwind Advisory — Engagement Terms (QA ${stamp})`, { x: 50, y: h - 60, size: 14, font: fb });
    p.drawText(`Page ${i + 1} of 5   ·   size ${w}x${h}`, { x: 50, y: h - 80, size: 10, font: f });
    for (let l = 0; l < 18; l++) p.drawText(`Clause ${i + 1}.${l + 1}  Synthetic placeholder text for QA only, no real party.`, { x: 50, y: h - 120 - l * 18, size: 10, font: f });
  });
  const p4 = d.getPage(3);
  p4.setCropBox(30, 40, 552, 712); // visible: x 30..582, y 40..752
  p4.drawText("CLIENT SIGNATURE", { x: 100, y: 306 + 4, size: 9, font: fb });
  p4.drawLine({ start: { x: 100, y: 300 }, end: { x: 340, y: 300 }, thickness: 1, color: rgb(0, 0, 0) });
  p4.drawText("Printed name", { x: 100, y: 248, size: 8, font: f });
  p4.drawLine({ start: { x: 100, y: 260 }, end: { x: 300, y: 260 }, thickness: 0.6 });
  p4.drawText("Date", { x: 360, y: 248, size: 8, font: f });
  p4.drawLine({ start: { x: 360, y: 260 }, end: { x: 480, y: 260 }, thickness: 0.6 });
  writeFileSync(`${out}/A-northwind-5p-mixed.pdf`, await d.save());
}

// ---- PDF B: Chromium-produced (different producer, embedded fonts), A4, 3 pages, signature on page 3 ----
{
  const b = await chromium.launch(); const pg = await b.newPage();
  const page = (n: number, extra = "") => `<section style="position:relative;width:210mm;height:297mm;page-break-after:always;overflow:hidden;font-family:Georgia,serif">
    <h1 style="position:absolute;left:20mm;top:15mm;font-size:16pt;margin:0">Harbor &amp; Pine Studio — Service Order</h1>
    <div style="position:absolute;left:20mm;top:28mm;font-size:9pt">Page ${n} of 3 · generated ${stamp} · synthetic</div>
    <table style="position:absolute;left:20mm;top:40mm;width:170mm;font-size:9pt;border-collapse:collapse">${Array.from({length:12},(_,i)=>`<tr><td style="border:1px solid #999;padding:2mm">Item ${n}.${i+1}</td><td style="border:1px solid #999;padding:2mm">Synthetic deliverable</td></tr>`).join("")}</table>${extra}</section>`;
  const sig = `<div style="position:absolute;left:25mm;top:192mm;font-size:8pt">Authorised client signature</div>
    <div style="position:absolute;left:25mm;top:200mm;width:80mm;border-top:1.2px solid #000"></div>
    <div style="position:absolute;left:120mm;top:192mm;font-size:8pt">Date</div>
    <div style="position:absolute;left:120mm;top:200mm;width:50mm;border-top:1.2px solid #000"></div>`;
  await pg.setContent(`<html><head><style>@page{size:A4;margin:0}body{margin:0}</style></head><body>${page(1)}${page(2)}${page(3, sig)}</body></html>`);
  writeFileSync(`${out}/B-harborpine-3p-chromium.pdf`, await pg.pdf({ format: "A4", printBackground: true, margin: { top: 0, bottom: 0, left: 0, right: 0 } }));
  await b.close();
}

// ---- Adversarial inputs ----
{
  const d = await PDFDocument.create(); const f = await d.embedFont(StandardFonts.Helvetica);
  for (let i = 0; i < 3; i++) d.addPage().drawText(`page ${i + 1}`, { x: 50, y: 700, font: f });
  const full = Buffer.from(await d.save());
  writeFileSync(`${out}/bad-truncated.pdf`, full.subarray(0, Math.floor(full.length * 0.4)));
  const garbage = Buffer.concat([Buffer.from("%PDF-1.7\n"), Buffer.from(Array.from({ length: 5000 }, () => Math.floor(Math.random() * 256)))]);
  writeFileSync(`${out}/bad-garbage-header.pdf`, garbage);
  writeFileSync(`${out}/bad-renamed-text.pdf`, "This is a plain text file renamed to .pdf\n");
  const c = await Cantoo.create(); const cf = await c.embedFont(CF.Helvetica);
  c.addPage().drawText("locked", { x: 50, y: 700, font: cf }); c.addPage().drawText("locked 2", { x: 50, y: 700, font: cf });
  c.encrypt({ userPassword: "qa-open-pass", ownerPassword: "qa-owner", permissions: {} });
  writeFileSync(`${out}/bad-password-required.pdf`, await c.save());
  const o = await Cantoo.create(); const of = await o.embedFont(CF.Helvetica);
  o.addPage().drawText("owner-restricted p1", { x: 50, y: 700, font: of }); o.addPage().drawText("owner-restricted p2 — sign here", { x: 50, y: 700, font: of });
  o.encrypt({ userPassword: "", ownerPassword: "qa-owner", permissions: { modifying: false } });
  writeFileSync(`${out}/ok-owner-restricted.pdf`, await o.save());
}
console.log("done");
