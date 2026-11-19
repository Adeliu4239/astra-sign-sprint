import { describe, expect, it } from "vitest";
import { caseStage, effectiveStatus, nextStep, stageLabel } from "@/lib/signing/state";
import { filterCases } from "@/lib/case-filter";

describe("case stage shown to admins", () => {
  it("splits drafts into Draft (not preparable yet) and Ready (can create the link)", () => {
    expect(caseStage("no_document", 0)).toBe("draft");
    expect(caseStage("draft", 0)).toBe("draft");
    expect(caseStage("draft", 1)).toBe("ready");
    expect(caseStage("pending", 1)).toBe("pending");
    expect(caseStage("completed", 1)).toBe("completed");
    expect(caseStage("revoked", 1)).toBe("revoked");
    expect(caseStage(effectiveStatus("pending", new Date(Date.now() - 1000)), 1)).toBe("expired");
  });

  it("labels every stage and gives one actionable next step for each", () => {
    expect(Object.values(stageLabel)).toEqual(["Draft", "Ready", "Pending", "Completed", "Expired", "Revoked"]);
    expect(nextStep("no_document", 0)).toMatch(/Upload/);
    expect(nextStep("draft", 0)).toMatch(/signature field/);
    expect(nextStep("draft", 2)).toMatch(/signing link/);
    expect(nextStep("pending", 1)).toMatch(/link/);
    expect(nextStep("completed", 1)).toMatch(/Download/);
    expect(nextStep("expired", 1)).toMatch(/new request/);
    expect(nextStep("revoked", 1)).toMatch(/new request/);
  });
});

describe("case search and filter", () => {
  const rows = [
    { title: "Engagement — Acme", client_name: "Ana Núñez", client_email: "ana@example.test", filename: "msa.pdf", stage: "ready" as const },
    { title: "Retainer", client_name: "李小龍", client_email: "li@example.test", filename: null, stage: "draft" as const },
    { title: "Onboarding", client_name: "Bob Stone", client_email: "bob@acme.test", filename: "onboarding.pdf", stage: "completed" as const },
  ];

  it("matches title, client name, email and filename, case- and accent-insensitively", () => {
    expect(filterCases(rows, { q: "acme" }).map((r) => r.title)).toEqual(["Engagement — Acme", "Onboarding"]);
    expect(filterCases(rows, { q: "nunez" })).toHaveLength(1);
    expect(filterCases(rows, { q: "李" })).toHaveLength(1);
    expect(filterCases(rows, { q: "MSA.PDF" })).toHaveLength(1);
    expect(filterCases(rows, { q: "  " })).toHaveLength(3);
  });

  it("filters by stage and combines with search", () => {
    expect(filterCases(rows, { stage: "completed" }).map((r) => r.title)).toEqual(["Onboarding"]);
    expect(filterCases(rows, { q: "acme", stage: "ready" }).map((r) => r.title)).toEqual(["Engagement — Acme"]);
    expect(filterCases(rows, { stage: "pending" })).toEqual([]);
    expect(filterCases(rows, { stage: "bogus" })).toHaveLength(3);
  });
});
