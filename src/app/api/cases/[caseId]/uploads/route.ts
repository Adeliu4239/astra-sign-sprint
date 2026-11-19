import { NextResponse } from "next/server";
import { handle } from "@/lib/server/errors";
import { requireWorkspace } from "@/lib/server/session";
import { startChunkedUpload } from "@/lib/server/service";
import { startUploadSchema } from "@/lib/schemas";
import { enforceUploadStartLimit } from "@/lib/server/limits";
import { metaFrom } from "@/lib/server/http";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ caseId: string }> }) => {
  const ws = await requireWorkspace();
  const { caseId } = await ctx.params;
  const input = startUploadSchema.parse(await req.json().catch(() => ({})));
  await enforceUploadStartLimit(ws.id, metaFrom(req).ip);
  return NextResponse.json(await startChunkedUpload(ws.id, caseId, input.filename, input.mime, input.size), { status: 201 });
});
