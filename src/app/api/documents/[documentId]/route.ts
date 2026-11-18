import { handle } from "@/lib/server/errors";
import { requireWorkspace } from "@/lib/server/session";
import { getDocumentForWorkspace } from "@/lib/server/service";
import { pdfResponse } from "@/lib/server/http";

export const GET = handle(async (req: Request, ctx: { params: Promise<{ documentId: string }> }) => {
  const ws = await requireWorkspace();
  const { documentId } = await ctx.params;
  const doc = await getDocumentForWorkspace(ws.id, documentId);
  const download = new URL(req.url).searchParams.get("download") === "1";
  return pdfResponse(doc.content, doc.filename, download);
});
