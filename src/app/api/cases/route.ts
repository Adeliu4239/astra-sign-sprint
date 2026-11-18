import { NextResponse } from "next/server";
import { handle } from "@/lib/server/errors";
import { requireWorkspace } from "@/lib/server/session";
import { createCase } from "@/lib/server/service";
import { createCaseSchema } from "@/lib/schemas";
import { metaFrom } from "@/lib/server/http";

export const POST = handle(async (req: Request) => {
  const ws = await requireWorkspace();
  const input = createCaseSchema.parse(await req.json().catch(() => ({})));
  const c = await createCase(ws.id, input, metaFrom(req));
  return NextResponse.json({ id: c.id }, { status: 201 });
});
