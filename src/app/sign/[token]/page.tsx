import type { Metadata } from "next";
import { headers } from "next/headers";
import { SignerApp } from "@/components/SignerApp";
import { getSignerView, logSignerOpened } from "@/lib/server/service";
import { formatUtc } from "@/lib/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "Review and sign — FileSign", referrer: "no-referrer", robots: { index: false } };

function Shell({ children, subtitle }: { children: React.ReactNode; subtitle?: string }) {
  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-sm font-semibold text-white">FS</span>
          <div>
            <p className="font-semibold leading-tight">FileSign</p>
            {subtitle && <p className="text-xs text-slate-500">{subtitle}</p>}
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
    </>
  );
}

function Notice({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="card mx-auto max-w-xl p-8 text-center" data-testid="signer-notice">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">{body}</p>
      {children}
    </div>
  );
}

export default async function SignPage({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const view = await getSignerView(token);
  if (!view) {
    return (
      <Shell>
        <Notice title="This signing link is not valid" body="Check that you copied the whole link, or ask the sender for a new one." />
      </Shell>
    );
  }
  const subtitle = `Requested by ${view.workspaceName}`;
  if (view.status === "completed") {
    return (
      <Shell subtitle={subtitle}>
        <Notice title="This document has already been signed" body={`${view.filename} was signed on ${formatUtc(view.completedAt)}. It cannot be signed again.`}>
          <a className="btn-primary mt-6" href={`/api/sign/${token}/document?which=signed&download=1`}>
            Download signed copy
          </a>
        </Notice>
      </Shell>
    );
  }
  if (view.status === "revoked") {
    return (
      <Shell subtitle={subtitle}>
        <Notice title="This signing request was cancelled" body="The sender revoked this link. Contact them if you still need to sign." />
      </Shell>
    );
  }
  if (view.status === "expired") {
    return (
      <Shell subtitle={subtitle}>
        <Notice title="This signing link has expired" body="Ask the sender to send you a new link." />
      </Shell>
    );
  }
  if (view.status !== "pending") {
    return (
      <Shell subtitle={subtitle}>
        <Notice title="This signing request is not active" body="Ask the sender for a new link." />
      </Shell>
    );
  }
  const h = await headers();
  await logSignerOpened(view, {
    ip: h.get("x-forwarded-for")?.split(",")[0]?.trim() ?? h.get("x-real-ip"),
    userAgent: h.get("user-agent"),
  }).catch(() => {});
  return (
    <Shell subtitle={subtitle}>
      <div className="mb-6">
        <h1 className="text-2xl font-bold">Review and sign: {view.filename}</h1>
        <p className="text-sm text-slate-600">
          Hi {view.clientName} — {view.workspaceName} asked you to sign this document for “{view.caseTitle}”.
        </p>
      </div>
      <SignerApp token={token} clientName={view.clientName} filename={view.filename} pageCount={view.pageCount} fields={view.fields} />
    </Shell>
  );
}
