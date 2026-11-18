"use client";

import { useEffect, useRef, useState, type ReactNode } from "react";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";

type PdfjsModule = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfjsModule> | null = null;

function loadPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist/legacy/build/pdf.mjs").then((m) => {
      const mod = m as unknown as PdfjsModule;
      mod.GlobalWorkerOptions.workerSrc = "/pdf.worker.min.mjs";
      return mod;
    });
  }
  return pdfjsPromise;
}

export interface PageInfo {
  index: number;
  /** Displayed size in PDF points (rotation applied). */
  width: number;
  height: number;
}

interface Props {
  url: string;
  renderOverlay?: (page: PageInfo) => ReactNode;
  onLoad?: (pages: PageInfo[]) => void;
  overlayClassName?: string;
  onPagePointerDown?: (page: PageInfo, e: React.PointerEvent<HTMLDivElement>) => void;
}

export function PdfPages({ url, renderOverlay, onLoad, overlayClassName, onPagePointerDown }: Props) {
  const [doc, setDoc] = useState<PDFDocumentProxy | null>(null);
  const [pages, setPages] = useState<PageInfo[]>([]);
  const [error, setError] = useState<string | null>(null);
  const onLoadRef = useRef(onLoad);
  useEffect(() => {
    onLoadRef.current = onLoad;
  });

  useEffect(() => {
    let cancelled = false;
    let task: ReturnType<PdfjsModule["getDocument"]> | null = null;
    (async () => {
      try {
        const pdfjs = await loadPdfjs();
        if (cancelled) return;
        task = pdfjs.getDocument({ url });
        const loaded = await task.promise;
        const infos: PageInfo[] = [];
        for (let i = 0; i < loaded.numPages; i++) {
          const page = await loaded.getPage(i + 1);
          const vp = page.getViewport({ scale: 1 });
          infos.push({ index: i, width: vp.width, height: vp.height });
        }
        if (cancelled) return;
        setDoc(loaded);
        setPages(infos);
        onLoadRef.current?.(infos);
      } catch (e) {
        if (!cancelled) {
          console.error(e);
          setError("The PDF could not be displayed. Refresh the page to try again.");
        }
      }
    })();
    return () => {
      cancelled = true;
      void task?.destroy();
    };
  }, [url]);

  if (error) {
    return <div role="alert" className="rounded-lg border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>;
  }
  if (!doc) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-slate-300 bg-white text-sm text-slate-500" aria-busy>
        Loading document…
      </div>
    );
  }
  return (
    <div className="flex flex-col gap-6" data-testid="pdf-pages">
      {pages.map((p) => (
        <div key={p.index} className="flex flex-col gap-1">
          <div className="text-xs font-medium text-slate-500">
            Page {p.index + 1} of {pages.length}
          </div>
          <div
            className="relative w-full overflow-hidden bg-white shadow-md ring-1 ring-slate-200"
            style={{ aspectRatio: `${p.width} / ${p.height}` }}
            data-testid={`pdf-page-${p.index + 1}`}
          >
            <PageCanvas doc={doc} info={p} />
            <div
              className={`absolute inset-0 ${overlayClassName ?? ""}`}
              data-page-overlay={p.index}
              onPointerDown={onPagePointerDown ? (e) => onPagePointerDown(p, e) : undefined}
            >
              {renderOverlay?.(p)}
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

function PageCanvas({ doc, info }: { doc: PDFDocumentProxy; info: PageInfo }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const boxRef = useRef<HTMLDivElement>(null);
  const [visible, setVisible] = useState(info.index < 2);
  const [cssWidth, setCssWidth] = useState(0);

  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const io = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) setVisible(true);
    }, { rootMargin: "800px" });
    io.observe(el);
    let t: ReturnType<typeof setTimeout> | undefined;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      clearTimeout(t);
      t = setTimeout(() => setCssWidth(Math.round(w)), 120);
    });
    ro.observe(el);
    setCssWidth(Math.round(el.getBoundingClientRect().width));
    return () => {
      io.disconnect();
      ro.disconnect();
      clearTimeout(t);
    };
  }, []);

  useEffect(() => {
    if (!visible || !cssWidth || !canvasRef.current) return;
    let cancelled = false;
    let task: ReturnType<PDFPageProxy["render"]> | null = null;
    (async () => {
      const page = await doc.getPage(info.index + 1);
      if (cancelled || !canvasRef.current) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      const scale = (cssWidth / info.width) * dpr;
      const viewport = page.getViewport({ scale });
      const canvas = canvasRef.current;
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      task = page.render({ canvas, viewport });
      try {
        await task.promise;
      } catch {
        /* cancelled re-render */
      }
    })();
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [doc, info, visible, cssWidth]);

  return (
    <div ref={boxRef} className="absolute inset-0">
      <canvas ref={canvasRef} className="block h-full w-full" aria-label={`Page ${info.index + 1}`} />
    </div>
  );
}
