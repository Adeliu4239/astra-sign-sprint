"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiError } from "@/lib/format";

/** Creates an empty template, then opens it to upload the PDF. Works before hydration via form POST. */
export function NewTemplateForm({ initialError = null }: { initialError?: string | null }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(initialError);

  const submit = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const name = String(new FormData(e.currentTarget).get("name") ?? "");
    setBusy(true);
    setError(null);
    try {
      const res = await fetch("/api/templates", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
      if (!res.ok) throw new Error(await apiError(res));
      const { id } = (await res.json()) as { id: string };
      router.push(`/templates/${id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not create the template");
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} method="post" action="/api/templates" className="flex flex-col gap-3 sm:flex-row sm:items-end" data-testid="new-template-form">
      <label className="flex-1 text-sm">
        <span className="mb-1 block font-medium">Template name</span>
        <input className="input" name="name" required maxLength={120} placeholder="Standard client agreement" />
      </label>
      <button type="submit" className="btn-primary" disabled={busy}>
        {busy ? "Creating…" : "Create template"}
      </button>
      {error && <p role="alert" className="text-sm text-red-600">{error}</p>}
    </form>
  );
}
