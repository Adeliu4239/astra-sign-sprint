"use client";

import { useEffect, useState } from "react";
import { SignedCopyButton, SignerApp } from "./SignerApp";
import { formatUtc } from "@/lib/format";

interface View {
  status: "invalid" | "pending" | "completed" | "revoked" | "expired" | "draft";
  caseTitle: string;
  clientName: string;
  workspaceName: string;
  filename: string;
  pageCount: number;
  completedAt: string | null;
  fields: { id: string; kind: "signature" | "name" | "date"; page_index: number; x: number; y: number; width: number; height: number }[];
}

type State = { kind: "loading" } | { kind: "error"; message: string } | { kind: "ready"; token: string; view: View };

function Notice({ title, body, children }: { title: string; body: string; children?: React.ReactNode }) {
  return (
    <div className="card mx-auto max-w-xl p-8 text-center" data-testid="signer-notice">
      <h1 className="text-xl font-semibold">{title}</h1>
      <p className="mt-2 text-sm text-slate-600">{body}</p>
      {children}
    </div>
  );
}

/** Reads the signing token from the URL fragment, which browsers never send to servers. */
export function SignerEntry() {
  const [state, setState] = useState<State>({ kind: "loading" });

  useEffect(() => {
    const load = async () => {
      const token = decodeURIComponent(window.location.hash.replace(/^#/, "")).trim();
      if (!token) {
        setState({ kind: "error", message: "This signing link is incomplete. Check that you copied the whole link." });
        return;
      }
      try {
        const res = await fetch("/api/sign/view", { method: "POST", headers: { "x-signing-token": token }, cache: "no-store" });
        if (!res.ok) throw new Error();
        setState({ kind: "ready", token, view: (await res.json()) as View });
      } catch {
        setState({ kind: "error", message: "We could not load this signing request. Check your connection and refresh the page." });
      }
    };
    void load();
    window.addEventListener("hashchange", load);
    return () => window.removeEventListener("hashchange", load);
  }, []);

  if (state.kind === "loading") {
    return <div className="py-24 text-center text-sm text-slate-500" aria-busy>Loading signing request…</div>;
  }
  if (state.kind === "error") return <Notice title="Unable to open this link" body={state.message} />;

  const { token, view } = state;
  if (view.status === "invalid") {
    return <Notice title="This signing link is not valid" body="Check that you copied the whole link, or ask the sender for a new one." />;
  }
  if (view.status === "completed") {
    return (
      <Notice title="This document has already been signed" body={`${view.filename} was signed on ${formatUtc(view.completedAt)}. It cannot be signed again.`}>
        <SignedCopyButton token={token} filename={view.filename} />
      </Notice>
    );
  }
  if (view.status === "revoked") return <Notice title="This signing request was cancelled" body="The sender revoked this link. Contact them if you still need to sign." />;
  if (view.status === "expired") return <Notice title="This signing link has expired" body="Ask the sender to send you a new link." />;
  if (view.status !== "pending") return <Notice title="This signing request is not active" body="Ask the sender for a new link." />;

  return (
    <>
      <div className="mb-6">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">Requested by {view.workspaceName}</p>
        <h1 className="mt-1 text-2xl font-bold">Review and sign: {view.filename}</h1>
        <p className="text-sm text-slate-600">
          Hi {view.clientName} — please review this document for “{view.caseTitle}”, then sign below.
        </p>
      </div>
      <SignerApp token={token} clientName={view.clientName} filename={view.filename} pageCount={view.pageCount} fields={view.fields} />
    </>
  );
}
