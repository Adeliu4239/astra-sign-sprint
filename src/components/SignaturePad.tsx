"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface SignatureValue {
  method: "drawn" | "typed";
  dataUrl: string;
}

const INK = "#0b1a4a";

/** Crops a canvas to its inked pixels (plus padding) and returns a PNG data URL. */
function trimmedPng(src: HTMLCanvasElement, pad = 12): string | null {
  const ctx = src.getContext("2d");
  if (!ctx) return null;
  const { width, height } = src;
  const data = ctx.getImageData(0, 0, width, height).data;
  let minX = width, minY = height, maxX = -1, maxY = -1;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (data[(y * width + x) * 4 + 3]! > 10) {
        if (x < minX) minX = x;
        if (x > maxX) maxX = x;
        if (y < minY) minY = y;
        if (y > maxY) maxY = y;
      }
    }
  }
  if (maxX < 0) return null;
  const w = maxX - minX + 1 + pad * 2;
  const h = maxY - minY + 1 + pad * 2;
  const out = document.createElement("canvas");
  // Cap output size to keep the upload small.
  const scale = Math.min(1, 1200 / w, 400 / h);
  out.width = Math.max(1, Math.round(w * scale));
  out.height = Math.max(1, Math.round(h * scale));
  const octx = out.getContext("2d")!;
  octx.drawImage(src, minX - pad, minY - pad, w, h, 0, 0, out.width, out.height);
  return out.toDataURL("image/png");
}

export function SignaturePad({ defaultName, onChange }: { defaultName: string; onChange: (v: SignatureValue | null) => void }) {
  const [mode, setMode] = useState<"draw" | "type">("draw");
  const [typed, setTyped] = useState(defaultName);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);

  const setupCanvas = useCallback(() => {
    const c = canvasRef.current;
    if (!c) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const rect = c.getBoundingClientRect();
    c.width = Math.round(rect.width * dpr);
    c.height = Math.round(rect.height * dpr);
    const ctx = c.getContext("2d")!;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.strokeStyle = INK;
    ctx.lineWidth = 2.6;
    setHasInk(false);
  }, []);

  useEffect(() => {
    if (mode !== "draw") return;
    setupCanvas();
    onChange(null);
  }, [mode, setupCanvas, onChange]);

  // Typed signature: render the name in a script font to a PNG.
  useEffect(() => {
    if (mode !== "type") return;
    let cancelled = false;
    const name = typed.trim();
    if (!name) {
      onChange(null);
      return;
    }
    (async () => {
      const family = getComputedStyle(document.documentElement).getPropertyValue("--font-signature").trim() || "cursive";
      try {
        await document.fonts.load(`96px ${family}`, name);
      } catch {
        /* fall back to whatever is available */
      }
      if (cancelled) return;
      const c = document.createElement("canvas");
      const ctx = c.getContext("2d")!;
      ctx.font = `600 96px ${family}`;
      const w = Math.ceil(ctx.measureText(name).width) + 40;
      c.width = Math.min(Math.max(w, 50), 2400);
      c.height = 160;
      ctx.font = `600 96px ${family}`;
      ctx.fillStyle = INK;
      ctx.textBaseline = "middle";
      ctx.fillText(name, 20, 80, c.width - 40);
      const url = trimmedPng(c, 8);
      if (!cancelled) onChange(url ? { method: "typed", dataUrl: url } : null);
    })();
    return () => {
      cancelled = true;
    };
  }, [mode, typed, onChange]);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };

  const finishStroke = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    const c = canvasRef.current;
    if (!c) return;
    const url = trimmedPng(c);
    onChange(url ? { method: "drawn", dataUrl: url } : null);
  };

  return (
    <div className="flex flex-col gap-2">
      <div role="tablist" className="inline-flex w-fit rounded-lg bg-slate-100 p-1 text-sm">
        {(["draw", "type"] as const).map((m) => (
          <button
            key={m}
            role="tab"
            type="button"
            aria-selected={mode === m}
            data-testid={`sig-mode-${m}`}
            onClick={() => setMode(m)}
            className={`rounded-md px-3 py-1 font-medium ${mode === m ? "bg-white shadow text-slate-900" : "text-slate-600"}`}
          >
            {m === "draw" ? "Draw" : "Type"}
          </button>
        ))}
      </div>
      {mode === "draw" ? (
        <div>
          <div className="relative">
            <canvas
              ref={canvasRef}
              data-testid="signature-canvas"
              aria-label="Draw your signature"
              className="h-36 w-full touch-none rounded-lg border border-slate-300 bg-white"
              onPointerDown={(e) => {
                e.currentTarget.setPointerCapture(e.pointerId);
                drawing.current = true;
                const p = pos(e);
                last.current = p;
                const ctx = e.currentTarget.getContext("2d")!;
                ctx.beginPath();
                ctx.arc(p.x, p.y, 1.2, 0, Math.PI * 2);
                ctx.fillStyle = INK;
                ctx.fill();
                setHasInk(true);
              }}
              onPointerMove={(e) => {
                if (!drawing.current || !last.current) return;
                const p = pos(e);
                const ctx = e.currentTarget.getContext("2d")!;
                ctx.beginPath();
                ctx.moveTo(last.current.x, last.current.y);
                ctx.lineTo(p.x, p.y);
                ctx.stroke();
                last.current = p;
              }}
              onPointerUp={finishStroke}
              onPointerCancel={finishStroke}
              onPointerLeave={finishStroke}
            />
            {!hasInk && (
              <span className="pointer-events-none absolute inset-0 grid place-items-center text-sm text-slate-400">Sign here with your mouse, finger or stylus</span>
            )}
            <div className="pointer-events-none absolute inset-x-6 bottom-8 border-b border-slate-300" />
          </div>
          <button
            type="button"
            className="mt-1 text-xs text-slate-600 underline"
            onClick={() => {
              setupCanvas();
              onChange(null);
            }}
          >
            Clear
          </button>
        </div>
      ) : (
        <div className="flex flex-col gap-2">
          <input className="input" value={typed} onChange={(e) => setTyped(e.target.value)} maxLength={80} aria-label="Type your signature" data-testid="typed-signature" />
          <div className="grid h-24 place-items-center overflow-hidden rounded-lg border border-slate-300 bg-white px-3 text-4xl text-[#0b1a4a]" style={{ fontFamily: "var(--font-signature)" }}>
            {typed.trim() || <span className="text-sm text-slate-400" style={{ fontFamily: "var(--font-sans)" }}>Your signature preview</span>}
          </div>
        </div>
      )}
    </div>
  );
}
