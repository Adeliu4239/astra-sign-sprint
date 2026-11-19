import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { UploadForm } from "@/components/UploadForm";
import { FieldEditor } from "@/components/FieldEditor";
import { DeleteTemplateButton } from "@/components/DeleteTemplateButton";
import { currentWorkspace } from "@/lib/server/session";
import { countCasesFromTemplate, getCaseDetail } from "@/lib/server/service";
import { HttpError } from "@/lib/server/errors";
import { formatBytes } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TemplatePage({ params }: { params: Promise<{ templateId: string }> }) {
  const ws = await currentWorkspace();
  if (!ws) redirect("/");
  const { templateId } = await params;
  let detail;
  try {
    detail = await getCaseDetail(ws.id, templateId, "template");
  } catch (e) {
    if (e instanceof HttpError && e.status === 404) notFound();
    throw e;
  }
  const { case: t, request, document, fields } = detail;
  const usedBy = await countCasesFromTemplate(ws.id, t.id);
  const ready = !!document && fields.some((f) => f.kind === "signature");

  return (
    <>
      <AppHeader workspaceName={ws.name} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
        <div>
          <Link href="/templates" className="text-sm text-indigo-700 hover:underline">
            ← All templates
          </Link>
          <div className="mt-2 flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">Agreement template</p>
              <h1 className="text-2xl font-bold" data-testid="template-title">{t.title}</h1>
              <p className="text-sm text-slate-600" data-testid="template-usage">
                Used by {usedBy} case{usedBy === 1 ? "" : "s"}. Each case has its own copy; edits here only affect new cases.
              </p>
            </div>
            <div className="flex flex-wrap items-start gap-3">
              {ready && (
                <Link href={`/dashboard?template=${t.id}`} className="btn-primary" data-testid="use-template">
                  New case from this template
                </Link>
              )}
              {document && <UploadForm caseId={t.id} replacing />}
              <DeleteTemplateButton templateId={t.id} name={t.title} />
            </div>
          </div>
        </div>

        {!document && (
          <section className="card p-5">
            <h2 className="mb-1 font-semibold">Upload the agreement</h2>
            <p className="mb-4 text-sm text-slate-600">Upload the standard agreement PDF. Next you will place the signature field where clients sign.</p>
            <UploadForm caseId={t.id} />
          </section>
        )}

        {document && (
          <p className="text-xs text-slate-500" data-testid="document-meta">
            {document.filename} · {document.page_count} page{document.page_count === 1 ? "" : "s"} · {formatBytes(document.size_bytes)} · SHA-256{" "}
            <span className="font-mono">{document.sha256.slice(0, 16)}…</span>
          </p>
        )}

        {request && document && (
          <FieldEditor
            key={request.id}
            mode="template"
            requestId={request.id}
            documentUrl={`/api/documents/${document.id}`}
            initialFields={fields.map((f) => ({ key: f.id, kind: f.kind, pageIndex: f.page_index, x: f.x, y: f.y, width: f.width, height: f.height }))}
          />
        )}
      </main>
    </>
  );
}
