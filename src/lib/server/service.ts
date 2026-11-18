import "server-only";
import type postgres from "postgres";
import { sql } from "./db";
import { decrypt, encrypt, hashIp, hashSecret, newSecret, sha256Hex } from "./crypto";
import { HttpError } from "./errors";
import { inspectPdf, stampPdf, type AuditLine } from "@/lib/pdf/stamp";
import { decryptOwnerProtectedPdf } from "@/lib/pdf/decrypt";
import {
  CONSENT_TEXT,
  MAX_PAGES,
  MAX_SIGNATURE_PNG_BYTES,
  MAX_UPLOAD_BYTES,
  UPLOAD_CHUNK_BYTES,
  type CreateCaseInput,
  type FieldInput,
  type SubmitSignatureInput,
} from "@/lib/schemas";
import { LINK_TTL_DAYS, checkCanSign, effectiveStatus, type EffectiveStatus, type RequestStatus } from "@/lib/signing/state";

type Tx = postgres.TransactionSql | postgres.Sql;
type Json = postgres.JSONValue;

export interface RequestMeta {
  ip: string | null;
  userAgent: string | null;
}

export async function logEvent(
  tx: Tx,
  e: {
    caseId: string;
    requestId?: string | null;
    type: string;
    actor: "admin" | "signer" | "system";
    meta?: RequestMeta;
    data?: Record<string, Json>;
  },
) {
  await tx`
    insert into signing_events (case_id, signing_request_id, event_type, actor, ip_hash, user_agent, metadata)
    values (${e.caseId}, ${e.requestId ?? null}, ${e.type}, ${e.actor}, ${hashIp(e.meta?.ip ?? null)},
            ${e.meta?.userAgent?.slice(0, 300) ?? null}, ${tx.json(e.data ?? {})})`;
}

/* ------------------------------------------------------------------ cases */

export interface CaseListItem {
  id: string;
  title: string;
  client_name: string;
  client_email: string;
  created_at: Date;
  filename: string | null;
  request_status: RequestStatus | null;
  expires_at: Date | null;
  completed_at: Date | null;
}

export async function listCases(workspaceId: string) {
  const rows = await sql()<CaseListItem[]>`
    select c.id, c.title, c.client_name, c.client_email, c.created_at,
           d.filename, r.status as request_status, r.expires_at, r.completed_at
    from cases c
    left join lateral (
      select * from signing_requests sr where sr.case_id = c.id order by sr.created_at desc limit 1
    ) r on true
    left join documents d on d.id = r.document_id
    where c.workspace_id = ${workspaceId}
    order by c.created_at desc`;
  return rows.map((r) => ({ ...r, status: caseStatus(r.request_status, r.expires_at) }));
}

export function caseStatus(s: RequestStatus | null, expiresAt: Date | null): EffectiveStatus | "no_document" {
  return s ? effectiveStatus(s, expiresAt) : "no_document";
}

export async function createCase(workspaceId: string, input: CreateCaseInput, meta: RequestMeta) {
  return sql().begin(async (tx) => {
    const [c] = await tx<{ id: string }[]>`
      insert into cases (workspace_id, title, client_name, client_email)
      values (${workspaceId}, ${input.title}, ${input.clientName}, ${input.clientEmail})
      returning id`;
    await logEvent(tx, { caseId: c!.id, type: "case_created", actor: "admin", meta, data: { title: input.title } });
    return c!;
  });
}

async function loadCase(tx: Tx, workspaceId: string, caseId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(caseId)) throw new HttpError(404, "Case not found");
  const [c] = await tx<{ id: string; title: string; client_name: string; client_email: string; created_at: Date }[]>`
    select id, title, client_name, client_email, created_at from cases
    where id = ${caseId} and workspace_id = ${workspaceId}`;
  if (!c) throw new HttpError(404, "Case not found");
  return c;
}

export interface RequestRow {
  id: string;
  case_id: string;
  document_id: string;
  status: RequestStatus;
  token_ciphertext: string | null;
  expires_at: Date | null;
  created_at: Date;
  sent_at: Date | null;
  completed_at: Date | null;
  revoked_at: Date | null;
  signer_name: string | null;
  signed_document_id: string | null;
}

