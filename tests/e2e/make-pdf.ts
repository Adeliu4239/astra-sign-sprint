import { PDFDocument, StandardFonts, degrees, rgb } from "pdf-lib";

/**
 * Generates a brand-new synthetic "client agreement" each run, with mixed page sizes and a
 * rotated page, so tests never depend on a fixed fixture.
 */
export async function makeAgreementPdf(seed = Date.now().toString(36)): Promise<Buffer> {
  const doc = await PDFDocument.create();
  doc.setTitle(`Synthetic MIND-style client agreement ${seed}`);
  const font = await doc.embedFont(StandardFonts.TimesRoman);
  const bold = await doc.embedFont(StandardFonts.TimesRomanBold);
  const para = (page: ReturnType<typeof doc.addPage>, y: number, text: string) => {
    const words = text.split(" ");
    let line = "";
    for (const w of words) {
      if (font.widthOfTextAtSize(line + " " + w, 11) > page.getWidth() - 144) {
        page.drawText(line, { x: 72, y, size: 11, font });
        y -= 15;
        line = w;
      } else line = line ? line + " " + w : w;
    }
    page.drawText(line, { x: 72, y, size: 11, font });
    return y - 24;
  };
  const lorem =
    "The Client engages the Company to provide the services described in the Statement of Work. Fees are payable within thirty days of invoice. Either party may terminate this Agreement with thirty days written notice. Confidential information shall be protected using reasonable care.";

  // Page 1: US Letter portrait.
  const p1 = doc.addPage([612, 792]);
  p1.drawText("CLIENT SERVICES AGREEMENT", { x: 72, y: 720, size: 18, font: bold });
  p1.drawText(`Reference ${seed} (synthetic test document)`, { x: 72, y: 700, size: 10, font });
  let y = 660;
  for (let i = 1; i <= 6; i++) y = para(p1, y, `${i}. ${lorem}`);

  // Page 2: A4 portrait with a signature block.
  const p2 = doc.addPage([595.28, 841.89]);
  p2.drawText("SIGNATURES", { x: 72, y: 760, size: 16, font: bold });
  para(p2, 730, "IN WITNESS WHEREOF, the parties have executed this Agreement as of the date written below.");
  p2.drawText("Client signature:", { x: 72, y: 420, size: 11, font: bold });
  p2.drawLine({ start: { x: 180, y: 418 }, end: { x: 460, y: 418 }, thickness: 1, color: rgb(0, 0, 0) });
  p2.drawText("Date:", { x: 72, y: 380, size: 11, font: bold });
  p2.drawLine({ start: { x: 180, y: 378 }, end: { x: 320, y: 378 }, thickness: 1, color: rgb(0, 0, 0) });

  // Page 3: Letter page stored with /Rotate 90 (displays as landscape).
  const p3 = doc.addPage([612, 792]);
  p3.setRotation(degrees(90));
  p3.drawText("SCHEDULE A — FEES (rotated page)", { x: 72, y: 720, size: 14, font: bold });

  return Buffer.from(await doc.save());
}
