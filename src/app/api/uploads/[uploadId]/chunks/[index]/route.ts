import { NextResponse } from "next/server";
import { HttpError, handle } from "@/lib/server/errors";
import { requireWorkspace } from "@/lib/server/session";
import { putUploadChunk } from "@/lib/server/service";
import { UPLOAD_CHUNK_BYTES } from "@/lib/schemas";

export const PUT = handle(async (req: Request, ctx: { params: Promise<{ uploadId: string; index: string }> }) => {
  const ws = await requireWorkspace();
  const { uploadId, index } = await ctx.params;
  const len = Number(req.headers.get("content-length") ?? "0");
  if (len > UPLOAD_CHUNK_BYTES + 1024) throw new HttpError(413, "Chunk too large");
  const data = new Uint8Array(await req.arrayBuffer());
  await putUploadChunk(ws.id, uploadId, Number(index), data);
  return NextResponse.json({ ok: true });
});
