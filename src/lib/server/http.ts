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

export function pdfResponse(content: Uint8Array, filename: string, download: boolean) {
  const safe = filename.replace(/[^\w.\- ()]+/g, "_");
  return new Response(new Uint8Array(content), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Length": String(content.byteLength),
      "Content-Disposition": `${download ? "attachment" : "inline"}; filename="${safe}"`,
      "Cache-Control": "private, no-store",
      "X-Robots-Tag": "noindex",
    },
  });
}
