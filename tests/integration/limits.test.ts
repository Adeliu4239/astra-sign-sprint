/**
 * Abuse and resource limits, exercised through the real service layer and a LOCAL Postgres:
 * atomic DB-backed rate limits, per-workspace storage quota (including under concurrency),
 * chunked-upload session caps and expiry, and cleanup of replaced draft PDFs.
 */
import { beforeAll, describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { sql } from "@/lib/server/db";
import { hashSecret } from "@/lib/server/crypto";
import { HttpError } from "@/lib/server/errors";
import { consumeRateLimit, enforceUploadStartLimit, enforceWorkspaceCreateLimit } from "@/lib/server/limits";
import { completeChunkedUpload, createCase, putUploadChunk, startChunkedUpload, uploadDocument } from "@/lib/server/service";
import { LIMITS } from "@/lib/limits";
import { UPLOAD_CHUNK_BYTES } from "@/lib/schemas";
import { makeAgreementPdf } from "../e2e/make-pdf";

const meta = { ip: "127.0.0.1", userAgent: "vitest" };
const uniq = () => randomBytes(6).toString("hex");

async function newWorkspace() {
  const [w] = await sql()<{ id: string }[]>`
    insert into workspaces (name, session_hash) values (${`IT limits ${uniq()}`}, ${hashSecret(randomBytes(32).toString("base64url"))}) returning id`;
  return w!.id;
}
const newCase = (ws: string, title = "Limits case") => createCase(ws, { title, clientName: "Sam Example", clientEmail: "sam@example.test" }, meta);

/** Test fixture: a stored original whose recorded size fills most of the quota (tiny actual bytes). */
async function fillStorage(caseId: string, bytes: number) {
  await sql()`
    insert into documents (case_id, kind, filename, size_bytes, page_count, sha256, content)
    values (${caseId}, 'original', 'filler.pdf', ${bytes}, 1, ${"0".repeat(64)}, ${Buffer.from("%PDF-filler")})`;
}

async function expectHttp(p: Promise<unknown>, status: number, code?: string) {
  const err = await p.then(
    () => null,
    (e: unknown) => e,
  );
  expect(err).toBeInstanceOf(HttpError);
  expect((err as HttpError).status).toBe(status);
  if (code) expect((err as HttpError).code).toBe(code);
  return err as HttpError;
}

let pdf: Buffer;
beforeAll(async () => {
  pdf = await makeAgreementPdf(`limits-${uniq()}`);
});

describe("rate limits (Postgres fixed window)", () => {
  it("is atomic under concurrency: exactly `limit` of 25 parallel hits are allowed", async () => {
    const bucket = `test:${uniq()}`;
    const results = await Promise.all(Array.from({ length: 25 }, () => consumeRateLimit(bucket, 10)));
    expect(results.filter((r) => r.allowed)).toHaveLength(10);
    expect(new Set(results.map((r) => r.hits)).size).toBe(25);
    expect(results.every((r) => r.retryAfterSeconds > 0 && r.retryAfterSeconds <= 3600)).toBe(true);
  });

  it(`allows ${LIMITS.workspaceCreatesPerIpPerHour} workspace creations per IP per hour, then 429 with Retry-After`, async () => {
    const ip = `203.0.113.${Math.floor(Math.random() * 250)}-${uniq()}`;
    for (let i = 0; i < LIMITS.workspaceCreatesPerIpPerHour; i++) await enforceWorkspaceCreateLimit(ip);
    const err = await expectHttp(enforceWorkspaceCreateLimit(ip), 429, "rate_limited");
    expect(Number(err.headers?.["Retry-After"])).toBeGreaterThan(0);
    // A different IP is unaffected.
    await enforceWorkspaceCreateLimit(`198.51.100.7-${uniq()}`);
  });

  it(`allows ${LIMITS.uploadStartsPerWorkspacePerHour} upload starts per workspace per hour`, async () => {
    const ws = await newWorkspace();
    for (let i = 0; i < LIMITS.uploadStartsPerWorkspacePerHour; i++) await enforceUploadStartLimit(ws, `ip-${uniq()}`);
    await expectHttp(enforceUploadStartLimit(ws, `ip-${uniq()}`), 429, "rate_limited");
    // Another workspace on the same network still can.
    await enforceUploadStartLimit(await newWorkspace(), `ip-${uniq()}`);
  });
});

describe("per-workspace storage quota", () => {
  it("refuses an upload that would exceed the quota and accepts one that fits", async () => {
    const ws = await newWorkspace();
    const filler = await newCase(ws, "filler");
    await fillStorage(filler.id, LIMITS.workspaceStorageBytes - pdf.byteLength - 10);
    const c = await newCase(ws);
    await uploadDocument(ws, c.id, new Uint8Array(pdf), "fits.pdf", "application/pdf", meta);
    const c2 = await newCase(ws);
    const err = await expectHttp(uploadDocument(ws, c2.id, new Uint8Array(pdf), "too-much.pdf", "application/pdf", meta), 413, "storage_quota");
    expect(err.message).toMatch(/storage limit/);
    // Other workspaces are unaffected.
    const other = await newWorkspace();
    await uploadDocument(other, (await newCase(other)).id, new Uint8Array(pdf), "ok.pdf", "application/pdf", meta);
  });

  it("holds under concurrency: of two uploads that only fit one at a time, exactly one succeeds", async () => {
    const ws = await newWorkspace();
    await fillStorage((await newCase(ws, "filler")).id, LIMITS.workspaceStorageBytes - Math.floor(pdf.byteLength * 1.5));
    const [a, b] = [await newCase(ws, "A"), await newCase(ws, "B")];
    const results = await Promise.allSettled([
      uploadDocument(ws, a.id, new Uint8Array(pdf), "a.pdf", "application/pdf", meta),
      uploadDocument(ws, b.id, new Uint8Array(pdf), "b.pdf", "application/pdf", meta),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    const rejected = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    expect((rejected.reason as HttpError).code).toBe("storage_quota");
  });

  it("replacing a draft PDF frees the replaced copy, so repeated replacements do not exhaust the quota", async () => {
    const ws = await newWorkspace();
    const c = await newCase(ws);
    const first = await uploadDocument(ws, c.id, new Uint8Array(pdf), "v1.pdf", "application/pdf", meta);
    const second = await uploadDocument(ws, c.id, new Uint8Array(pdf), "v2.pdf", "application/pdf", meta);
    const docs = await sql()<{ id: string }[]>`select id from documents where case_id = ${c.id}`;
    expect(docs.map((d) => d.id)).toEqual([second.documentId]);
    expect(first.documentId).not.toBe(second.documentId);
  });
});

describe("chunked upload sessions", () => {
  const size = UPLOAD_CHUNK_BYTES + 100; // two chunks

  it(`allows ${LIMITS.concurrentUploadSessions} concurrent sessions per workspace, then 429`, async () => {
    const ws = await newWorkspace();
    for (let i = 0; i < LIMITS.concurrentUploadSessions; i++) {
      await startChunkedUpload(ws, (await newCase(ws, `c${i}`)).id, "big.pdf", "application/pdf", size);
    }
    await expectHttp(startChunkedUpload(ws, (await newCase(ws, "extra")).id, "big.pdf", "application/pdf", size), 429, "upload_concurrency");
  });

  it("a retry on the same case supersedes its unfinished session instead of being blocked", async () => {
    const ws = await newWorkspace();
    const c = await newCase(ws);
    const first = await startChunkedUpload(ws, c.id, "big.pdf", "application/pdf", size);
    for (let i = 0; i < LIMITS.concurrentUploadSessions + 2; i++) await startChunkedUpload(ws, c.id, "big.pdf", "application/pdf", size);
    const open = await sql()<{ n: number }[]>`select count(*)::int as n from upload_sessions where case_id = ${c.id}`;
    expect(open[0]!.n).toBe(1);
    await expectHttp(putUploadChunk(ws, first.uploadId, 0, new Uint8Array(UPLOAD_CHUNK_BYTES)), 404);
  });

  it(`sessions older than ${LIMITS.uploadSessionTtlMinutes} min are unusable and do not count`, async () => {
    const ws = await newWorkspace();
    const cases = [];
    for (let i = 0; i < LIMITS.concurrentUploadSessions; i++) {
      const c = await newCase(ws, `old${i}`);
      cases.push(c);
      await startChunkedUpload(ws, c.id, "big.pdf", "application/pdf", size);
    }
    const ids = cases.map((c) => c.id);
    await sql()`update upload_sessions set created_at = now() - interval '2 hours' where case_id = any(${ids})`;
    const [s] = await sql()<{ id: string }[]>`select id from upload_sessions where case_id = ${ids[0]!}`;
    await expectHttp(completeChunkedUpload(ws, s!.id, meta), 404);
    // Expired sessions no longer block a new one.
    await startChunkedUpload(ws, (await newCase(ws, "fresh")).id, "big.pdf", "application/pdf", size);
  });

  it("refuses at start (before any bytes are sent) when the file can never fit the quota", async () => {
    const ws = await newWorkspace();
    await fillStorage((await newCase(ws, "filler")).id, LIMITS.workspaceStorageBytes - 1000);
    await expectHttp(startChunkedUpload(ws, (await newCase(ws)).id, "big.pdf", "application/pdf", size), 413, "storage_quota");
  });

  it("a complete chunked upload still works end to end", async () => {
    const ws = await newWorkspace();
    const c = await newCase(ws);
    // Pad the PDF past one chunk so it really takes the chunked path.
    const padded = Buffer.concat([pdf, Buffer.alloc(UPLOAD_CHUNK_BYTES + 10 - pdf.byteLength > 0 ? UPLOAD_CHUNK_BYTES + 10 - pdf.byteLength : 0, 0x20)]);
    const s = await startChunkedUpload(ws, c.id, "big.pdf", "application/pdf", padded.byteLength);
    expect(s.chunkCount).toBe(2);
    for (let i = 0; i < s.chunkCount; i++) {
      await putUploadChunk(ws, s.uploadId, i, new Uint8Array(padded.subarray(i * s.chunkSize, (i + 1) * s.chunkSize)));
    }
    const done = await completeChunkedUpload(ws, s.uploadId, meta);
    expect(done.pageCount).toBe(3);
    const left = await sql()<{ n: number }[]>`select count(*)::int as n from upload_sessions where case_id = ${c.id}`;
    expect(left[0]!.n).toBe(0);
  });
});
