import { NextResponse } from "next/server";
import { HttpError, handle } from "@/lib/server/errors";
import { requireWorkspace } from "@/lib/server/session";
import { uploadDocument } from "@/lib/server/service";
import { metaFrom } from "@/lib/server/http";

export const maxDuration = 60;

export const POST = handle(async (req: Request, ctx: { params: Promise<{ caseId: string }> }) => {
  const ws = await requireWorkspace();
  const { caseId } = await ctx.params;
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    throw new HttpError(400, "Upload failed: the file could not be read. If it is larger than 4 MB, compress it and try again.");
  }
  const file = form.get("file");
  if (!(file instanceof File)) throw new HttpError(400, "Choose a PDF file to upload.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const result = await uploadDocument(ws.id, caseId, bytes, file.name, file.type, metaFrom(req));
  return NextResponse.json(result, { status: 201 });
});
