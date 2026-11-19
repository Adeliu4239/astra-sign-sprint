import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { headers } from "next/headers";
import { AppHeader } from "@/components/AppHeader";
import { StatusBadge } from "@/components/StatusBadge";
import { UploadForm } from "@/components/UploadForm";
import { FieldEditor } from "@/components/FieldEditor";
import { FieldsPreview } from "@/components/FieldsPreview";
import { LinkPanel } from "@/components/LinkPanel";
import { RestartButton } from "@/components/RestartButton";
import { AutoRefresh } from "@/components/AutoRefresh";
import { currentWorkspace } from "@/lib/server/session";
import { getCaseDetail, revealToken, signerUrl } from "@/lib/server/service";
import { HttpError } from "@/lib/server/errors";
import { originFromHeaders } from "@/lib/server/http";
import { formatBytes, formatUtc } from "@/lib/format";
import { caseStage } from "@/lib/signing/state";

export const dynamic = "force-dynamic";

const EVENT_LABEL: Record<string, string> = {
  case_created: "Case created",
  document_uploaded: "Document uploaded",
  document_from_template: "Document and fields copied from saved template",
  request_created: "Signing link created",
  request_revoked: "Signing link revoked",
  request_restarted: "New signing request started",
  signing_page_opened: "Signer opened the signing page",
  consent_given: "Signer consented to sign electronically",
  document_signed: "Signer submitted signature",
  request_completed: "Signed PDF generated — completed",
  signing_attempt_rejected: "Rejected attempt to reuse a closed link",
};

const REJECT_REASON: Record<string, string> = {
  completed: "already signed",
  revoked: "link revoked",
  expired: "link expired",
  not_sent: "request not active",
};