export interface FieldRow {
  id: string;
  kind: FieldInput["kind"];
  page_index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface DocumentMeta {
  id: string;
  filename: string;
  size_bytes: number;
  page_count: number;
  sha256: string;
  created_at: Date;
}

export interface EventRow {
  id: string;
  event_type: string;
  actor: string;
  occurred_at: Date;
  metadata: Record<string, unknown>;
}

export async function getCaseDetail(workspaceId: string, caseId: string) {
  const db = sql();
  const c = await loadCase(db, workspaceId, caseId);
  const [request] = await db<RequestRow[]>`
    select id, case_id, document_id, status, token_ciphertext, expires_at, created_at, sent_at,
           completed_at, revoked_at, signer_name, signed_document_id
    from signing_requests where case_id = ${caseId} order by created_at desc limit 1`;
  let document: DocumentMeta | null = null;
  let signedDocument: DocumentMeta | null = null;
  let fields: FieldRow[] = [];
  if (request) {
    [document] = await db<DocumentMeta[]>`
      select id, filename, size_bytes, page_count, sha256, created_at from documents where id = ${request.document_id}`;
    if (request.signed_document_id) {
      [signedDocument] = await db<DocumentMeta[]>`
        select id, filename, size_bytes, page_count, sha256, created_at from documents where id = ${request.signed_document_id}`;
    }
    fields = await db<FieldRow[]>`
      select id, kind, page_index, x, y, width, height from signature_fields
      where signing_request_id = ${request.id} order by page_index, y, x`;
  }
  const events = await db<EventRow[]>`
    select id::text, event_type, actor, occurred_at, metadata from signing_events
    where case_id = ${caseId} order by occurred_at, id`;
  return {
    case: c,
    request: request ?? null,
    status: caseStatus(request?.status ?? null, request?.expires_at ?? null),
    document: document ?? null,
    signedDocument: signedDocument ?? null,
    fields,
    events,
  };
}

/* -------------------------------------------------------------- documents */

export function validatePdfUpload(bytes: Uint8Array, filename: string, mime: string) {
  if (bytes.byteLength === 0) throw new HttpError(400, "The file is empty.");
  if (bytes.byteLength > MAX_UPLOAD_BYTES) {
    throw new HttpError(413, `The file is ${(bytes.byteLength / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  }
  const looksPdfByName = /\.pdf$/i.test(filename);
  const looksPdfByMime = mime === "application/pdf" || mime === "application/x-pdf";
  if (!looksPdfByName && !looksPdfByMime) throw new HttpError(415, "Only PDF files are supported.");
  // Magic number: "%PDF-" must appear in the first 1 KB (PDF spec allows leading junk).
  const head = Buffer.from(bytes.subarray(0, 1024)).toString("latin1");
  if (!head.includes("%PDF-")) throw new HttpError(415, "This file is not a valid PDF (missing PDF header).");
}

export function sanitizeFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "document.pdf";
  const clean = base.replace(/[^\w.\- ()]+/g, "_").replace(/\s+/g, " ").trim().slice(0, 120);
  const withExt = /\.pdf$/i.test(clean) ? clean : `${clean || "document"}.pdf`;
  return withExt;
}

export async function uploadDocument(
  workspaceId: string,
  caseId: string,
  bytes: Uint8Array,
  rawFilename: string,
  mime: string,
  meta: RequestMeta,
) {
  validatePdfUpload(bytes, rawFilename, mime);
  const uploadedSha = sha256Hex(bytes);
  let info;
  try {
    info = await inspectPdf(bytes);
  } catch (e) {
    throw new HttpError(422, e instanceof Error ? e.message : "Could not read PDF");
  }
  let decrypted = false;
  if (info.encrypted) {
    const plain = await decryptOwnerProtectedPdf(bytes);
    if (!plain) {
      throw new HttpError(422, "This PDF needs a password to open. Remove the password (for example, print it to a new PDF) and upload again.");
    }
    bytes = plain;
    decrypted = true;
    try {
      info = await inspectPdf(bytes);
    } catch {
      throw new HttpError(422, "This protected PDF could not be prepared for signing. Print it to a new PDF and upload again.");
    }
    if (info.encrypted) throw new HttpError(422, "This PDF is encrypted and cannot be signed. Print it to a new PDF and upload again.");
  }
  if (info.pageCount > MAX_PAGES) throw new HttpError(422, `This PDF has ${info.pageCount} pages; the limit is ${MAX_PAGES}.`);
  const filename = sanitizeFilename(rawFilename);
  const sha = sha256Hex(bytes);

  return sql().begin(async (tx) => {
    await loadCase(tx, workspaceId, caseId);
    const [latest] = await tx<{ id: string; status: RequestStatus }[]>`
      select id, status from signing_requests where case_id = ${caseId} order by created_at desc limit 1 for update`;
    if (latest && (latest.status === "pending" || latest.status === "completed")) {
      throw new HttpError(409, "This case already has a document out for signature. Revoke the request before replacing the document.");
    }
    if (latest?.status === "draft") {
      await tx`delete from signing_requests where id = ${latest.id}`;
    }
    const [doc] = await tx<{ id: string }[]>`
      insert into documents (case_id, kind, filename, mime, size_bytes, page_count, sha256, content)
      values (${caseId}, 'original', ${filename}, 'application/pdf', ${bytes.byteLength}, ${info.pageCount}, ${sha}, ${Buffer.from(bytes)})
      returning id`;
    const [req] = await tx<{ id: string }[]>`
      insert into signing_requests (case_id, document_id) values (${caseId}, ${doc!.id}) returning id`;
    await logEvent(tx, {
      caseId,
      requestId: req!.id,
      type: "document_uploaded",
      actor: "admin",
      meta,
      data: {
        filename,
        pages: info.pageCount,
        bytes: bytes.byteLength,
        sha256: sha,
        ...(decrypted ? { uploaded_sha256: uploadedSha, note: "owner-password protection removed for signing" } : {}),
      },
    });
    return { documentId: doc!.id, requestId: req!.id, pageCount: info.pageCount };
  });
}

/* ------------------------------------------------------- chunked uploads */

export async function startChunkedUpload(workspaceId: string, caseId: string, filename: string, mime: string, size: number) {
  if (size > MAX_UPLOAD_BYTES) throw new HttpError(413, `The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`);
  if (!/\.pdf$/i.test(filename) && mime !== "application/pdf") throw new HttpError(415, "Only PDF files are supported.");
  const db = sql();
  await loadCase(db, workspaceId, caseId);
  // Opportunistic cleanup of abandoned sessions.
  await db`delete from upload_sessions where created_at < now() - interval '1 day'`;
  const chunkCount = Math.ceil(size / UPLOAD_CHUNK_BYTES);
  const [u] = await db<{ id: string }[]>`
    insert into upload_sessions (case_id, filename, mime, total_bytes, chunk_count)
    values (${caseId}, ${filename}, ${mime}, ${size}, ${chunkCount}) returning id`;
  return { uploadId: u!.id, chunkSize: UPLOAD_CHUNK_BYTES, chunkCount };
}

async function loadUploadSession(workspaceId: string, uploadId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(uploadId)) throw new HttpError(404, "Upload not found");
  const [u] = await sql()<{ id: string; case_id: string; filename: string; mime: string; total_bytes: number; chunk_count: number }[]>`
    select u.id, u.case_id, u.filename, u.mime, u.total_bytes, u.chunk_count from upload_sessions u
    join cases c on c.id = u.case_id where u.id = ${uploadId} and c.workspace_id = ${workspaceId}`;
  if (!u) throw new HttpError(404, "Upload not found or expired. Please start the upload again.");
  return u;
}

export async function putUploadChunk(workspaceId: string, uploadId: string, index: number, data: Uint8Array) {
  const u = await loadUploadSession(workspaceId, uploadId);
  if (!Number.isInteger(index) || index < 0 || index >= u.chunk_count) throw new HttpError(400, "Invalid chunk index");
  const expected = index === u.chunk_count - 1 ? u.total_bytes - index * UPLOAD_CHUNK_BYTES : UPLOAD_CHUNK_BYTES;
  if (data.byteLength !== expected) throw new HttpError(400, "Chunk size mismatch. Please retry the upload.");
  await sql()`
    insert into upload_chunks (upload_id, idx, data) values (${uploadId}, ${index}, ${Buffer.from(data)})
    on conflict (upload_id, idx) do update set data = excluded.data`;
}

export async function completeChunkedUpload(workspaceId: string, uploadId: string, meta: RequestMeta) {
  const u = await loadUploadSession(workspaceId, uploadId);
  const chunks = await sql()<{ idx: number; data: Buffer }[]>`
    select idx, data from upload_chunks where upload_id = ${uploadId} order by idx`;
  if (chunks.length !== u.chunk_count || chunks.some((c, i) => c.idx !== i)) {
    throw new HttpError(400, "Some parts of the file are missing. Please retry the upload.");
  }
  const bytes = new Uint8Array(Buffer.concat(chunks.map((c) => c.data)));
  if (bytes.byteLength !== u.total_bytes) throw new HttpError(400, "Uploaded size does not match. Please retry the upload.");
  try {
    return await uploadDocument(workspaceId, u.case_id, bytes, u.filename, u.mime, meta);
  } finally {
    await sql()`delete from upload_sessions where id = ${uploadId}`;
  }
}

/** Admin-only document read; scoped through the case's workspace. */
export async function getDocumentForWorkspace(workspaceId: string, documentId: string) {
  if (!/^[0-9a-f-]{36}$/i.test(documentId)) throw new HttpError(404, "Document not found");
  const [doc] = await sql()<{ filename: string; kind: string; content: Buffer }[]>`
    select d.filename, d.kind, d.content from documents d join cases c on c.id = d.case_id
    where d.id = ${documentId} and c.workspace_id = ${workspaceId}`;
  if (!doc) throw new HttpError(404, "Document not found");
  return doc;
}

/* ----------------------------------------------------------------- fields */

async function loadRequestForAdmin(tx: Tx, workspaceId: string, requestId: string, lock = false) {
  if (!/^[0-9a-f-]{36}$/i.test(requestId)) throw new HttpError(404, "Signing request not found");
  const rows = lock
    ? await tx<(RequestRow & { page_count: number; client_email: string; client_name: string })[]>`
        select r.*, d.page_count, c.client_email, c.client_name from signing_requests r
        join cases c on c.id = r.case_id join documents d on d.id = r.document_id
        where r.id = ${requestId} and c.workspace_id = ${workspaceId} for update of r`
    : await tx<(RequestRow & { page_count: number; client_email: string; client_name: string })[]>`
        select r.*, d.page_count, c.client_email, c.client_name from signing_requests r
        join cases c on c.id = r.case_id join documents d on d.id = r.document_id
        where r.id = ${requestId} and c.workspace_id = ${workspaceId}`;
  const r = rows[0];
  if (!r) throw new HttpError(404, "Signing request not found");
  return r;
}

export async function saveFields(workspaceId: string, requestId: string, fields: FieldInput[]) {
  return sql().begin(async (tx) => {
    const r = await loadRequestForAdmin(tx, workspaceId, requestId, true);
    if (r.status !== "draft") throw new HttpError(409, "Fields are locked once the signing link has been created.");
    for (const f of fields) {
      if (f.pageIndex >= r.page_count) throw new HttpError(400, `Field is on page ${f.pageIndex + 1}, but the PDF has ${r.page_count} pages.`);
    }
    await tx`delete from signature_fields where signing_request_id = ${requestId}`;
    for (const f of fields) {
      await tx`
        insert into signature_fields (signing_request_id, kind, page_index, x, y, width, height)
        values (${requestId}, ${f.kind}, ${f.pageIndex}, ${f.x}, ${f.y}, ${f.width}, ${f.height})`;
    }
    return { count: fields.length };
  });
}

/* ------------------------------------------------------- request lifecycle */

export function signerUrl(origin: string, token: string) {
  return `${origin.replace(/\/$/, "")}/sign/${token}`;
}

export async function sendRequest(workspaceId: string, requestId: string, meta: RequestMeta) {
  return sql().begin(async (tx) => {
    const r = await loadRequestForAdmin(tx, workspaceId, requestId, true);
    if (r.status !== "draft") throw new HttpError(409, "A signing link was already created for this request.");
    const fields = await tx<{ kind: string; page_index: number }[]>`
      select kind, page_index from signature_fields where signing_request_id = ${requestId}`;
    if (!fields.some((f) => f.kind === "signature")) {
      throw new HttpError(400, "Place at least one signature field before creating the signing link.");
    }
    const token = newSecret();
    const expires = new Date(Date.now() + LINK_TTL_DAYS * 24 * 3600 * 1000);
    await tx`
      update signing_requests set status = 'pending', token_hash = ${hashSecret(token)},
        token_ciphertext = ${encrypt(token)}, sent_at = now(), expires_at = ${expires}
      where id = ${requestId} and status = 'draft'`;
    await logEvent(tx, {
      caseId: r.case_id,
      requestId,
      type: "request_created",
      actor: "admin",
      meta,
      data: {
        signer_email: r.client_email,
        fields: fields.length,
        pages_with_fields: [...new Set(fields.map((f) => f.page_index + 1))].sort((a, b) => a - b),
        expires_at: expires.toISOString(),
      },
    });
    return { token, expiresAt: expires };
  });
}

/** Re-displays a pending link to its admin. Only the hash is used for lookups. */
export function revealToken(r: Pick<RequestRow, "status" | "token_ciphertext">): string | null {
  if (r.status !== "pending" || !r.token_ciphertext) return null;
  try {
    return decrypt(r.token_ciphertext);
  } catch {
    return null;
  }
}

export async function revokeRequest(workspaceId: string, requestId: string, meta: RequestMeta) {
  return sql().begin(async (tx) => {
    const r = await loadRequestForAdmin(tx, workspaceId, requestId, true);
    if (r.status !== "pending") throw new HttpError(409, "Only a pending request can be revoked.");
    await tx`update signing_requests set status = 'revoked', revoked_at = now(), token_ciphertext = null where id = ${requestId}`;
    await logEvent(tx, { caseId: r.case_id, requestId, type: "request_revoked", actor: "admin", meta });
  });
}

/** After a revoke/expiry: start a fresh draft on the same document, copying the field layout. */
export async function restartRequest(workspaceId: string, requestId: string, meta: RequestMeta) {
  return sql().begin(async (tx) => {
    const r = await loadRequestForAdmin(tx, workspaceId, requestId, true);
    const eff = effectiveStatus(r.status, r.expires_at);
    if (eff !== "revoked" && eff !== "expired") throw new HttpError(409, "Only a revoked or expired request can be restarted.");
    const [latest] = await tx<{ id: string }[]>`
      select id from signing_requests where case_id = ${r.case_id} order by created_at desc limit 1`;
    if (latest?.id !== requestId) throw new HttpError(409, "A newer request already exists for this case.");
    if (eff === "expired") {
      await tx`update signing_requests set status = 'revoked', revoked_at = now(), token_ciphertext = null where id = ${requestId}`;
    }
    const [n] = await tx<{ id: string }[]>`
      insert into signing_requests (case_id, document_id) values (${r.case_id}, ${r.document_id}) returning id`;
    await tx`
      insert into signature_fields (signing_request_id, kind, page_index, x, y, width, height)
      select ${n!.id}, kind, page_index, x, y, width, height from signature_fields where signing_request_id = ${requestId}`;
    await logEvent(tx, { caseId: r.case_id, requestId: n!.id, type: "request_restarted", actor: "admin", meta });
    return { requestId: n!.id };
  });
}

/* ------------------------------------------------------------------ signer */

export interface SignerView {
  requestId: string;
  caseId: string;
  status: EffectiveStatus;
  caseTitle: string;
  clientName: string;
  clientEmail: string;
  workspaceName: string;
  filename: string;
  pageCount: number;
  expiresAt: Date | null;
  completedAt: Date | null;
  fields: FieldRow[];
}

function tokenLooksValid(token: string) {
  return /^[A-Za-z0-9_-]{30,64}$/.test(token);
}

export async function getSignerView(token: string): Promise<SignerView | null> {
  if (!tokenLooksValid(token)) return null;
  const db = sql();
  const [r] = await db<
    {
      id: string;
      case_id: string;
      status: RequestStatus;
      expires_at: Date | null;
      completed_at: Date | null;
      title: string;
      client_name: string;
      client_email: string;
      ws_name: string;
      filename: string;
      page_count: number;
    }[]
  >`
    select r.id, r.case_id, r.status, r.expires_at, r.completed_at, c.title, c.client_name, c.client_email,
           w.name as ws_name, d.filename, d.page_count
    from signing_requests r join cases c on c.id = r.case_id join workspaces w on w.id = c.workspace_id
    join documents d on d.id = r.document_id
    where r.token_hash = ${hashSecret(token)}`;
  if (!r) return null;
  const fields = await db<FieldRow[]>`
    select id, kind, page_index, x, y, width, height from signature_fields
    where signing_request_id = ${r.id} order by page_index, y, x`;
  return {
    requestId: r.id,
    caseId: r.case_id,
    status: effectiveStatus(r.status, r.expires_at),
    caseTitle: r.title,
    clientName: r.client_name,
    clientEmail: r.client_email,
    workspaceName: r.ws_name,
    filename: r.filename,
    pageCount: r.page_count,
    expiresAt: r.expires_at,
    completedAt: r.completed_at,
    fields,
  };
}

export async function logSignerOpened(view: SignerView, meta: RequestMeta) {
  await logEvent(sql(), { caseId: view.caseId, requestId: view.requestId, type: "signing_page_opened", actor: "signer", meta });
}

/** Signer may read the original while pending, and the signed copy once completed. */
export async function getSignerDocument(token: string, which: "original" | "signed") {
  if (!tokenLooksValid(token)) throw new HttpError(404, "This signing link is not valid.");
  const [row] = await sql()<{ status: RequestStatus; expires_at: Date | null; filename: string; content: Buffer | null }[]>`
    select r.status, r.expires_at, d.filename, d.content
    from signing_requests r
    left join documents d on d.id = ${which === "original" ? sql()`r.document_id` : sql()`r.signed_document_id`}
    where r.token_hash = ${hashSecret(token)}`;
  if (!row) throw new HttpError(404, "This signing link is not valid.");
  const eff = effectiveStatus(row.status, row.expires_at);
  if (which === "original" && eff !== "pending") throw new HttpError(410, "This signing link is no longer active.");
  if (which === "signed" && (eff !== "completed" || !row.content)) throw new HttpError(404, "The signed document is not available.");
  return { filename: row.filename, content: row.content! };
}

function decodePng(dataUrl: string): Uint8Array {
  const bytes = Buffer.from(dataUrl.slice(dataUrl.indexOf(",") + 1), "base64");
  if (bytes.byteLength > MAX_SIGNATURE_PNG_BYTES) throw new HttpError(413, "Signature image is too large.");
  const sig = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
  if (bytes.byteLength < 33 || !sig.every((b, i) => bytes[i] === b)) throw new HttpError(400, "Signature image is invalid.");
  return bytes;
}

const utc = (d: Date) => d.toISOString().replace("T", " ").replace(/\.\d+Z$/, " UTC");

const eventLabels: Record<string, string> = {
  case_created: "Case created",
  document_uploaded: "Document uploaded",
  request_created: "Signing link created",
  signing_page_opened: "Signer opened signing page",
  consent_given: "Signer consented to electronic signature",
  document_signed: "Signer submitted signature",
  request_completed: "Signed PDF generated; request completed",
};

export async function submitSignature(token: string, input: SubmitSignatureInput, meta: RequestMeta) {
  if (!tokenLooksValid(token)) throw new HttpError(404, "This signing link is not valid.");
  const png = decodePng(input.signaturePng);

  return sql().begin(async (tx) => {
    // Row lock serialises concurrent/double submissions; the second waits, then sees "completed".
    const [r] = await tx<
      (RequestRow & { title: string; client_email: string; ws_name: string; filename: string; content: Buffer; doc_sha: string })[]
    >`
      select r.*, c.title, c.client_email, w.name as ws_name, d.filename, d.content, d.sha256 as doc_sha
      from signing_requests r join cases c on c.id = r.case_id join workspaces w on w.id = c.workspace_id
      join documents d on d.id = r.document_id
      where r.token_hash = ${hashSecret(token)}
      for update of r`;
    if (!r) throw new HttpError(404, "This signing link is not valid.");
    const check = checkCanSign(r.status, r.expires_at);
    if (!check.ok) {
      const messages = {
        completed: "This document has already been signed. It cannot be signed again.",
        revoked: "This signing request was cancelled by the sender.",
        expired: "This signing link has expired. Ask the sender for a new link.",
        not_sent: "This signing request is not active.",
      } as const;
      throw new HttpError(409, messages[check.reason], check.reason);
    }
    const fields = await tx<FieldRow[]>`
      select id, kind, page_index, x, y, width, height from signature_fields where signing_request_id = ${r.id}`;
    if (!fields.some((f) => f.kind === "signature")) throw new HttpError(409, "This request has no signature field.");

    const signedAt = new Date();
    await logEvent(tx, {
      caseId: r.case_id,
      requestId: r.id,
      type: "consent_given",
      actor: "signer",
      meta,
      data: { consent_text: CONSENT_TEXT },
    });

    const priorEvents = await tx<{ event_type: string; occurred_at: Date }[]>`
      select event_type, occurred_at from signing_events where signing_request_id = ${r.id} order by occurred_at, id`;
    const certEvents: AuditLine[] = [
      ...priorEvents.map((e) => ({ label: utc(e.occurred_at), value: eventLabels[e.event_type] ?? e.event_type })),
      { label: utc(signedAt), value: eventLabels.document_signed! },
    ];

    let signedBytes: Uint8Array;
    try {
      signedBytes = await stampPdf({
        original: r.content,
        fields: fields.map((f) => ({ kind: f.kind, pageIndex: f.page_index, x: f.x, y: f.y, width: f.width, height: f.height })),
        signaturePng: png,
        signerName: input.signerName,
        dateText: signedAt.toISOString().slice(0, 10),
        certificate: {
          title: "Signing certificate",
          rows: [
            { label: "Document", value: r.filename },
            { label: "Case", value: r.title },
            { label: "Sent by", value: r.ws_name },
            { label: "Signer name", value: input.signerName },
            { label: "Signer email", value: `${r.client_email} (provided by sender, not verified)` },
            { label: "Signature method", value: input.method === "drawn" ? "Drawn by hand" : "Typed name" },
            { label: "Consent", value: CONSENT_TEXT },
            { label: "Signed at", value: utc(signedAt) },
            { label: "Request ID", value: r.id },
            { label: "Original SHA-256", value: r.doc_sha },
            { label: "Signer IP (hashed)", value: hashIp(meta.ip) ?? "unknown" },
          ],
          events: certEvents,
        },
      });
    } catch (e) {
      console.error("Stamping failed:", e instanceof Error ? e.message : e);
      throw new HttpError(500, "We could not generate the signed PDF. Nothing was saved; please try again.");
    }
    const signedSha = sha256Hex(signedBytes);
    const signedName = r.filename.replace(/\.pdf$/i, "") + " (signed).pdf";
    const pageCount = (await inspectPdf(signedBytes)).pageCount;
    const [doc] = await tx<{ id: string }[]>`
      insert into documents (case_id, kind, filename, mime, size_bytes, page_count, sha256, content)
      values (${r.case_id}, 'signed', ${signedName}, 'application/pdf', ${signedBytes.byteLength}, ${pageCount}, ${signedSha}, ${Buffer.from(signedBytes)})
      returning id`;
    const updated = await tx`
      update signing_requests set status = 'completed', completed_at = ${signedAt}, signer_name = ${input.signerName},
        signed_document_id = ${doc!.id}, token_ciphertext = null
      where id = ${r.id} and status = 'pending'`;
    if (updated.count !== 1) throw new HttpError(409, "This document has already been signed.", "completed");
    await logEvent(tx, {
      caseId: r.case_id,
      requestId: r.id,
      type: "document_signed",
      actor: "signer",
      meta,
      data: { signer_name: input.signerName, method: input.method },
    });
    await logEvent(tx, {
      caseId: r.case_id,
      requestId: r.id,
      type: "request_completed",
      actor: "system",
      data: { signed_sha256: signedSha, original_sha256: r.doc_sha, signed_bytes: signedBytes.byteLength },
    });
    return { completedAt: signedAt, signedSha256: signedSha };
  });
}

/** Records a rejected attempt to reuse a closed link (outside the failed transaction). */
export async function logRejectedAttempt(token: string, reason: string, meta: RequestMeta) {
  if (!tokenLooksValid(token)) return;
  const [r] = await sql()<{ id: string; case_id: string }[]>`
    select id, case_id from signing_requests where token_hash = ${hashSecret(token)}`;
  if (r) await logEvent(sql(), { caseId: r.case_id, requestId: r.id, type: "signing_attempt_rejected", actor: "signer", meta, data: { reason } });
}
