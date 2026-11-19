/**
 * Reusable agreement templates, exercised through the real service layer and a local Postgres.
 * Covers: snapshot independence of cases, template edits/replacement/deletion not affecting cases,
 * guards (templates can't be sent or listed as cases), and workspace isolation.
 */
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { PDFDocument } from "pdf-lib";
import { sql } from "@/lib/server/db";
import { hashSecret } from "@/lib/server/crypto";
import {
  countCasesFromTemplate,
  createCase,
  createTemplate,
  deleteTemplate,
  getCaseDetail,
  listCases,
  listTemplates,
  revokeRequest,
  saveFields,
  sendRequest,
  submitSignature,
  uploadDocument,
} from "@/lib/server/service";
import { makeAgreementPdf } from "../e2e/make-pdf";
import { signatureImageRect } from "../support/pdf-inspect";

const meta = { ip: "127.0.0.1", userAgent: "vitest" };
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAYAAAD0In+KAAAAEUlEQVR4nGNgYGD4z8DAwMAAAAgAAQ3cs1YAAAAASUVORK5CYII=";
// Page 2 (index 1) is A4; signature 180x50pt centred on the client signature line (320, 438).
const SIG = { kind: "signature" as const, pageIndex: 1, x: (320 - 90) / 595.28, y: (841.89 - 438 - 25) / 841.89, width: 180 / 595.28, height: 50 / 841.89 };
const DATE = { kind: "date" as const, pageIndex: 2, x: 0.6, y: 0.15, width: 0.15, height: 0.03 };
const client = (title: string, templateId?: string) => ({ title, clientName: "Taylor Example", clientEmail: "taylor@example.test", templateId });

async function newWorkspace(label: string) {
  const [w] = await sql()<{ id: string }[]>`
    insert into workspaces (name, session_hash) values (${`IT ${label}`}, ${hashSecret(randomBytes(32).toString("base64url"))}) returning id`;
  return w!.id;
}

async function draftOf(ws: string, id: string, kind: "client" | "template" = "client") {
  const d = await getCaseDetail(ws, id, kind);
  return { requestId: d.request!.id, documentId: d.document!.id, sha: d.document!.sha256, fields: d.fields, status: d.status };
}

const strip = (fs: { kind: string; page_index: number; x: number; y: number; width: number; height: number }[]) =>
  fs.map(({ kind, page_index, x, y, width, height }) => ({ kind, page_index, x, y, width, height }));

let wsA: string;
let wsB: string;
let templateId: string;
let templateRequestId: string;
let pdf: Buffer;

beforeAll(async () => {
  wsA = await newWorkspace("A");
  wsB = await newWorkspace("B");
  pdf = await makeAgreementPdf(`it-${Date.now().toString(36)}`);
  const t = await createTemplate(wsA, "Standard client agreement", meta);
  templateId = t.id;
  const up = await uploadDocument(wsA, templateId, pdf, "standard-agreement.pdf", "application/pdf", meta);
  templateRequestId = up.requestId;
  await saveFields(wsA, templateRequestId, [SIG, DATE]);
});

afterAll(async () => {
  await sql()`delete from workspaces where id in (${wsA}, ${wsB})`;
  await sql().end();
});

