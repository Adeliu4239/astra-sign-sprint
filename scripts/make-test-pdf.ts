/* Writes a fresh synthetic multi-page agreement for manual testing: npx tsx scripts/make-test-pdf.ts out.pdf */
import { writeFileSync } from "node:fs";
import { makeAgreementPdf } from "../tests/e2e/make-pdf";

const out = process.argv[2] ?? "synthetic-agreement.pdf";
makeAgreementPdf().then((b) => {
  writeFileSync(out, b);
  console.log(`wrote ${out} (${b.byteLength} bytes)`);
});
