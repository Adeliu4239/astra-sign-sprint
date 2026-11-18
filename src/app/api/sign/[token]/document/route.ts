import { handle } from "@/lib/server/errors";
import { getSignerDocument } from "@/lib/server/service";
import { pdfResponse } from "@/lib/server/http";

/** Token-scoped document access for the unauthenticated signer. */
export const GET = handle(async (req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  const url = new URL(req.url);
  const which = url.searchParams.get("which") === "signed" ? "signed" : "original";
  const doc = await getSignerDocument(token, which);
  return pdfResponse(doc.content, doc.filename, url.searchParams.get("download") === "1");
});
