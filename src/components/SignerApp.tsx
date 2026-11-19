"use client";

import { useCallback, useRef, useState } from "react";
import { PdfPages } from "./PdfPages";
import { SignaturePad, type SignatureValue } from "./SignaturePad";
import { apiError, formatUtc } from "@/lib/format";
import { CONSENT_TEXT } from "@/lib/schemas";

interface Field {
  id: string;
  kind: "signature" | "name" | "date";
  page_index: number;
  x: number;
  y: number;
  width: number;
  height: number;
}

interface Props {
  token: string;
  clientName: string;
  filename: string;
  pageCount: number;
  fields: Field[];
}

type Phase = { kind: "form" } | { kind: "submitting" } | { kind: "done"; completedAt: string };

async function checkOutcome(token: string): Promise<{ kind: "completed"; completedAt: string } | { kind: "pending" } | { kind: "unknown" }> {
  try {
    const res = await fetch("/api/sign/view", { method: "POST", headers: { "x-signing-token": token, "x-fs-recheck": "1" } });
    if (!res.ok) return { kind: "unknown" };
    const v = (await res.json()) as { status: string; completedAt: string | null };
    if (v.status === "completed" && v.completedAt) return { kind: "completed", completedAt: v.completedAt };
    if (v.status === "pending") return { kind: "pending" };
    return { kind: "unknown" };
  } catch {
    return { kind: "unknown" };
  }
}

/** Downloads the signed PDF with the token in a header (never in a URL). */
export function SignedCopyButton({ token, filename }: { token: string; filename: string }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const download = async () => {
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/sign/document?which=signed&download=1", { headers: { "x-signing-token": token } });
      if (!res.ok) throw new Error(await apiError(res));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = filename.replace(/\.pdf$/i, "") + " (signed).pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10_000);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Download failed");
    } finally {
      setBusy(false);
    }
  };
  return (
    <div className="mt-6 flex flex-col items-center gap-2">
      <button type="button" className="btn-primary" onClick={download} disabled={busy} data-testid="signer-download">
        {busy ? "Preparing download…" : "Download signed copy"}
      </button>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </div>
  );
}

