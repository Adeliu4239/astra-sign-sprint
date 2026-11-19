"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { PdfPages, type PageInfo } from "./PdfPages";
import { clampNormRect, clientToNorm, type NormRect } from "@/lib/pdf/coordinates";
import { apiError } from "@/lib/format";

export type FieldKind = "signature" | "name" | "date";
export interface EditorField extends NormRect {
  key: string;
  kind: FieldKind;
  pageIndex: number;
}

const DEFAULT_SIZE_PT: Record<FieldKind, { w: number; h: number }> = {
  signature: { w: 180, h: 50 },
  name: { w: 170, h: 22 },
  date: { w: 110, h: 22 },
};

export const KIND_LABEL: Record<FieldKind, string> = {
  signature: "Signature",
  name: "Full name",
  date: "Date signed",
};

const KIND_STYLE: Record<FieldKind, string> = {
  signature: "border-indigo-600 bg-indigo-500/15 text-indigo-900",
  name: "border-teal-600 bg-teal-500/15 text-teal-900",
  date: "border-orange-600 bg-orange-500/15 text-orange-900",
};

type SaveState = "idle" | "dirty" | "saving" | "saved" | "error";

let keySeq = 0;
const newKey = () => `f${Date.now().toString(36)}${(keySeq++).toString(36)}`;

interface Props {
  requestId: string;
  documentUrl: string;
  initialFields: EditorField[];
}

