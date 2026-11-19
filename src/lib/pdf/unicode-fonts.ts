/**
 * Unicode text for signed PDFs. Helvetica (WinAnsi) stays the default, so Latin-1 text is
 * stamped byte-for-byte as before. Text Helvetica cannot encode is drawn with an OFL Noto font,
 * subset by HarfBuzz to just the characters used and embedded whole by pdf-lib. (pdf-lib's own
 * subsetter drops glyphs from these fonts; see assets/fonts/README.md.)
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import type { PDFDocument, PDFFont } from "pdf-lib";

type FontKey = "latin" | "cjk";

const FONT_FILES: Record<FontKey, string> = {
  latin: "NotoSans-Regular.ttf",
  cjk: "NotoSansSC-Regular.ttf",
};

/** Han ideographs, kana, CJK punctuation and full-width forms → the CJK font. */
const CJK = /[　-〿぀-ヿㇰ-ㇿ㐀-䶿一-鿿豈-﫿＀-￯]/u;

const fontBytes = new Map<FontKey, Uint8Array>();
const coverage = new Map<FontKey, { hasGlyphForCodePoint(cp: number): boolean }>();

function assetPath(...parts: string[]) {
  return path.join(process.cwd(), ...parts);
}

function bytesFor(key: FontKey): Uint8Array {
  let b = fontBytes.get(key);
  if (!b) {
    b = new Uint8Array(readFileSync(assetPath("assets", "fonts", FONT_FILES[key])));
    fontBytes.set(key, b);
  }
  return b;
}

function coverageFor(key: FontKey) {
  let c = coverage.get(key);
  if (!c) {
    c = fontkit.create(bytesFor(key) as unknown as Buffer) as unknown as { hasGlyphForCodePoint(cp: number): boolean };
    coverage.set(key, c);
  }
  return c;
}

/* ------------------------------------------------------------ HarfBuzz subset */

interface HbExports {
  memory: WebAssembly.Memory;
  malloc(n: number): number;
  free(p: number): void;
  hb_blob_create(data: number, len: number, mode: number, user: number, destroy: number): number;
  hb_blob_destroy(b: number): void;
  hb_blob_get_data(b: number, lenOut: number): number;
  hb_blob_get_length(b: number): number;
  hb_face_create(blob: number, index: number): number;
  hb_face_destroy(f: number): void;
  hb_face_reference_blob(f: number): number;
  hb_set_add(set: number, cp: number): void;
  hb_subset_input_create_or_fail(): number;
  hb_subset_input_destroy(i: number): void;
  hb_subset_input_unicode_set(i: number): number;
  hb_subset_or_fail(face: number, input: number): number;
}

let hbPromise: Promise<HbExports> | null = null;

function harfbuzz(): Promise<HbExports> {
  if (!hbPromise) {
    hbPromise = (async () => {
      const wasm = readFileSync(assetPath("node_modules", "harfbuzzjs", "dist", "harfbuzz-subset.wasm"));
      const { instance } = await WebAssembly.instantiate(wasm, {});
      return instance.exports as unknown as HbExports;
    })();
    hbPromise.catch(() => {
      hbPromise = null;
    });
  }
  return hbPromise;
}

/** Returns a standalone TrueType font containing only the glyphs for `text`. */
export async function subsetFont(font: Uint8Array, text: string): Promise<Uint8Array> {
  const hb = await harfbuzz();
  const ptr = hb.malloc(font.byteLength);
  new Uint8Array(hb.memory.buffer).set(font, ptr);
  const blob = hb.hb_blob_create(ptr, font.byteLength, 1 /* READONLY */, 0, 0);
  const face = hb.hb_face_create(blob, 0);
  hb.hb_blob_destroy(blob);
  const input = hb.hb_subset_input_create_or_fail();
  try {
    if (!input) throw new Error("HarfBuzz subset input allocation failed");
    const set = hb.hb_subset_input_unicode_set(input);
    for (const ch of text) hb.hb_set_add(set, ch.codePointAt(0)!);
    const sub = hb.hb_subset_or_fail(face, input);
    if (!sub) throw new Error("HarfBuzz could not subset the font");
    const out = hb.hb_face_reference_blob(sub);
    const off = hb.hb_blob_get_data(out, 0);
    const len = hb.hb_blob_get_length(out);
    const bytes = new Uint8Array(hb.memory.buffer).slice(off, off + len);
    hb.hb_blob_destroy(out);
    hb.hb_face_destroy(sub);
    if (bytes.byteLength === 0) throw new Error("HarfBuzz produced an empty font");
    return bytes;
  } finally {
    if (input) hb.hb_subset_input_destroy(input);
    hb.hb_face_destroy(face);
    hb.free(ptr);
  }
}

/* ------------------------------------------------------------ text → font */

function winAnsiEncodable(font: PDFFont, ch: string) {
  try {
    font.encodeText(ch);
    return true;
  } catch {
    return false;
  }
}

/**
 * Chooses a font per string. Returns the base (Helvetica) font when it can encode the whole
 * string; otherwise a Noto subset embedded for exactly this string. Characters that no bundled
 * font covers become "?" (as before), so stamping never fails on an unusual name.
 */
export class TextFonts {
  private cache = new Map<string, Promise<{ font: PDFFont; text: string }>>();
  constructor(
    private doc: PDFDocument,
    private base: PDFFont,
  ) {
    doc.registerFontkit(fontkit);
  }

  /** Resolve the font and the drawable text (unsupported characters replaced by "?"). */
  async resolve(raw: string): Promise<{ font: PDFFont; text: string }> {
    const text = raw.normalize("NFC");
    if ([...text].every((ch) => winAnsiEncodable(this.base, ch))) return { font: this.base, text };
    let hit = this.cache.get(text);
    if (!hit) {
      hit = this.embedFor(text);
      this.cache.set(text, hit);
    }
    return hit;
  }

  private async embedFor(text: string): Promise<{ font: PDFFont; text: string }> {
    const key: FontKey = CJK.test(text) ? "cjk" : "latin";
    const cov = coverageFor(key);
    let drawable = "";
    for (const ch of text) {
      const cp = ch.codePointAt(0)!;
      drawable += /\s/.test(ch) || cov.hasGlyphForCodePoint(cp) ? ch : "?";
    }
    try {
      const sub = await subsetFont(bytesFor(key), drawable + "?");
      const font = await this.doc.embedFont(sub, { subset: false });
      return { font, text: drawable };
    } catch (e) {
      // Never block a signature on font handling: fall back to the previous "?" behaviour.
      console.error("Unicode font embedding failed:", e instanceof Error ? e.message : e);
      let fallback = "";
      for (const ch of text) fallback += winAnsiEncodable(this.base, ch) ? ch : "?";
      return { font: this.base, text: fallback };
    }
  }
}
