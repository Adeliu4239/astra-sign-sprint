import { handle } from "@/lib/server/errors";
import { getSignerDocument } from "@/lib/server/service";
import { pdfResponse, signingTokenFrom } from "@/lib/server/http";

/** Token-scoped document access for the unauthenticated signer (token in header only). */
export const GET = handle(async (req: Request) => {
  const url = new URL(req.url);
  const which = url.searchParams.get("which") === "signed" ? "signed" : "original";
  const doc = await getSignerDocument(signingTokenFrom(req), which);
  return pdfResponse(doc.content, doc.filename, url.searchParams.get("download") === "1");
});
