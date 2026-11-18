import { NextResponse } from "next/server";
import { handle } from "@/lib/server/errors";
import { requireWorkspace } from "@/lib/server/session";
import { completeChunkedUpload } from "@/lib/server/service";
import { metaFrom } from "@/lib/server/http";

export const maxDuration = 60;

export const POST = handle(async (req: Request, ctx: { params: Promise<{ uploadId: string }> }) => {
  const ws = await requireWorkspace();
  const { uploadId } = await ctx.params;
  return NextResponse.json(await completeChunkedUpload(ws.id, uploadId, metaFrom(req)), { status: 201 });
});
