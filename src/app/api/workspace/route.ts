import { NextResponse } from "next/server";
import { createWorkspace, currentWorkspace } from "@/lib/server/session";
import { handle } from "@/lib/server/errors";

/** "Open demo workspace": plain form POST so it works before JS hydrates. */
export const POST = handle(async (req: Request) => {
  const existing = await currentWorkspace();
  if (!existing) await createWorkspace();
  return NextResponse.redirect(new URL("/dashboard", req.url), 303);
});
