import { describe, expect, it } from "vitest";
import { PDFDocument as Cantoo, StandardFonts } from "@cantoo/pdf-lib";
import { decryptOwnerProtectedPdf } from "@/lib/pdf/decrypt";
import { inspectPdf, stampPdf } from "@/lib/pdf/stamp";

const PNG = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGNgYGD4z8DAwMAAAAgAAQ3cs1YAAAAASUVORK5CYII=",
  "base64",
);

async function encrypted(userPassword: string) {
  const d = await Cantoo.create();
  const f = await d.embedFont(StandardFonts.Helvetica);
  d.addPage().drawText("one", { x: 50, y: 700, font: f });
  d.addPage().drawText("two", { x: 50, y: 700, font: f });
  d.encrypt({ userPassword, ownerPassword: "owner-secret", permissions: { modifying: false } });
  return d.save();
}

describe("decryptOwnerProtectedPdf", () => {
  it("removes owner-only protection so the PDF can be stamped", async () => {
    const enc = await encrypted("");
    expect((await inspectPdf(enc)).encrypted).toBe(true);
    const plain = await decryptOwnerProtectedPdf(enc);
    expect(plain).not.toBeNull();
    const info = await inspectPdf(plain!);
    expect(info).toEqual({ pageCount: 2, encrypted: false });
    const out = await stampPdf({
      original: plain!,
      fields: [{ kind: "signature", pageIndex: 1, x: 0.2, y: 0.5, width: 0.3, height: 0.1 }],
      signaturePng: PNG,
      signerName: "Taylor Example",
      dateText: "2026-11-18",
      certificate: { title: "Signing certificate", rows: [], events: [] },
    });
    expect((await inspectPdf(out)).pageCount).toBe(3);
  });

  it("returns null when a password is required to open the PDF", async () => {
    expect(await decryptOwnerProtectedPdf(await encrypted("open-sesame"))).toBeNull();
  });
});
