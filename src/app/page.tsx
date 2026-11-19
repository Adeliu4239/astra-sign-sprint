import Link from "next/link";
import { AppHeader } from "@/components/AppHeader";
import { currentWorkspace } from "@/lib/server/session";

export const dynamic = "force-dynamic";

const steps = [
  ["Create a client file", "One case per client, with their name and email."],
  ["Upload the agreement", "Any PDF, any number of pages. Nothing is hard-coded."],
  ["Place the signature", "Click where the client signs, on any page. Add name and date if you like."],
  ["Share the link", "Copy a private, expiring signing link and send it however you want."],
  ["Client signs", "They review every page, consent to e-signing and draw or type a signature."],
  ["Download the signed PDF", "Signature stamped exactly where you placed it, plus an audit certificate."],
];

export default async function Home({ searchParams }: { searchParams: Promise<{ error?: string }> }) {
  const ws = await currentWorkspace();
  const { error } = await searchParams;
  return (
    <>
      <AppHeader workspaceName={ws?.name} />
      <main className="mx-auto flex w-full max-w-6xl flex-1 flex-col gap-12 px-4 py-12">
        <section className="grid items-center gap-10 lg:grid-cols-2">
          <div>
            <p className="text-sm font-semibold uppercase tracking-wide text-indigo-700">Agreement signing for client files</p>
            <h1 className="mt-3 text-4xl font-bold tracking-tight sm:text-5xl">Get every client agreement signed before work starts.</h1>
            <p className="mt-4 text-lg text-slate-600">
              FileSign turns any PDF agreement into a signing request in about a minute, then files the signed copy with the client&apos;s case.
            </p>
            <div className="mt-8 flex flex-wrap items-center gap-3">
              {ws ? (
                <Link href="/dashboard" className="btn-primary px-6 py-3 text-base" data-testid="enter-demo">
                  Continue to your workspace
                </Link>
              ) : (
                <form action="/api/workspace" method="post">
                  <button type="submit" className="btn-primary px-6 py-3 text-base" data-testid="enter-demo">
                    Open demo workspace
                  </button>
                </form>
              )}
              <span className="text-sm text-slate-500">No sign-up. Your demo workspace is private to this browser.</span>
            </div>
            {error === "rate_limited" && !ws && (
              <p role="alert" data-testid="home-error" className="mt-4 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                Too many demo workspaces were opened from this network in the last hour. Please try again later, or continue in a browser that already has a workspace.
              </p>
            )}
          </div>
          <ol className="card grid gap-4 p-6 sm:grid-cols-2">
            {steps.map(([title, body], i) => (
              <li key={title} className="flex gap-3">
                <span className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-indigo-100 text-sm font-semibold text-indigo-700">{i + 1}</span>
                <div>
                  <p className="font-medium">{title}</p>
                  <p className="text-sm text-slate-600">{body}</p>
                </div>
              </li>
            ))}
          </ol>
        </section>
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <strong>Prototype notice:</strong> use synthetic people and documents only. FileSign records consent, the signature image and a server-side event log, but it does not verify signer
          identity and makes no claim of legal or regulatory compliance.
        </section>
      </main>
    </>
  );
}
