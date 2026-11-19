"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { apiError, formatBytes } from "@/lib/format";
import { MAX_UPLOAD_BYTES, SINGLE_UPLOAD_MAX_BYTES } from "@/lib/schemas";

async function uploadChunked(caseId: string, file: File, onProgress: (pct: number) => void) {
  const start = await fetch(`/api/cases/${caseId}/uploads`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ filename: file.name, mime: file.type || "application/pdf", size: file.size }),
  });
  if (!start.ok) throw new Error(await apiError(start));
  const { uploadId, chunkSize, chunkCount } = (await start.json()) as { uploadId: string; chunkSize: number; chunkCount: number };
  for (let i = 0; i < chunkCount; i++) {
    const part = file.slice(i * chunkSize, Math.min(file.size, (i + 1) * chunkSize));
    let res: Response | null = null;
    for (let attempt = 0; attempt < 3; attempt++) {
      try {
        res = await fetch(`/api/uploads/${uploadId}/chunks/${i}`, { method: "PUT", headers: { "Content-Type": "application/octet-stream" }, body: part });
        if (res.ok) break;
      } catch {
        res = null;
      }
    }
    if (!res?.ok) throw new Error(res ? await apiError(res) : "Network error while uploading. Please try again.");
    onProgress(Math.round(((i + 1) / chunkCount) * 90));
  }
  const done = await fetch(`/api/uploads/${uploadId}/complete`, { method: "POST" });
  if (!done.ok) throw new Error(await apiError(done));
}

export function UploadForm({ caseId, replacing = false, fieldCount = 0 }: { caseId: string; replacing?: boolean; fieldCount?: number }) {
  const router = useRouter();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [drag, setDrag] = useState(false);
  const [progress, setProgress] = useState<number | null>(null);
  // Replacing a PDF discards its placed fields: ask first.
  const [confirming, setConfirming] = useState<File | null>(null);

  const choose = (file: File | undefined) => {
    if (!file) return;
    if (replacing && fieldCount > 0) {
      setError(null);
      setConfirming(file);
      return;
    }
    void upload(file);
  };

  const cancelReplace = () => {
    setConfirming(null);
    if (input.current) input.current.value = "";
  };

  const upload = async (file: File | undefined) => {
    if (!file) return;
    setConfirming(null);
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
      if (file.size > SINGLE_UPLOAD_MAX_BYTES) {
        setProgress(0);
        await uploadChunked(caseId, file, setProgress);
      } else {
        const body = new FormData();
        body.append("file", file);
        const res = await fetch(`/api/cases/${caseId}/document`, { method: "POST", body });
        if (!res.ok) throw new Error(await apiError(res));
      }
      router.refresh();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setBusy(false);
      setProgress(null);
      if (input.current) input.current.value = "";
    }
  };

  // A file picked before hydration never fired onChange: pick it up once React is ready.
  useEffect(() => {
    const f = input.current?.files?.[0];
    if (f) choose(f);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (replacing) {
    return (
      <div className="flex flex-col items-end gap-1">
        <label className="btn-secondary cursor-pointer">
          {busy ? (progress !== null && progress < 90 ? `Uploading ${progress}%` : "Uploading…") : "Replace PDF"}
          <input ref={input} type="file" accept="application/pdf,.pdf" className="sr-only" disabled={busy} onChange={(e) => choose(e.target.files?.[0])} />
        </label>
        {confirming && (
          <div role="alertdialog" aria-labelledby="replace-confirm-title" data-testid="replace-confirm" className="mt-1 max-w-xs rounded-lg border border-amber-300 bg-amber-50 p-3 text-left text-xs text-amber-900 shadow">
            <p id="replace-confirm-title" className="font-semibold">Replace the PDF with “{confirming.name}”?</p>
            <p className="mt-1">
              The fields placed on the current document will be removed. You will place them again on the new PDF.
            </p>
            <div className="mt-2 flex gap-2">
              <button type="button" className="btn-primary px-3 py-1 text-xs" data-testid="replace-confirm-yes" onClick={() => void upload(confirming)}>
                Replace PDF
              </button>
              <button type="button" className="btn-secondary px-3 py-1 text-xs" data-testid="replace-confirm-no" onClick={cancelReplace}>
                Keep current PDF
              </button>
            </div>
          </div>
        )}
        {error && <p role="alert" data-testid="upload-error" className="max-w-xs text-right text-xs text-red-600">{error}</p>}
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
        <span className="text-base font-medium">{busy ? (progress !== null && progress < 90 ? `Uploading… ${progress}%` : "Uploading and checking PDF…") : "Drop the agreement PDF here, or click to choose"}</span>
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
