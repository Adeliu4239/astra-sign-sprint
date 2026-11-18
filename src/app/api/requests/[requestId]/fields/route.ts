import { NextResponse } from "next/server";
import { handle } from "@/lib/server/errors";
import { requireWorkspace } from "@/lib/server/session";
import { saveFields } from "@/lib/server/service";
import { saveFieldsSchema } from "@/lib/schemas";

export const PUT = handle(async (req: Request, ctx: { params: Promise<{ requestId: string }> }) => {
  const ws = await requireWorkspace();
  const { requestId } = await ctx.params;
  const { fields } = saveFieldsSchema.parse(await req.json().catch(() => ({})));
  return NextResponse.json(await saveFields(ws.id, requestId, fields));
});
