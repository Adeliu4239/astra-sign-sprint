import "server-only";
import { env } from "./env";
import { clientIp } from "./errors";
import type { RequestMeta } from "./service";

export function metaFrom(req: Request): RequestMeta {
  return { ip: clientIp(req), userAgent: req.headers.get("user-agent") };
}

/** Origin used to build public signer links. */
export function originFromHeaders(h: Headers): string {
  const configured = env().PUBLIC_BASE_URL;
  if (configured) return configured.replace(/\/$/, "");
  const host = h.get("x-forwarded-host") ?? h.get("host") ?? "localhost:3000";
  const proto = h.get("x-forwarded-proto") ?? (host.startsWith("localhost") || host.startsWith("127.") ? "http" : "https");
  return `${proto}://${host}`;
}

/**
 * Streams the PDF in chunks: Vercel rejects buffered function responses above ~4.5 MB but
 * accepts streamed ones (measured on this project's deployment).
 */
export function pdfResponse(content: Uint8Array, filename: string, download: boolean) {
  const safe = filename.replace(/[^\w.\- ()]+/g, "_");
  const CHUNK = 256 * 1024;
  let offset = 0;
  const body = new ReadableStream<Uint8Array>({
    pull(controller) {
      if (offset >= content.byteLength) {
        controller.close();
        return;
      }
      controller.enqueue(new Uint8Array(content.subarray(offset, offset + CHUNK)));
      offset += CHUNK;
    },
  });
  return new Response(body, {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safe}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}

export const SIGNING_TOKEN_HEADER = "x-signing-token";

/**
 * Signer tokens travel in the URL fragment (never sent to servers, so never in access logs or
 * Referer) and reach the API only in this header.
 */
export function signingTokenFrom(req: Request): string {
  return (req.headers.get(SIGNING_TOKEN_HEADER) ?? "").trim();
}
