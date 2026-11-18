import { NextResponse } from "next/server";
import { handle } from "@/lib/server/errors";
import { requireWorkspace } from "@/lib/server/session";
import { sendRequest, signerUrl } from "@/lib/server/service";
import { metaFrom, originFromHeaders } from "@/lib/server/http";

export const POST = handle(async (req: Request, ctx: { params: Promise<{ requestId: string }> }) => {
  const ws = await requireWorkspace();
  const { requestId } = await ctx.params;
  const { token, expiresAt } = await sendRequest(ws.id, requestId, metaFrom(req));
  return NextResponse.json({ url: signerUrl(originFromHeaders(req.headers), token), expiresAt }, { status: 201 });
});
