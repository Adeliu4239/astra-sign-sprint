import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { NewTemplateForm } from "@/components/NewTemplateForm";
import { currentWorkspace } from "@/lib/server/session";
import { listTemplates } from "@/lib/server/service";
import { formatUtc } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function TemplatesPage({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const { error } = await searchParams;
  const ws = await currentWorkspace();
  if (!ws) redirect("/");
  const templates = await listTemplates(ws.id);
  return (
    <>
      <AppHeader workspaceName={ws.name} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
        <div>
          <h1 className="text-2xl font-bold">Agreement templates</h1>
          <p className="text-sm text-slate-600">
            Save the agreement every client signs once, with its signature fields placed. Each new case gets its own copy, so editing a template never
            changes cases already created.
          </p>
        </div>

        <section className="card p-5">
          <h2 className="mb-3 font-semibold">New template</h2>
          <NewTemplateForm initialError={typeof error === "string" ? error.slice(0, 300) : null} />
        </section>

        <section className="card overflow-hidden">
          {templates.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">No templates yet. Create one above, then upload the agreement PDF and place its fields.</p>
          ) : (
            <table className="w-full text-sm" data-testid="templates-table">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Template</th>
                  <th className="hidden px-4 py-3 md:table-cell">Document</th>
                  <th className="px-4 py-3">Fields</th>
                  <th className="hidden px-4 py-3 md:table-cell">Created</th>
                  <th className="px-4 py-3" />
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {templates.map((t) => {
                  const ready = !!t.filename && t.signature_fields > 0;
                  return (
                    <tr key={t.id} className="hover:bg-slate-50" data-testid="template-row">
                      <td className="px-4 py-3">
                        <Link href={`/templates/${t.id}`} className="font-medium text-indigo-700 hover:underline">
                          {t.name}
                        </Link>
                      </td>
                      <td className="hidden max-w-[220px] truncate px-4 py-3 text-slate-600 md:table-cell">
                        {t.filename ? `${t.filename} · ${t.page_count} pages` : "No PDF yet"}
                      </td>
                      <td className="px-4 py-3 text-slate-600">
                        {t.total_fields}
                        {!ready && <span className="ml-2 text-xs text-amber-700">{t.filename ? "needs a signature field" : "needs a PDF"}</span>}
                      </td>
                      <td className="hidden px-4 py-3 text-slate-500 md:table-cell">{formatUtc(t.created_at)}</td>
                      <td className="px-4 py-3 text-right">
                        {ready && (
                          <Link href={`/dashboard?template=${t.id}`} className="text-sm font-medium text-indigo-700 hover:underline">
                            New case →
                          </Link>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}
