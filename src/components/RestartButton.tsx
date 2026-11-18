"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { apiError } from "@/lib/format";

export function RestartButton({ requestId }: { requestId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  return (
    <div>
      <button
        type="button"
        className="btn-primary"
        disabled={busy}
        onClick={async () => {
          setBusy(true);
          setError(null);
          try {
            const res = await fetch(`/api/requests/${requestId}/restart`, { method: "POST" });
            if (!res.ok) throw new Error(await apiError(res));
            router.refresh();
          } catch (e) {
            setError(e instanceof Error ? e.message : "Could not restart");
            setBusy(false);
          }
        }}
      >
        {busy ? "Preparing…" : "Start a new signing request"}
      </button>
      {error && <p role="alert" className="mt-2 text-sm text-red-600">{error}</p>}
    </div>
  );
}
