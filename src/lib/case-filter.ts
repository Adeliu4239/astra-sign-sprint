import { CASE_STAGES, type CaseStage } from "@/lib/signing/state";

/** Lower-case and strip accents, so "nunez" finds "Núñez". */
export function fold(s: string): string {
  return s.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
}

export function parseStage(v: unknown): CaseStage | undefined {
  return typeof v === "string" && (CASE_STAGES as string[]).includes(v) ? (v as CaseStage) : undefined;
}

interface Filterable {
  title: string;
  client_name: string;
  client_email: string;
  filename: string | null;
  stage: CaseStage;
}

export function filterCases<T extends Filterable>(rows: T[], f: { q?: string; stage?: string }): T[] {
  const q = fold((f.q ?? "").trim());
  const stage = parseStage(f.stage);
  return rows.filter(
    (r) =>
      (!stage || r.stage === stage) &&
      (!q || [r.title, r.client_name, r.client_email, r.filename ?? ""].some((v) => fold(v).includes(q))),
  );
}