export function SignerApp({ token, clientName, filename, pageCount, fields }: Props) {
  const [name, setName] = useState(clientName);
  const [signature, setSignature] = useState<SignatureValue | null>(null);
  const [consent, setConsent] = useState(false);
  const [phase, setPhase] = useState<Phase>({ kind: "form" });
  const [error, setError] = useState<string | null>(null);
  const inFlight = useRef(false);
  const onSig = useCallback((v: SignatureValue | null) => setSignature(v), []);

  const today = new Date().toISOString().slice(0, 10);
  const sigPages = [...new Set(fields.filter((f) => f.kind === "signature").map((f) => f.page_index + 1))];
  const ready = consent && !!signature && name.trim().length > 0;

  const submit = async () => {
    if (!ready || inFlight.current) return;
    inFlight.current = true;
    setError(null);
    setPhase({ kind: "submitting" });
    try {
      const res = await fetch(`/api/sign/submit`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-signing-token": token },
        body: JSON.stringify({ consent: true, signerName: name.trim(), method: signature!.method, signaturePng: signature!.dataUrl }),
      });
      if (!res.ok) {
        const msg = await apiError(res);
        if (res.status === 409) {
          // Closed link (already signed / revoked / expired): reload to show the authoritative state.
          setError(msg);
          setTimeout(() => window.location.reload(), 1800);
          return;
        }
        throw new Error(msg);
      }
      const body = (await res.json()) as { completedAt: string };
      setPhase({ kind: "done", completedAt: body.completedAt });
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch (e) {
      if (e instanceof TypeError) {
        // Network failure: the request may or may not have reached the server. Ask the server
        // for the authoritative state instead of guessing (a completed link can't be signed twice).
        const outcome = await checkOutcome(token);
        if (outcome.kind === "completed") {
          setPhase({ kind: "done", completedAt: outcome.completedAt });
          window.scrollTo({ top: 0, behavior: "smooth" });
          return;
        }
        setError(
          outcome.kind === "pending"
            ? "The connection dropped before your signature reached us, so nothing was signed. Check your connection and press “Agree & sign” again."
            : "We couldn't confirm whether your signature was recorded. Reload this page to check before signing again.",
        );
      } else {
        setError(e instanceof Error ? e.message : "Signing failed. Please try again.");
      }
      setPhase({ kind: "form" });
      inFlight.current = false;
    }
  };

  if (phase.kind === "done") {
    return (
      <div className="card mx-auto max-w-xl p-8 text-center" data-testid="signing-complete">
        <div className="mx-auto grid h-14 w-14 place-items-center rounded-full bg-emerald-100 text-2xl text-emerald-700">✓</div>
        <h2 className="mt-4 text-xl font-semibold">Document signed</h2>
        <p className="mt-2 text-sm text-slate-600">
          Thank you, {name.trim()}. Your signature was applied to <strong>{filename}</strong> at {formatUtc(phase.completedAt)}. The sender can now see
          the signed copy in their dashboard.
        </p>
        <SignedCopyButton token={token} filename={filename} />
      </div>
    );
  }

  const submitting = phase.kind === "submitting";

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_360px]">
      <div className="min-w-0">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm text-slate-600">
            Review all {pageCount} page{pageCount === 1 ? "" : "s"}. You will sign on page{sigPages.length === 1 ? "" : "s"} {sigPages.join(", ")}.
          </p>
          {/* A scroll button, not an #anchor: the URL fragment holds the signing token. */}
          <button
            type="button"
            className="btn-secondary text-xs lg:hidden"
            onClick={() => document.getElementById("sign-form")?.scrollIntoView({ behavior: "smooth", block: "start" })}
          >
            Go to signature form ↓
          </button>
        </div>
        <PdfPages
          url="/api/sign/document"
          httpHeaders={{ "x-signing-token": token }}
          renderOverlay={(page) =>
            fields
              .filter((f) => f.page_index === page.index)
              .map((f) => (
                <div
                  key={f.id}
                  data-testid="signer-field"
                  data-kind={f.kind}
                  className={`absolute flex items-center justify-center overflow-hidden rounded ${
                    f.kind === "signature"
                      ? signature
                        ? "bg-emerald-400/10 ring-1 ring-emerald-500"
                        : "animate-pulse bg-amber-300/40 ring-2 ring-amber-500"
                      : "bg-sky-300/20 ring-1 ring-sky-500"
                  }`}
                  style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%` }}
                >
                  {f.kind === "signature" ? (
                    signature ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={signature.dataUrl} alt="Your signature" className="h-full w-full object-contain" />
                    ) : (
                      <span className="text-[10px] font-bold text-amber-900 sm:text-xs">Sign here</span>
                    )
                  ) : (
                    <span className="truncate px-1 text-[10px] font-medium text-sky-950 sm:text-xs">{f.kind === "name" ? name.trim() || "Your name" : today}</span>
                  )}
                </div>
              ))
          }
        />
      </div>

      <aside className="lg:sticky lg:top-4 lg:self-start">
        <form
          id="sign-form"
          className="card flex flex-col gap-4 p-4"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <h2 className="font-semibold">Sign this document</h2>
          <label className="text-sm">
            <span className="mb-1 block font-medium">Full legal name</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={120} required data-testid="signer-name" />
          </label>
          <div className="text-sm">
            <span className="mb-1 block font-medium">Your signature</span>
            <SignaturePad defaultName={clientName} onChange={onSig} />
          </div>
          <label className="flex items-start gap-2 rounded-lg bg-slate-50 p-3 text-xs leading-relaxed text-slate-700">
            <input type="checkbox" className="mt-0.5 h-4 w-4 shrink-0" checked={consent} onChange={(e) => setConsent(e.target.checked)} data-testid="consent" />
            <span>{CONSENT_TEXT}</span>
          </label>
          <button type="submit" className="btn-primary w-full" disabled={!ready || submitting} data-testid="submit-signature">
            {submitting ? "Signing…" : "Agree & sign"}
          </button>
          {!ready && !submitting && (
            <p className="text-xs text-slate-500">
              {!name.trim() ? "Enter your name. " : ""}
              {!signature ? "Add your signature. " : ""}
              {!consent ? "Tick the consent box." : ""}
            </p>
          )}
          {error && <p role="alert" className="rounded-lg border border-red-200 bg-red-50 p-2 text-sm text-red-700">{error}</p>}
        </form>
      </aside>
    </div>
  );
}
