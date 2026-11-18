export type RequestStatus = "draft" | "pending" | "completed" | "revoked";
export type EffectiveStatus = RequestStatus | "expired";

export const LINK_TTL_DAYS = 14;

/** Pending links past their expiry are reported (and enforced) as expired. */
export function effectiveStatus(status: RequestStatus, expiresAt: Date | null, now = new Date()): EffectiveStatus {
  if (status === "pending" && expiresAt && expiresAt.getTime() <= now.getTime()) return "expired";
  return status;
}

const transitions: Record<RequestStatus, RequestStatus[]> = {
  draft: ["pending"],
  pending: ["completed", "revoked"],
  completed: [],
  revoked: [],
};

export function canTransition(from: RequestStatus, to: RequestStatus): boolean {
  return transitions[from].includes(to);
}

export type SignCheck =
  | { ok: true }
  | { ok: false; reason: "completed" | "revoked" | "expired" | "not_sent" };

/** Whether a signer may submit right now. Must be evaluated under a row lock. */
export function checkCanSign(status: RequestStatus, expiresAt: Date | null, now = new Date()): SignCheck {
  const eff = effectiveStatus(status, expiresAt, now);
  if (eff === "pending") return { ok: true };
  if (eff === "draft") return { ok: false, reason: "not_sent" };
  return { ok: false, reason: eff };
}

export const statusLabel: Record<EffectiveStatus | "no_document", string> = {
  no_document: "Needs document",
  draft: "Draft",
  pending: "Awaiting signature",
  completed: "Completed",
  revoked: "Revoked",
  expired: "Expired",
};
