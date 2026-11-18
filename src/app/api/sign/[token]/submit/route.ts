import { NextResponse } from "next/server";
import { HttpError, handle } from "@/lib/server/errors";
import { logRejectedAttempt, submitSignature } from "@/lib/server/service";
import { submitSignatureSchema } from "@/lib/schemas";
import { metaFrom } from "@/lib/server/http";

export const maxDuration = 60;

export const POST = handle(async (req: Request, ctx: { params: Promise<{ token: string }> }) => {
  const { token } = await ctx.params;
  const meta = metaFrom(req);
  const input = submitSignatureSchema.parse(await req.json().catch(() => ({})));
  try {
    const result = await submitSignature(token, input, meta);
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    if (err instanceof HttpError && err.status === 409 && err.code) {
      await logRejectedAttempt(token, err.code, meta).catch(() => {});
    }
    throw err;
  }
});
