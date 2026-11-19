import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { NewCaseForm } from "@/components/NewCaseForm";
import { StatusBadge } from "@/components/StatusBadge";
import { currentWorkspace } from "@/lib/server/session";
import { listCases, listTemplates } from "@/lib/server/service";
import { formatUtc } from "@/lib/format";

export const dynamic = "force-dynamic";

export default async function Dashboard({ searchParams }: { searchParams: Promise<{ error?: string; template?: string }> }) {
  const { error, template } = await searchParams;
  const ws = await currentWorkspace();
  if (!ws) redirect("/");
  const [cases, templates] = await Promise.all([listCases(ws.id), listTemplates(ws.id)]);
  const usable = templates
    .filter((t) => t.filename && t.signature_fields > 0)
    .map((t) => ({ id: t.id, name: t.name, detail: `${t.page_count} page${t.page_count === 1 ? "" : "s"}, ${t.total_fields} field${t.total_fields === 1 ? "" : "s"}` }));
  const defaultTemplateId = typeof template === "string" && usable.some((t) => t.id === template) ? template : "";
  const counts = {
    total: cases.length,
    pending: cases.filter((c) => c.status === "pending").length,
    completed: cases.filter((c) => c.status === "completed").length,
  };
  return (
    <>
      <AppHeader workspaceName={ws.name} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Client cases</h1>
            <p className="text-sm text-slate-600">
              {counts.total} case{counts.total === 1 ? "" : "s"} · {counts.pending} awaiting signature · {counts.completed} completed
            </p>
          </div>
        </div>

        <section className="card p-5">
          <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">New case</h2>
            <Link href="/templates" className="text-xs text-indigo-700 hover:underline">
              {usable.length > 0 ? "Manage agreement templates" : "Same agreement for every client? Save it as a template →"}
            </Link>
          </div>
          <NewCaseForm
            initialError={typeof error === "string" ? error.slice(0, 300) : null}
            templates={usable}
            defaultTemplateId={defaultTemplateId}
          />
        </section>

        <section className="card overflow-hidden">
          {cases.length === 0 ? (
            <p className="p-8 text-center text-sm text-slate-500">No cases yet. Create one above to upload its agreement.</p>
          ) : (
            <table className="w-full text-sm" data-testid="cases-table">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Case</th>
                  <th className="hidden px-4 py-3 sm:table-cell">Client</th>
                  <th className="hidden px-4 py-3 md:table-cell">Document</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="hidden px-4 py-3 md:table-cell">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {cases.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <Link href={`/cases/${c.id}`} className="font-medium text-indigo-700 hover:underline">
                        {c.title}
                      </Link>
                      <div className="text-xs text-slate-500 sm:hidden">{c.client_name}</div>
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      {c.client_name}
                      <div className="text-xs text-slate-500">{c.client_email}</div>
                    </td>
                    <td className="hidden max-w-[220px] truncate px-4 py-3 text-slate-600 md:table-cell">{c.filename ?? "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge status={c.status} />
                    </td>
                    <td className="hidden px-4 py-3 text-slate-500 md:table-cell">{formatUtc(c.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </main>
    </>
  );
}
