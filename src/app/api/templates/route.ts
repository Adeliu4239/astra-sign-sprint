import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { HttpError, handle } from "@/lib/server/errors";
import { currentWorkspace, requireWorkspace } from "@/lib/server/session";
import { createTemplate } from "@/lib/server/service";
import { createTemplateSchema } from "@/lib/schemas";
import { metaFrom } from "@/lib/server/http";

/** Creates an (empty) agreement template. JSON for the client form; plain form POST answers with a redirect. */
export const POST = handle(async (req: Request) => {
  const isForm = !(req.headers.get("content-type") ?? "").includes("application/json");
  if (!isForm) {
    const ws = await requireWorkspace();
    const input = createTemplateSchema.parse(await req.json().catch(() => ({})));
    const t = await createTemplate(ws.id, input.name, metaFrom(req));
    return NextResponse.json({ id: t.id }, { status: 201 });
  }
  const ws = await currentWorkspace();
  if (!ws) return NextResponse.redirect(new URL("/", req.url), 303);
  const form = await req.formData().catch(() => null);
  try {
    const input = createTemplateSchema.parse({ name: form?.get("name") });
    const t = await createTemplate(ws.id, input.name, metaFrom(req));
    return NextResponse.redirect(new URL(`/templates/${t.id}`, req.url), 303);
  } catch (e) {
    const msg = e instanceof ZodError ? e.issues.map((i) => i.message).join("; ") : e instanceof HttpError ? e.message : "Could not create the template";
    return NextResponse.redirect(new URL(`/templates?error=${encodeURIComponent(msg)}`, req.url), 303);
  }
});
