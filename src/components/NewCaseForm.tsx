"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiError } from "@/lib/format";

export function NewCaseForm({ compact = false, initialError = null }: { compact?: boolean; initialError?: string | null }) {
  const router = useRouter();
  const [title, setTitle] = useState("");
  const [clientName, setClientName] = useState("");
  const [clientEmail, setClientEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, clientName, clientEmail }),
      });
      if (!res.ok) throw new Error(await apiError(res));
      const { id } = (await res.json()) as { id: string };
      router.push(`/cases/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the case");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} method="post" action="/api/cases" className={`grid gap-3 ${compact ? "" : "sm:grid-cols-3"}`} data-testid="new-case-form">
      <label className="text-sm">
        <span className="mb-1 block font-medium">Case / file name</span>
        <input className="input" required maxLength={120} value={title} onChange={(e) => setTitle(e.target.value)} placeholder="MIND Test Case 001" name="title" />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Client name</span>
        <input className="input" required maxLength={120} value={clientName} onChange={(e) => setClientName(e.target.value)} placeholder="Taylor Example" name="clientName" />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Client email</span>
        <input className="input" required type="email" maxLength={200} value={clientEmail} onChange={(e) => setClientEmail(e.target.value)} placeholder="taylor@example.com" name="clientEmail" />
      </label>
      <div className={`flex items-center gap-3 ${compact ? "" : "sm:col-span-3"}`}>
        <button type="submit" className="btn-primary" disabled={busy}>
          {busy ? "Creating…" : "Create case"}
        </button>
        <span className="text-xs text-slate-500">Use synthetic test data only.</span>
      </div>
      {error && <p role="alert" className={`text-sm text-red-600 ${compact ? "" : "sm:col-span-3"}`}>{error}</p>}
    </form>
  );
}
