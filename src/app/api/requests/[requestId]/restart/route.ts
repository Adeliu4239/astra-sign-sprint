import { NextResponse } from "next/server";
import { handle } from "@/lib/server/errors";
import { requireWorkspace } from "@/lib/server/session";
import { restartRequest } from "@/lib/server/service";
import { metaFrom } from "@/lib/server/http";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ requestId: string }> }) => {
  const ws = await requireWorkspace();
  const { requestId } = await ctx.params;
  return NextResponse.json(await restartRequest(ws.id, requestId, metaFrom(req)), { status: 201 });
});
