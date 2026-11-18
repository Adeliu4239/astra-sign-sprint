"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiError } from "@/lib/format";

interface Props {
  requestId: string;
  url: string | null;
  clientName: string;
  clientEmail: string;
  caseTitle: string;
  expiresAt: string;
}

export function LinkPanel({ requestId, url, clientName, clientEmail, caseTitle, expiresAt }: Props) {
  const router = useRouter();
  const [copied, setCopied] = useState<"ok" | "fail" | null>(null);
  const [revoking, setRevoking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const copy = async () => {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied("ok");
    } catch {
      setCopied("fail");
    }
    setTimeout(() => setCopied(null), 2500);
  };

  const revoke = async () => {
    if (!confirm("Revoke this signing link? The signer will no longer be able to sign.")) return;
    setRevoking(true);
    setError(null);
    try {
      const res = await fetch(`/api/requests/${requestId}/revoke`, { method: "POST" });
      if (!res.ok) throw new Error(await apiError(res));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not revoke");
      setRevoking(false);
    }
  };

  const mailto = url
    ? `mailto:${encodeURIComponent(clientEmail)}?subject=${encodeURIComponent(`Please sign: ${caseTitle}`)}&body=${encodeURIComponent(
        `Hi ${clientName},\n\nPlease review and sign the agreement for "${caseTitle}" here:\n${url}\n\nThe link expires on ${expiresAt}.\n`,
      )}`
    : undefined;

  return (
    <div className="card border-amber-200 p-4" data-testid="link-panel">
      <h3 className="font-semibold">Signing link for {clientName}</h3>
      <p className="mt-1 text-sm text-slate-600">
        Share this private link with the signer. Anyone with the link can sign, so send it only to {clientEmail}. Expires {expiresAt}.
      </p>
      {url ? (
        <div className="mt-3 flex flex-col gap-2 sm:flex-row">
          <input readOnly value={url} className="input font-mono text-xs" data-testid="signer-url" onFocus={(e) => e.currentTarget.select()} aria-label="Signer link" />
          <button type="button" onClick={copy} className="btn-primary shrink-0" data-testid="copy-link">
            {copied === "ok" ? "Copied ✓" : copied === "fail" ? "Select & copy manually" : "Copy link"}
          </button>
        </div>
      ) : (
        <p className="mt-3 text-sm text-red-600">The link cannot be displayed. Revoke it and create a new one.</p>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {url && (
          <a className="btn-secondary" href={url} target="_blank" rel="noreferrer noopener">
            Open signer view
          </a>
        )}
        {mailto && (
          <a className="btn-secondary" href={mailto}>
            Email via my mail app
          </a>
        )}
        <button type="button" onClick={revoke} disabled={revoking} className="btn-danger">
          {revoking ? "Revoking…" : "Revoke link"}
        </button>
      </div>
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