export function FieldEditor({ requestId, documentUrl, initialFields }: Props) {
  const router = useRouter();
  const [fields, setFields] = useState<EditorField[]>(initialFields);
  const [tool, setTool] = useState<FieldKind | null>(initialFields.length === 0 ? "signature" : null);
  const [selected, setSelected] = useState<string | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const dirty = useRef(false);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const fieldsRef = useRef(fields);
  useEffect(() => {
    fieldsRef.current = fields;
  }, [fields]);

  const inFlight = useRef<Promise<boolean> | null>(null);
  const hadSignature = useRef(initialFields.some((f) => f.kind === "signature"));

  // Saves are serialised: each PUT sends the latest layout, and an older request can never land
  // after a newer one and overwrite it.
  const save = useCallback((): Promise<boolean> => {
    clearTimeout(saveTimer.current);
    const run = async (): Promise<boolean> => {
      dirty.current = false;
      setSaveState("saving");
      try {
        const res = await fetch(`/api/requests/${requestId}/fields`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            fields: fieldsRef.current.map(({ kind, pageIndex, x, y, width, height }) => ({ kind, pageIndex, x, y, width, height })),
          }),
        });
        if (!res.ok) throw new Error(await apiError(res));
        setSaveState(dirty.current ? "dirty" : "saved");
        setSaveError(null);
        const hasSignature = fieldsRef.current.some((f) => f.kind === "signature");
        if (hasSignature !== hadSignature.current) {
          hadSignature.current = hasSignature;
          router.refresh(); // Draft <-> Ready badge
        }
        return true;
      } catch (e) {
        dirty.current = true;
        setSaveState("error");
        const msg = e instanceof TypeError ? "Connection problem — your latest field changes are not saved yet." : e instanceof Error ? e.message : "Could not save fields";
        setSaveError(msg);
        return false;
      }
    };
    const p = (inFlight.current ?? Promise.resolve(true)).then(run);
    inFlight.current = p;
    void p.finally(() => {
      if (inFlight.current === p) inFlight.current = null;
    });
    return p;
  }, [requestId, router]);

  const update = useCallback(
    (fn: (prev: EditorField[]) => EditorField[]) => {
      setFields((prev) => fn(prev));
      dirty.current = true;
      setSaveState("dirty");
      clearTimeout(saveTimer.current);
      saveTimer.current = setTimeout(() => void save(), 700);
    },
    [save],
  );

  useEffect(() => () => clearTimeout(saveTimer.current), []);

  // Warn before leaving with unsaved or still-saving changes (reload, close, external links).
  useEffect(() => {
    const h = (e: BeforeUnloadEvent) => {
      if (dirty.current || inFlight.current) e.preventDefault();
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, []);

  // In-app links (header, "All cases") don't fire beforeunload: finish saving first, and only
  // leave without saving if the admin explicitly agrees.
  useEffect(() => {
    const h = (e: MouseEvent) => {
      if (!(dirty.current || inFlight.current) || e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
      if (!a || a.target === "_blank" || a.hasAttribute("download") || a.origin !== window.location.origin) return;
      e.preventDefault();
      e.stopPropagation();
      const href = a.pathname + a.search + a.hash;
      void save().then((ok) => {
        if (ok || window.confirm("Your latest field changes could not be saved. Leave this page anyway?")) router.push(href);
      });
    };
    document.addEventListener("click", h, true);
    return () => document.removeEventListener("click", h, true);
  }, [save, router]);

  // Keyboard: Delete removes, arrows nudge the selected field.
  useEffect(() => {
    const h = (e: KeyboardEvent) => {
      if (!selected) return;
      const target = e.target as HTMLElement | null;
      if (target && ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName)) return;
      if (e.key === "Delete" || e.key === "Backspace") {
        e.preventDefault();
        update((prev) => prev.filter((f) => f.key !== selected));
        setSelected(null);
        return;
      }
      const step = e.shiftKey ? 0.02 : 0.003;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d) return;
      e.preventDefault();
      update((prev) => prev.map((f) => (f.key === selected ? { ...f, ...clampNormRect({ ...f, x: f.x + d[0]!, y: f.y + d[1]! }) } : f)));
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [selected, update]);

  const placeField = (page: PageInfo, e: React.PointerEvent<HTMLDivElement>) => {
    if (!tool) {
      setSelected(null);
      return;
    }
    if (e.target !== e.currentTarget) return; // clicks on an existing field are handled by the field
    const rect = e.currentTarget.getBoundingClientRect();
    const p = clientToNorm(e.clientX, e.clientY, rect);
    const size = DEFAULT_SIZE_PT[tool];
    const w = size.w / page.width;
    const h = size.h / page.height;
    const field: EditorField = {
      key: newKey(),
      kind: tool,
      pageIndex: page.index,
      ...clampNormRect({ x: p.x - w / 2, y: p.y - h / 2, width: w, height: h }),
    };
    update((prev) => [...prev, field]);
    setSelected(field.key);
    setTool(null);
  };

  const startDrag = (field: EditorField, mode: "move" | "resize", e: React.PointerEvent<HTMLElement>) => {
    e.stopPropagation();
    e.preventDefault();
    setSelected(field.key);
    const overlay = (e.currentTarget as HTMLElement).closest("[data-page-overlay]") as HTMLElement | null;
    if (!overlay) return;
    const rect = overlay.getBoundingClientRect();
    const start = clientToNorm(e.clientX, e.clientY, rect);
    const origin = { ...field };
    const move = (ev: PointerEvent) => {
      const p = clientToNorm(ev.clientX, ev.clientY, rect);
      const dx = p.x - start.x;
      const dy = p.y - start.y;
      const next =
        mode === "move"
          ? clampNormRect({ ...origin, x: origin.x + dx, y: origin.y + dy })
          : clampNormRect({
              ...origin,
              width: Math.min(origin.width + dx, 1 - origin.x),
              height: Math.min(origin.height + dy, 1 - origin.y),
            });
      setFields((prev) => prev.map((f) => (f.key === field.key ? { ...f, ...next } : f)));
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      window.removeEventListener("pointercancel", up);
      update((prev) => prev); // schedule save of the final position
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
    window.addEventListener("pointercancel", up);
  };

  const remove = (key: string) => {
    update((prev) => prev.filter((f) => f.key !== key));
    if (selected === key) setSelected(null);
  };

  const hasSignature = fields.some((f) => f.kind === "signature");

  const createLink = async () => {
    setSendError(null);
    if (!hasSignature) {
      setSendError("Place at least one signature field first.");
      return;
    }
    setSending(true);
    try {
      if (dirty.current || saveState !== "saved") {
        const ok = await save();
        if (!ok) throw new Error("Fields could not be saved. Check your connection and try again.");
      }
      const res = await fetch(`/api/requests/${requestId}/send`, { method: "POST" });
      if (!res.ok) throw new Error(await apiError(res));
      router.refresh();
    } catch (e) {
      setSendError(e instanceof Error ? e.message : "Could not create the signing link");
      setSending(false);
    }
  };

  const scrollToPage = (index: number) => {
    document.querySelector(`[data-testid="pdf-page-${index + 1}"]`)?.scrollIntoView({ behavior: "smooth", block: "start" });
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[minmax(0,1fr)_320px]">
      <div className="min-w-0">
        {tool && (
          <div className="sticky top-2 z-20 mb-3 rounded-lg bg-indigo-600 px-4 py-2 text-sm text-white shadow" role="status">
            Click on any page where the <strong>{KIND_LABEL[tool].toLowerCase()}</strong> should go.{" "}
            <button className="underline" onClick={() => setTool(null)}>
              Cancel
            </button>
          </div>
        )}
        <PdfPages
          url={documentUrl}
          onLoad={setPages}
          overlayClassName={tool ? "cursor-crosshair" : ""}
          onPagePointerDown={placeField}
          renderOverlay={(page) =>
            fields
              .filter((f) => f.pageIndex === page.index)
              .map((f) => (
                <div
                  key={f.key}
                  data-testid="placed-field"
                  data-kind={f.kind}
                  data-page={f.pageIndex + 1}
                  role="button"
                  tabIndex={0}
                  aria-label={`${KIND_LABEL[f.kind]} field on page ${f.pageIndex + 1}`}
                  onFocus={() => setSelected(f.key)}
                  onPointerDown={(e) => startDrag(f, "move", e)}
                  className={`absolute flex touch-none select-none items-center justify-center rounded border-2 border-dashed text-[11px] font-semibold sm:text-xs ${KIND_STYLE[f.kind]} ${
                    selected === f.key ? "ring-2 ring-offset-1 ring-indigo-400" : ""
                  } cursor-move`}
                  style={{ left: `${f.x * 100}%`, top: `${f.y * 100}%`, width: `${f.width * 100}%`, height: `${f.height * 100}%` }}
                >
                  <span className="pointer-events-none truncate px-1">{KIND_LABEL[f.kind]}</span>
                  <button
                    type="button"
                    aria-label="Remove field"
                    onPointerDown={(e) => e.stopPropagation()}
                    onClick={(e) => {
                      e.stopPropagation();
                      remove(f.key);
                    }}
                    className="absolute -right-2.5 -top-2.5 grid h-5 w-5 place-items-center rounded-full bg-slate-800 text-[10px] leading-none text-white shadow hover:bg-red-600"
                  >
                    ✕
                  </button>
                  <span
                    aria-hidden
                    onPointerDown={(e) => startDrag(f, "resize", e)}
                    className="absolute -bottom-1.5 -right-1.5 h-3.5 w-3.5 cursor-nwse-resize rounded-sm border-2 border-white bg-slate-800 shadow"
                  />
                </div>
              ))
          }
        />
      </div>

      <aside className="lg:sticky lg:top-4 lg:self-start">
        <div className="card flex flex-col gap-4 p-4">
          <div>
            <h3 className="text-sm font-semibold">1. Place fields</h3>
            <p className="mt-1 text-xs text-slate-500">Choose a field, then click on the page. Drag to move, use the corner handle to resize.</p>
          </div>
          <div className="grid grid-cols-1 gap-2">
            {(Object.keys(KIND_LABEL) as FieldKind[]).map((k) => (
              <button
                key={k}
                type="button"
                data-testid={`tool-${k}`}
                onClick={() => setTool(k)}
                className={`btn justify-start border ${tool === k ? "border-indigo-600 bg-indigo-50 text-indigo-800" : "border-slate-300 bg-white hover:bg-slate-50"}`}
                aria-pressed={tool === k}
              >
                + {KIND_LABEL[k]} {k === "signature" ? <span className="text-xs text-red-600">(required)</span> : <span className="text-xs text-slate-400">(optional)</span>}
              </button>
            ))}
          </div>

          <div>
            <div className="flex items-center justify-between">
              <h4 className="text-xs font-semibold uppercase tracking-wide text-slate-500">Placed fields</h4>
              <span className="text-xs text-slate-500" data-testid="save-state" aria-live="polite">
                {saveState === "saving" ? "Saving…" : saveState === "saved" ? "Saved" : saveState === "error" ? "Not saved" : saveState === "dirty" ? "Unsaved changes" : ""}
              </span>
            </div>
            {fields.length === 0 ? (
              <p className="mt-2 text-sm text-slate-500">No fields yet.</p>
            ) : (
              <ul className="mt-2 flex flex-col gap-1">
                {fields.map((f) => (
                  <li key={f.key} className="flex items-center justify-between gap-2 rounded-md px-2 py-1 text-sm hover:bg-slate-50">
                    <button type="button" className="text-left" onClick={() => { setSelected(f.key); scrollToPage(f.pageIndex); }}>
                      {KIND_LABEL[f.kind]} · <span className="text-slate-500">page {f.pageIndex + 1}</span>
                    </button>
                    <button type="button" className="text-xs text-red-600 hover:underline" onClick={() => remove(f.key)}>
                      Remove
                    </button>
                  </li>
                ))}
              </ul>
            )}
            {saveError && <p role="alert" className="mt-2 text-xs text-red-600">{saveError} <button className="underline" onClick={() => void save()}>Retry</button></p>}
          </div>

          {pages.length > 1 && (
            <div className="flex flex-wrap gap-1 text-xs">
              <span className="text-slate-500">Jump to:</span>
              {pages.map((p) => (
                <button key={p.index} type="button" onClick={() => scrollToPage(p.index)} className="rounded border border-slate-200 px-1.5 hover:bg-slate-100">
                  {p.index + 1}
                </button>
              ))}
            </div>
          )}

          <div className="border-t border-slate-200 pt-4">
            <h3 className="text-sm font-semibold">2. Create signing link</h3>
            <p className="mt-1 text-xs text-slate-500">Fields are locked once the link is created. You will get a link to copy and share.</p>
            <button type="button" data-testid="create-link" onClick={createLink} disabled={sending} className="btn-primary mt-3 w-full">
              {sending ? "Creating link…" : "Create signing link"}
            </button>
            {!hasSignature && !sendError && <p className="mt-2 text-xs text-amber-700">A signature field is required.</p>}
            {sendError && <p role="alert" className="mt-2 text-xs text-red-600">{sendError}</p>}
          </div>
        </div>
      </aside>
    </div>
  );
}
