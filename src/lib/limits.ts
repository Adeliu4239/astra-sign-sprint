/**
 * Abuse and resource limits. Chosen so an evaluator (or a real small firm) never meets them in
 * normal use, while one script cannot fill the shared database. Documented in docs/SECURITY_LIMITS.md
 * and covered by tests/integration/limits.test.ts.
 */
export const LIMITS = {
  /** New demo workspaces per client IP per hour (a full 3-browser E2E run creates ~35). */
  workspaceCreatesPerIpPerHour: 60,
  /** Upload starts (single-request upload or chunked-upload init) per workspace per hour. */
  uploadStartsPerWorkspacePerHour: 60,
  /** Upload starts per client IP per hour, across all workspaces. */
  uploadStartsPerIpPerHour: 150,
  /** Stored PDF bytes per workspace (originals + signed copies). */
  workspaceStorageBytes: 150 * 1024 * 1024,
  /** Chunked-upload sessions open at the same time per workspace. */
  concurrentUploadSessions: 3,
  /** Unfinished chunked-upload sessions are discarded after this many minutes. */
  uploadSessionTtlMinutes: 60,
} as const;

export const RATE_WINDOW_SECONDS = 3600;
