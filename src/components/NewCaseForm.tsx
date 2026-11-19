"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiError } from "@/lib/format";

export interface TemplateOption {
  id: string;
  name: string;
  detail: string;
}

export function NewCaseForm({
  compact = false,
  initialError = null,
  templates = [],
  defaultTemplateId = "",
}: {
  compact?: boolean;
  initialError?: string | null;
  templates?: TemplateOption[];
  defaultTemplateId?: string;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    // Read from the DOM (uncontrolled inputs) so values typed before hydration are kept.
    const data = new FormData(e.currentTarget);
    const title = String(data.get("title") ?? "");
    const clientName = String(data.get("clientName") ?? "");
    const clientEmail = String(data.get("clientEmail") ?? "");
    const templateId = String(data.get("templateId") ?? "");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/cases", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title, clientName, clientEmail, templateId }),
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
        <input className="input" required maxLength={120} placeholder="MIND Test Case 001" name="title" />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Client name</span>
        <input className="input" required maxLength={120} placeholder="Taylor Example" name="clientName" />
      </label>
      <label className="text-sm">
        <span className="mb-1 block font-medium">Client email</span>
        <input className="input" required type="email" maxLength={200} placeholder="taylor@example.com" name="clientEmail" />
      </label>
      {templates.length > 0 && (
        <label className={`text-sm ${compact ? "" : "sm:col-span-3"}`}>
          <span className="mb-1 block font-medium">Agreement</span>
          <select className="input" name="templateId" defaultValue={defaultTemplateId} data-testid="template-select">
            <option value="">Upload a PDF after creating the case</option>
            {templates.map((t) => (
              <option key={t.id} value={t.id}>
                Saved template: {t.name} ({t.detail})
              </option>
            ))}
          </select>
        </label>
      )}
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
