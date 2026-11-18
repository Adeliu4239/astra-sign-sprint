"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiError, formatBytes } from "@/lib/format";
import { MAX_UPLOAD_BYTES } from "@/lib/schemas";

export function UploadForm({ caseId, replacing = false }: { caseId: string; replacing?: boolean }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setError(null);
    if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") {
      setError("Only PDF files are supported.");
      return;
    }
    if (file.size > MAX_UPLOAD_BYTES) {
      setError(`This file is ${formatBytes(file.size)}. The limit is ${formatBytes(MAX_UPLOAD_BYTES)}.`);
      return;
    }
    setBusy(true);
    try {
      const body = new FormData();
      body.append("file", file);
      const res = await fetch(`/api/cases/${caseId}/document`, { method: "POST", body });
      if (!res.ok) throw new Error(await apiError(res));
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      if (input.current) input.current.value = "";
    }
  };

  if (replacing) {
    return (
      <div className="flex flex-col items-end gap-1">
        <label className="btn-secondary cursor-pointer">
          {busy ? "Uploading…" : "Replace PDF"}
          <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" disabled={busy} onChange={(e) => upload(e.target.files?.[0])} />
        </label>
        {error && <p role="alert" className="max-w-xs text-right text-xs text-red-600">{error}</p>}
      </div>
    );
  }

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDrag(true);
        }}
        onDragLeave={() => setDrag(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDrag(false);
          void upload(e.dataTransfer.files?.[0]);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-xl border-2 border-dashed px-6 py-12 text-center transition ${
          drag ? "border-indigo-500 bg-indigo-50" : "border-slate-300 bg-white hover:border-indigo-400"
        }`}
      >
        <span className="text-base font-medium">{busy ? "Uploading and checking PDF…" : "Drop the agreement PDF here, or click to choose"}</span>
        <span className="text-xs text-slate-500">PDF only · up to {formatBytes(MAX_UPLOAD_BYTES)} · any number of pages</span>
        <input
          ref={input}
          data-testid="pdf-input"
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          disabled={busy}
          onChange={(e) => upload(e.target.files?.[0])}
        />
      </label>
      {error && <p role="alert" data-testid="upload-error" className="mt-3 rounded-lg border border-red-200 bg-red-50 p-3 text-sm text-red-700">{error}</p>}
    </div>
  );
}
