import { PDFDocument as CantooPDFDocument } from "@cantoo/pdf-lib";

/**
 * Many business PDFs carry "owner password" protection (restrictions only, no password to open).
 * pdf-lib cannot write to those, so we decrypt them with the empty user password using the
 * maintained @cantoo/pdf-lib fork. PDFs that need a password to open are rejected by the caller.
 */
export async function decryptOwnerProtectedPdf(bytes: Uint8Array): Promise<Uint8Array | null> {
  try {
    const doc = await CantooPDFDocument.load(bytes, { password: "", updateMetadata: false });
    if (doc.isEncrypted) return null;
    // Objects are now decrypted in memory; drop the stale /Encrypt reference before writing.
    delete (doc.context.trailerInfo as { Encrypt?: unknown }).Encrypt;
    return await doc.save();
  } catch {
    return null;
  }
}
