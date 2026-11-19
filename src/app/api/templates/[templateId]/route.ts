import { NextResponse } from "next/server";
import { handle } from "@/lib/server/errors";
import { requireWorkspace } from "@/lib/server/session";
import { deleteTemplate } from "@/lib/server/service";

/** Deletes a template. Existing cases keep their own copies of the PDF and fields. */
export const DELETE = handle(async (_req: Request, ctx: { params: Promise<{ templateId: string }> }) => {
  const ws = await requireWorkspace();
  const { templateId } = await ctx.params;
  await deleteTemplate(ws.id, templateId);
  return NextResponse.json({ ok: true });
});
