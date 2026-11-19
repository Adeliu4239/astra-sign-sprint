import { NextResponse } from "next/server";
import { handle } from "@/lib/server/errors";
import { getSignerView, logSignerOpened } from "@/lib/server/service";
import { metaFrom, signingTokenFrom } from "@/lib/server/http";

/** Returns what the signer is allowed to see for this token (no admin data). */
export const POST = handle(async (req: Request) => {
  const view = await getSignerView(signingTokenFrom(req));
  if (!view) return NextResponse.json({ status: "invalid" }, { headers: { "Cache-Control": "no-store" } });
  // A status re-check after a dropped submit is not a new "opened" event.
  const recheck = req.headers.get("x-fs-recheck") === "1";
  if (view.status === "pending" && !recheck) await logSignerOpened(view, metaFrom(req)).catch(() => {});
  return NextResponse.json(
    {
      status: view.status,
      caseTitle: view.caseTitle,
      clientName: view.clientName,
      workspaceName: view.workspaceName,
      filename: view.filename,
      pageCount: view.pageCount,
      expiresAt: view.expiresAt,
      completedAt: view.completedAt,
      fields: view.status === "pending" ? view.fields : [],
    },
    { headers: { "Cache-Control": "no-store" } },
  );
});
