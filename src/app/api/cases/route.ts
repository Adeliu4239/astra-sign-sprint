import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError, handle } from "@/lib/server/errors";
import { currentWorkspace, requireWorkspace } from "@/lib/server/session";
import { createCase } from "@/lib/server/service";
import { createCaseSchema } from "@/lib/schemas";
import { metaFrom } from "@/lib/server/http";

/**
 * JSON for the enhanced client form; also accepts a plain HTML form POST (before hydration or
 * without JS) and answers with a redirect.
 */
export const POST = handle(async (req: Request) => {
  const isForm = !(req.headers.get("content-type") ?? "").includes("application/json");
  if (!isForm) {
    const ws = await requireWorkspace();
    const input = createCaseSchema.parse(await req.json().catch(() => ({})));
    const c = await createCase(ws.id, input, metaFrom(req));
    return NextResponse.json({ id: c.id }, { status: 201 });
  }
  const ws = await currentWorkspace();
  if (!ws) return NextResponse.redirect(new URL("/", req.url), 303);
  const form = await req.formData().catch(() => null);
  try {
    const input = createCaseSchema.parse({
      title: form?.get("title"),
      clientName: form?.get("clientName"),
      clientEmail: form?.get("clientEmail"),
      templateId: form?.get("templateId") ?? undefined,
    });
    const c = await createCase(ws.id, input, metaFrom(req));
    return NextResponse.redirect(new URL(`/cases/${c.id}`, req.url), 303);
  } catch (e) {
    const msg = e instanceof ZodError ? e.issues.map((i) => i.message).join("; ") : e instanceof HttpError ? e.message : "Could not create the case";
    return NextResponse.redirect(new URL(`/dashboard?error=${encodeURIComponent(msg)}`, req.url), 303);
  }
});
