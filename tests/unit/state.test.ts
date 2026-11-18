import { describe, expect, it } from "vitest";
import { canTransition, checkCanSign, effectiveStatus } from "@/lib/signing/state";

const now = new Date("2026-11-18T12:00:00Z");
const future = new Date("2026-11-20T12:00:00Z");
const past = new Date("2026-11-17T12:00:00Z");

describe("signing request state machine", () => {
  it("allows only forward transitions", () => {
    expect(canTransition("draft", "pending")).toBe(true);
    expect(canTransition("pending", "completed")).toBe(true);
    expect(canTransition("pending", "revoked")).toBe(true);
    expect(canTransition("completed", "pending")).toBe(false);
    expect(canTransition("completed", "revoked")).toBe(false);
    expect(canTransition("revoked", "pending")).toBe(false);
    expect(canTransition("draft", "completed")).toBe(false);
  });
  it("expires pending links", () => {
    expect(effectiveStatus("pending", past, now)).toBe("expired");
    expect(effectiveStatus("pending", future, now)).toBe("pending");
    expect(effectiveStatus("completed", past, now)).toBe("completed");
  });
  it("blocks signing once completed, revoked, expired or unsent", () => {
    expect(checkCanSign("pending", future, now)).toEqual({ ok: true });
    expect(checkCanSign("completed", future, now)).toEqual({ ok: false, reason: "completed" });
    expect(checkCanSign("revoked", future, now)).toEqual({ ok: false, reason: "revoked" });
    expect(checkCanSign("pending", past, now)).toEqual({ ok: false, reason: "expired" });
    expect(checkCanSign("draft", null, now)).toEqual({ ok: false, reason: "not_sent" });
  });
});
