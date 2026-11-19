import { NextResponse } from "next/server";
import { createWorkspace, currentWorkspace } from "@/lib/server/session";
import { HttpError, clientIp, handle } from "@/lib/server/errors";
import { enforceWorkspaceCreateLimit } from "@/lib/server/limits";

/** "Open demo workspace": plain form POST so it works before JS hydrates. */
export const POST = handle(async (req: Request) => {
  const existing = await currentWorkspace();
  if (!existing) {
    try {
      await enforceWorkspaceCreateLimit(clientIp(req));
    } catch (e) {
      if (e instanceof HttpError && e.status === 429) {
        const to = new URL("/", req.url);
        to.searchParams.set("error", "rate_limited");
        return NextResponse.redirect(to, 303);
      }
      throw e;
    }
    await createWorkspace();
  }
  return NextResponse.redirect(new URL("/dashboard", req.url), 303);
});
