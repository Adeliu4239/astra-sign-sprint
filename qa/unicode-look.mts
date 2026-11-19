/* Visual check for Unicode stamping: writes qa/artifacts/unicode-signed.pdf (gitignored). */
import { writeFileSync } from "node:fs";
import { stampPdf } from "../src/lib/pdf/stamp";
import { makeAgreementPdf } from "../tests/e2e/make-pdf";

const PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGNgYGD4z8DAwMAAAAgAAQ3cs1YAAAAASUVORK5CYII=", "base64");
const name = process.argv[2] ?? "李小龍 (Lee Siu-lung)";
const original = await makeAgreementPdf("unicode-look");
const out = await stampPdf({
  original,
  signaturePng: PNG,
  signerName: name,
  dateText: "2026-11-19",
  fields: [
    { kind: "signature", pageIndex: 1, x: (320 - 90) / 595.28, y: (841.89 - 438 - 25) / 841.89, width: 180 / 595.28, height: 50 / 841.89 },
    { kind: "name", pageIndex: 1, x: (320 - 90) / 595.28, y: (841.89 - 470) / 841.89, width: 180 / 595.28, height: 20 / 841.89 },
  ],
  certificate: {
    title: "Signing certificate",
    rows: [
      { label: "Document", value: "合作协议-2026.pdf" },
      { label: "Case", value: "Ελένη Παπαδοπούλου — onboarding" },
      { label: "Signer name", value: name },
      { label: "Signer email", value: "client@example.test (provided by sender, not verified)" },
    ],
    events: [{ label: "2026-11-19 05:00:00 UTC", value: "Signer submitted signature" }],
  },
});
writeFileSync("qa/artifacts/unicode-signed.pdf", out);
console.log("bytes", out.byteLength);