describe("reusable agreement templates", () => {
  it("lists the template with its PDF and field counts, and never as a case", async () => {
    const [t] = await listTemplates(wsA);
    expect(t).toMatchObject({ id: templateId, name: "Standard client agreement", filename: "standard-agreement.pdf", page_count: 3, signature_fields: 1, total_fields: 2 });
    expect((await listCases(wsA)).some((c) => c.id === templateId)).toBe(false);
    await expect(getCaseDetail(wsA, templateId, "client")).rejects.toMatchObject({ status: 404 });
  });

  it("cannot be sent, revoked or signed itself", async () => {
    await expect(sendRequest(wsA, templateRequestId, meta)).rejects.toMatchObject({ status: 409 });
    await expect(revokeRequest(wsA, templateRequestId, meta)).rejects.toMatchObject({ status: 409 });
  });

  it("two cases from one template get independent copies that sign independently", async () => {
    const c1 = await createCase(wsA, client("Case one", templateId), meta);
    const c2 = await createCase(wsA, client("Case two", templateId), meta);
    const t = await draftOf(wsA, templateId, "template");
    const d1 = await draftOf(wsA, c1.id);
    const d2 = await draftOf(wsA, c2.id);

    expect(d1.status).toBe("draft");
    expect(new Set([t.documentId, d1.documentId, d2.documentId]).size).toBe(3);
    expect(new Set([t.requestId, d1.requestId, d2.requestId]).size).toBe(3);
    expect(d1.sha).toBe(t.sha);
    expect(strip(d1.fields)).toEqual(strip(t.fields));
    expect(strip(d2.fields)).toEqual(strip(t.fields));
    expect(await countCasesFromTemplate(wsA, templateId)).toBe(2);

    // Editing one case's fields does not touch the other case or the template.
    await saveFields(wsA, d1.requestId, [{ ...SIG, x: 0.05 }]);
    expect(strip((await draftOf(wsA, c2.id)).fields)).toEqual(strip(t.fields));
    expect(strip((await draftOf(wsA, templateId, "template")).fields)).toEqual(strip(t.fields));

    // Sign case two; the stamped signature lies inside the template rectangle on page 2.
    const { token } = await sendRequest(wsA, d2.requestId, meta);
    const done = await submitSignature(token, { consent: true, signerName: "Taylor Example", method: "drawn", signaturePng: PNG }, meta);
    expect(done.completedAt).toBeTruthy();
    const detail2 = await getCaseDetail(wsA, c2.id);
    expect(detail2.status).toBe("completed");
    const [signed] = await sql()<{ content: Buffer }[]>`select content from documents where id = ${detail2.signedDocument!.id}`;
    const signedBytes = new Uint8Array(signed!.content);
    expect((await PDFDocument.load(signedBytes)).getPageCount()).toBe(4);
    expect(await signatureImageRect(signedBytes, 0)).toBeNull();
    const r = (await signatureImageRect(signedBytes, 1))!;
    expect(r.x).toBeGreaterThanOrEqual(229);
    expect(r.x + r.w).toBeLessThanOrEqual(411);
    expect(r.y).toBeGreaterThanOrEqual(412);
    expect(r.y + r.h).toBeLessThanOrEqual(464);

    // Case one is untouched by case two's completion.
    expect((await getCaseDetail(wsA, c1.id)).status).toBe("draft");
  });

  it("editing, replacing or deleting the template never changes existing cases", async () => {
    const c = await createCase(wsA, client("Snapshot case", templateId), meta);
    const before = await draftOf(wsA, c.id);
    const { token } = await sendRequest(wsA, before.requestId, meta); // pending link issued before the template changes

    await saveFields(wsA, templateRequestId, [{ ...SIG, pageIndex: 0, x: 0.1, y: 0.1 }]); // move template field
    const other = await makeAgreementPdf(`replacement-${Date.now()}`);
    const rep = await uploadDocument(wsA, templateId, other, "replacement.pdf", "application/pdf", meta); // replace PDF
    templateRequestId = rep.requestId;

    const mid = await getCaseDetail(wsA, c.id);
    expect(mid.status).toBe("pending");
    expect(mid.document!.id).toBe(before.documentId);
    expect(mid.document!.sha256).toBe(before.sha);
    expect(strip(mid.fields)).toEqual(strip(before.fields));

    await deleteTemplate(wsA, templateId);
    expect(await listTemplates(wsA)).toHaveLength(0);
    const after = await getCaseDetail(wsA, c.id);
    expect(after.case.template_id).toBeNull();
    expect(after.document!.sha256).toBe(before.sha);
    expect(strip(after.fields)).toEqual(strip(before.fields));
    expect(after.events.find((e) => e.event_type === "document_from_template")?.metadata).toMatchObject({ template_name: "Standard client agreement" });

    // The link issued before the template was deleted still signs, on the original layout.
    await submitSignature(token, { consent: true, signerName: "Taylor Example", method: "typed", signaturePng: PNG }, meta);
    const final = await getCaseDetail(wsA, c.id);
    expect(final.status).toBe("completed");
    const [signed] = await sql()<{ content: Buffer }[]>`select content from documents where id = ${final.signedDocument!.id}`;
    expect(await signatureImageRect(new Uint8Array(signed!.content), 1)).not.toBeNull();

    // A deleted template can't be used.
    await expect(createCase(wsA, client("Too late", templateId), meta)).rejects.toMatchObject({ status: 404 });
  });

  it("rejects incomplete templates without creating a case", async () => {
    const empty = await createTemplate(wsA, "Empty template", meta);
    const n0 = (await listCases(wsA)).length;
    await expect(createCase(wsA, client("No PDF", empty.id), meta)).rejects.toMatchObject({ status: 409 });
    const up = await uploadDocument(wsA, empty.id, pdf, "no-sig.pdf", "application/pdf", meta);
    await saveFields(wsA, up.requestId, [DATE]);
    await expect(createCase(wsA, client("No signature", empty.id), meta)).rejects.toMatchObject({ status: 409 });
    expect((await listCases(wsA)).length).toBe(n0); // transaction rolled back
  });

  it("is invisible and unusable from another workspace", async () => {
    const t = await createTemplate(wsA, "Private template", meta);
    const up = await uploadDocument(wsA, t.id, pdf, "private.pdf", "application/pdf", meta);
    await saveFields(wsA, up.requestId, [SIG]);

    expect(await listTemplates(wsB)).toHaveLength(0);
    await expect(getCaseDetail(wsB, t.id, "template")).rejects.toMatchObject({ status: 404 });
    await expect(createCase(wsB, client("Theft", t.id), meta)).rejects.toMatchObject({ status: 404 });
    await expect(saveFields(wsB, up.requestId, [])).rejects.toMatchObject({ status: 404 });
    await expect(uploadDocument(wsB, t.id, pdf, "x.pdf", "application/pdf", meta)).rejects.toMatchObject({ status: 404 });
    await expect(deleteTemplate(wsB, t.id)).rejects.toMatchObject({ status: 404 });
    expect(await listCases(wsB)).toHaveLength(0);
    // Still intact for its owner.
    expect((await listTemplates(wsA)).some((x) => x.id === t.id)).toBe(true);
  });
});
