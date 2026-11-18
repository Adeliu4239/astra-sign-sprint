import "server-only";
import { z } from "zod";

const schema = z.object({
  DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
  APP_SECRET: z.string().min(32, "APP_SECRET must be at least 32 characters"),
  PUBLIC_BASE_URL: z.string().url().optional(),
});

let cached: z.infer<typeof schema> | null = null;

export function env() {
  if (cached) return cached;
  const parsed = schema.safeParse({
    DATABASE_URL: process.env.DATABASE_URL ?? process.env.POSTGRES_URL,
    APP_SECRET: process.env.APP_SECRET,
    PUBLIC_BASE_URL: process.env.PUBLIC_BASE_URL || undefined,
  });
  if (!parsed.success) {
    throw new Error(`Server misconfigured: ${parsed.error.issues.map((i) => i.message).join("; ")}`);
  }
  cached = parsed.data;
  return cached;
}