export default async function CasePage({ params }: { params: Promise<{ caseId: string }> }) {
  const ws = await currentWorkspace();
  if (!ws) redirect("/");
  const { caseId } = await params;
  let detail;
  try {
    detail = await getCaseDetail(ws.id, caseId);
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  const { case: c, request, document, signedDocument, fields, events, status } = detail;
  const origin = originFromHeaders(await headers());
  const token = request ? revealToken(request) : null;
  const docUrl = document ? `/api/documents/${document.id}` : null;
  const fromTemplate = events.find((e) => e.event_type === "document_from_template")?.metadata as { template_name?: string } | undefined;

  return (
    <>
      <AppHeader workspaceName={ws.name} />
      {status === "pending" && <AutoRefresh />}
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
        <div>
          <Link href="/dashboard" className="text-sm text-indigo-700 hover:underline">
            ← All cases
          </Link>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
            <div>
              <h1 className="text-2xl font-bold" data-testid="case-title">{c.title}</h1>
              <p className="text-sm text-slate-600">
                {c.client_name} · {c.client_email}
              </p>
              {fromTemplate?.template_name && (
                <p className="mt-1 text-xs text-slate-500" data-testid="from-template">
                  Prepared from template “{fromTemplate.template_name}” (this case has its own copy)
                </p>
              )}
            </div>
            <div className="flex items-center gap-3">
              <StatusBadge stage={caseStage(status, fields.filter((f) => f.kind === "signature").length)} />
              {status === "draft" && <UploadForm caseId={c.id} replacing fieldCount={fields.length} />}
            </div>
          </div>
        </div>

        {status === "no_document" && (
          <section className="card p-5">
            <h2 className="mb-1 font-semibold">Upload the agreement</h2>
            <p className="mb-4 text-sm text-slate-600">Upload the PDF this client needs to sign. You will place the signature field next.</p>
            <UploadForm caseId={c.id} />
          </section>
        )}

        {document && (
          <p className="text-xs text-slate-500" data-testid="document-meta">
            {document.filename} · {document.page_count} page{document.page_count === 1 ? "" : "s"} · {formatBytes(document.size_bytes)} · SHA-256{" "}
            <span className="font-mono">{document.sha256.slice(0, 16)}…</span>
          </p>
        )}

        {status === "draft" && request && docUrl && (
          <FieldEditor
            key={request.id}
            requestId={request.id}
            documentUrl={docUrl}
            initialFields={fields.map((f) => ({ key: f.id, kind: f.kind, pageIndex: f.page_index, x: f.x, y: f.y, width: f.width, height: f.height }))}
          />
        )}

        {status === "pending" && request && (
          <LinkPanel
            requestId={request.id}
            url={token ? signerUrl(origin, token) : null}
            clientName={c.client_name}
            clientEmail={c.client_email}
            caseTitle={c.title}
            expiresAt={formatUtc(request.expires_at)}
          />
        )}

        {status === "completed" && request && signedDocument && (
          <section className="card border-emerald-200 p-5" data-testid="completed-panel">
            <h2 className="font-semibold text-emerald-800">Signed by {request.signer_name} on {formatUtc(request.completed_at)}</h2>
            <p className="mt-1 text-sm text-slate-600">
              The executed PDF is stored separately from the original and cannot be changed. It includes a signing certificate page.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              <a className="btn-primary" href={`/api/documents/${signedDocument.id}?download=1`} data-testid="download-signed">
                Download signed PDF
              </a>
              <a className="btn-secondary" href={`/api/documents/${signedDocument.id}`} target="_blank" rel="noreferrer">
                View signed PDF
              </a>
              {docUrl && (
                <a className="btn-secondary" href={docUrl} target="_blank" rel="noreferrer">
                  View original
                </a>
              )}
            </div>
            <dl className="mt-4 grid gap-1 text-xs text-slate-600 sm:grid-cols-[160px_1fr]">
              <dt className="font-medium">Signed file</dt>
              <dd>{signedDocument.filename} · {signedDocument.page_count} pages · {formatBytes(signedDocument.size_bytes)}</dd>
              <dt className="font-medium">Signed SHA-256</dt>
              <dd className="break-all font-mono">{signedDocument.sha256}</dd>
              <dt className="font-medium">Original SHA-256</dt>
              <dd className="break-all font-mono">{document?.sha256}</dd>
            </dl>
          </section>
        )}

        {(status === "revoked" || status === "expired") && request && (
          <section className="card border-red-200 p-5">
            <h2 className="font-semibold text-red-700">This signing link is {status}.</h2>
            <p className="mt-1 mb-4 text-sm text-slate-600">The old link can no longer be used. Start a new request to send a fresh link with the same fields.</p>
            <RestartButton requestId={request.id} />
          </section>
        )}

        {status === "completed" && signedDocument && (
          <section>
            <h2 className="mb-3 font-semibold">Signed document</h2>
            <FieldsPreview url={`/api/documents/${signedDocument.id}`} fields={[]} />
          </section>
        )}

        {(status === "pending" || status === "revoked" || status === "expired") && docUrl && (
          <section>
            <h2 className="mb-3 font-semibold">Document and fields</h2>
            <FieldsPreview url={docUrl} fields={fields} />
          </section>
        )}

        <section className="card p-5">
          <h2 className="mb-3 font-semibold">Activity log (server-recorded, UTC)</h2>
          <ol className="flex flex-col gap-2 text-sm" data-testid="event-log">
            {events.map((e) => (
              <li key={e.id} className="flex flex-wrap gap-x-3" data-event={e.event_type}>
                <span className="w-40 shrink-0 font-mono text-xs text-slate-500">{formatUtc(e.occurred_at)}</span>
                <span>
                  {EVENT_LABEL[e.event_type] ?? e.event_type}
                  {e.event_type === "signing_attempt_rejected" && typeof (e.metadata as { reason?: unknown })?.reason === "string" && (
                    <span className="text-slate-500"> ({REJECT_REASON[(e.metadata as { reason: string }).reason] ?? (e.metadata as { reason: string }).reason})</span>
                  )}
                </span>
                <span className="text-xs text-slate-400">{e.actor}</span>
              </li>
            ))}
          </ol>
        </section>
      </main>
    </>
  );
}
