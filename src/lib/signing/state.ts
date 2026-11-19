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

/**
 * What the admin sees: the request status refined by how far preparation got.
 * Draft = needs a PDF or a signature field; Ready = can create the signing link.
 */
export type CaseStage = "draft" | "ready" | "pending" | "completed" | "expired" | "revoked";

export function caseStage(status: EffectiveStatus | "no_document", signatureFields: number): CaseStage {
  if (status === "no_document") return "draft";
  if (status === "draft") return signatureFields > 0 ? "ready" : "draft";
  return status;
}

export const stageLabel: Record<CaseStage, string> = {
  draft: "Draft",
  ready: "Ready",
  pending: "Pending",
  completed: "Completed",
  expired: "Expired",
  revoked: "Revoked",
};

export const CASE_STAGES = Object.keys(stageLabel) as CaseStage[];

/** One actionable next step per case, for the case list. */
export function nextStep(status: EffectiveStatus | "no_document", signatureFields: number): string {
  const stage = caseStage(status, signatureFields);
  switch (stage) {
    case "draft":
      return status === "no_document" ? "Upload the agreement PDF" : "Place a signature field";
    case "ready":
      return "Create the signing link";
    case "pending":
      return "Waiting for the client — copy or resend the link";
    case "completed":
      return "Download the signed PDF";
    case "expired":
      return "Link expired — start a new request";
    case "revoked":
      return "Link revoked — start a new request";
  }
}
