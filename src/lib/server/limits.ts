import "server-only";
import type postgres from "postgres";
import { sql } from "./db";
import { hashIp } from "./crypto";
import { HttpError } from "./errors";
import { LIMITS, RATE_WINDOW_SECONDS } from "@/lib/limits";

type Tx = postgres.TransactionSql | postgres.Sql;

/**
 * Atomic fixed-window counter in Postgres (shared by every serverless instance; an in-memory
 * counter would not be). Each call counts one hit and returns whether it is within `limit`.
 */
export async function consumeRateLimit(bucket: string, limit: number, windowSeconds = RATE_WINDOW_SECONDS, db: Tx = sql()) {
  const [row] = await db<{ hits: number; window_start: Date }[]>`
    insert into rate_limit_counters (bucket, window_start, hits)
    values (${bucket}, to_timestamp(floor(extract(epoch from now()) / ${windowSeconds}) * ${windowSeconds}), 1)
    on conflict (bucket, window_start) do update set hits = rate_limit_counters.hits + 1
    returning hits, window_start`;
  // Opportunistic cleanup of old windows (about 1 call in 50).
  if (Math.random() < 0.02) await db`delete from rate_limit_counters where window_start < now() - interval '1 day'`.catch(() => {});
  const resetAt = row!.window_start.getTime() + windowSeconds * 1000;
  return { allowed: row!.hits <= limit, hits: row!.hits, retryAfterSeconds: Math.max(1, Math.ceil((resetAt - Date.now()) / 1000)) };
}

export class RateLimitedError extends HttpError {
  constructor(message: string, retryAfterSeconds: number) {
    super(429, message, "rate_limited", { "Retry-After": String(retryAfterSeconds) });
  }
}

function minutes(s: number) {
  const m = Math.ceil(s / 60);
  return `${m} minute${m === 1 ? "" : "s"}`;
}

/** Bucket key for a client IP. Uses the keyed audit hash, so raw IPs are never stored here. */
export function ipBucket(prefix: string, ip: string | null) {
  return `${prefix}:ip:${hashIp(ip) ?? "unknown"}`;
}

export async function enforceWorkspaceCreateLimit(ip: string | null) {
  const r = await consumeRateLimit(ipBucket("workspace_create", ip), LIMITS.workspaceCreatesPerIpPerHour);
  if (!r.allowed) {
    throw new RateLimitedError(
      `Too many demo workspaces were opened from this network in the last hour. Try again in ${minutes(r.retryAfterSeconds)}, or keep using an existing workspace.`,
      r.retryAfterSeconds,
    );
  }
}

export async function enforceUploadStartLimit(workspaceId: string, ip: string | null) {
  const perWs = await consumeRateLimit(`upload_start:ws:${workspaceId}`, LIMITS.uploadStartsPerWorkspacePerHour);
  const perIp = await consumeRateLimit(ipBucket("upload_start", ip), LIMITS.uploadStartsPerIpPerHour);
  const blocked = !perWs.allowed ? perWs : !perIp.allowed ? perIp : null;
  if (blocked) {
    throw new RateLimitedError(`Too many uploads in the last hour. Try again in ${minutes(blocked.retryAfterSeconds)}.`, blocked.retryAfterSeconds);
  }
}

/**
 * Per-workspace storage quota. Call inside the upload transaction: the workspace row lock
 * serialises concurrent uploads of one workspace, so two uploads cannot both squeeze under it.
 */
export async function enforceStorageQuota(tx: Tx, workspaceId: string, incomingBytes: number) {
  await tx`select id from workspaces where id = ${workspaceId} for update`;
  const [row] = await tx<{ used: string }[]>`
    select coalesce(sum(d.size_bytes), 0)::bigint as used
    from documents d join cases c on c.id = d.case_id where c.workspace_id = ${workspaceId}`;
  const usedBytes = Number(row?.used ?? 0);
  if (usedBytes + incomingBytes > LIMITS.workspaceStorageBytes) {
    const mb = (n: number) => (n / 1024 / 1024).toFixed(1);
    throw new HttpError(
      413,
      `This demo workspace has reached its storage limit (${mb(usedBytes)} of ${mb(LIMITS.workspaceStorageBytes)} MB used). Open a new demo workspace to keep testing.`,
      "storage_quota",
    );
  }
  return usedBytes;
}
