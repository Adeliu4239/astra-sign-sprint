import Link from "next/link";
import { redirect } from "next/navigation";
import { AppHeader } from "@/components/AppHeader";
import { NewCaseForm } from "@/components/NewCaseForm";
import { StatusBadge } from "@/components/StatusBadge";
import { currentWorkspace } from "@/lib/server/session";
import { listCases, listTemplates, signatureFieldCounts } from "@/lib/server/service";
import { formatUtc } from "@/lib/format";
import { CASE_STAGES, caseStage, nextStep, stageLabel } from "@/lib/signing/state";
import { filterCases, parseStage } from "@/lib/case-filter";

export const dynamic = "force-dynamic";

type Search = { error?: string; q?: string; status?: string; template?: string };

export default async function Dashboard({ searchParams }: { searchParams: Promise<Search> }) {
  const { error, q: rawQ, status: rawStatus, template } = await searchParams;
  const ws = await currentWorkspace();
  if (!ws) redirect("/");
  const [rows, sigCounts, templates] = await Promise.all([listCases(ws.id), signatureFieldCounts(ws.id), listTemplates(ws.id)]);
  const usable = templates
    .filter((t) => t.filename && t.signature_fields > 0)
    .map((t) => ({ id: t.id, name: t.name, detail: `${t.page_count} page${t.page_count === 1 ? "" : "s"}, ${t.total_fields} field${t.total_fields === 1 ? "" : "s"}` }));
  const defaultTemplateId = typeof template === "string" && usable.some((t) => t.id === template) ? template : "";
  const cases = rows.map((c) => {
    const sig = sigCounts.get(c.id) ?? 0;
    return { ...c, stage: caseStage(c.status, sig), next: nextStep(c.status, sig) };
  });
  const q = typeof rawQ === "string" ? rawQ.slice(0, 100) : "";
  const stage = parseStage(rawStatus);
  const filtered = filterCases(cases, { q, stage });
  const filtering = !!q.trim() || !!stage;
  const counts = Object.fromEntries(CASE_STAGES.map((s) => [s, cases.filter((c) => c.stage === s).length])) as Record<(typeof CASE_STAGES)[number], number>;
  const href = (next: { q?: string; status?: string }) => {
    const p = new URLSearchParams();
    if (next.q) p.set("q", next.q);
    if (next.status) p.set("status", next.status);
    const s = p.toString();
    return s ? `/dashboard?${s}` : "/dashboard";
  };
  return (
    <>
      <AppHeader workspaceName={ws.name} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-6 px-4 py-8">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Client cases</h1>
            <p className="text-sm text-slate-600">
              {cases.length} case{cases.length === 1 ? "" : "s"} · {counts.pending} pending signature · {counts.completed} completed
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

        {cases.length > 0 && (
          <section className="flex flex-col gap-3" aria-label="Find cases">
            <form method="get" action="/dashboard" className="flex flex-wrap items-center gap-2" role="search">
              <input
                type="search"
                name="q"
                defaultValue={q}
                placeholder="Search title, client, email or file"
                aria-label="Search cases"
                data-testid="case-search"
                className="input min-w-0 flex-1 sm:max-w-sm"
                maxLength={100}
              />
              {stage && <input type="hidden" name="status" value={stage} />}
              <button type="submit" className="btn-secondary">Search</button>
              {filtering && (
                <Link href="/dashboard" className="text-sm text-indigo-700 hover:underline" data-testid="clear-filters">
                  Clear
                </Link>
              )}
            </form>
            <nav className="flex flex-wrap gap-2 text-xs" aria-label="Filter by status" data-testid="status-filters">
              <Link
                href={href({ q })}
                className={`rounded-full px-3 py-1 ring-1 ${!stage ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"}`}
                aria-current={!stage ? "page" : undefined}
              >
                All {cases.length}
              </Link>
              {CASE_STAGES.map((s) => (
                <Link
                  key={s}
                  href={href({ q, status: s })}
                  data-testid={`filter-${s}`}
                  className={`rounded-full px-3 py-1 ring-1 ${stage === s ? "bg-indigo-600 text-white ring-indigo-600" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50"}`}
                  aria-current={stage === s ? "page" : undefined}
                >
                  {stageLabel[s]} {counts[s]}
                </Link>
              ))}
            </nav>
          </section>
        )}

        <section className="card overflow-hidden">
          {cases.length === 0 ? (
            <div className="p-8 text-center" data-testid="empty-cases">
              <p className="font-medium">No cases yet</p>
              <p className="mx-auto mt-1 max-w-md text-sm text-slate-500">
                Create a case above for each client: then upload their agreement PDF, place the signature field, and share the signing link.
              </p>
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-8 text-center" data-testid="empty-filter">
              <p className="font-medium">No cases match{q.trim() ? ` “${q.trim()}”` : ""}{stage ? ` in ${stageLabel[stage]}` : ""}</p>
              <Link href="/dashboard" className="mt-2 inline-block text-sm text-indigo-700 hover:underline">
                Show all cases
              </Link>
            </div>
          ) : (
            <table className="w-full text-sm" data-testid="cases-table">
              <thead className="bg-slate-50 text-left text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-4 py-3">Case</th>
                  <th className="hidden px-4 py-3 sm:table-cell">Client</th>
                  <th className="hidden px-4 py-3 md:table-cell">Document</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="hidden px-4 py-3 lg:table-cell">Next step</th>
                  <th className="hidden px-4 py-3 md:table-cell">Created</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {filtered.map((c) => (
                  <tr key={c.id} className="hover:bg-slate-50" data-testid="case-row">
                    <td className="px-4 py-3">
                      <Link href={`/cases/${c.id}`} className="font-medium text-indigo-700 hover:underline">
                        {c.title}
                      </Link>
                      <div className="text-xs text-slate-500 sm:hidden">{c.client_name}</div>
                      <div className="text-xs text-slate-500 lg:hidden">{c.next}</div>
                    </td>
                    <td className="hidden px-4 py-3 sm:table-cell">
                      {c.client_name}
                      <div className="text-xs text-slate-500">{c.client_email}</div>
                    </td>
                    <td className="hidden max-w-[220px] truncate px-4 py-3 text-slate-600 md:table-cell">{c.filename ?? "—"}</td>
                    <td className="px-4 py-3">
                      <StatusBadge stage={c.stage} />
                    </td>
                    <td className="hidden px-4 py-3 text-slate-600 lg:table-cell" data-testid="next-step">
                      <Link href={`/cases/${c.id}`} className="hover:underline">
                        {c.next} →
                      </Link>
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
