"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiError } from "@/lib/format";

export function DeleteTemplateButton({ templateId, name }: { templateId: string; name: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const remove = async () => {
    if (!window.confirm(`Delete the template "${name}"? Cases already created from it keep their own copy and are not affected.`)) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/templates/${templateId}`, { method: "DELETE" });
      if (!res.ok) throw new Error(await apiError(res));
      router.push("/templates");
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not delete the template");
      setBusy(false);
    }
  };
  return (
    <div className="flex flex-col items-end gap-1">
      <button type="button" className="btn-danger" onClick={remove} disabled={busy} data-testid="delete-template">
        {busy ? "Deleting…" : "Delete template"}
      </button>
      {error && <p role="alert" className="text-xs text-red-600">{error}</p>}
    </div>
  );
}
