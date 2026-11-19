import { stageLabel, type CaseStage } from "@/lib/signing/state";

const styles: Record<CaseStage, string> = {
  draft: "bg-slate-100 text-slate-700 ring-slate-200",
  ready: "bg-sky-50 text-sky-800 ring-sky-200",
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  completed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  revoked: "bg-red-50 text-red-700 ring-red-200",
  expired: "bg-red-50 text-red-700 ring-red-200",
};

export function StatusBadge({ stage }: { stage: CaseStage }) {
  return (
    <span data-testid="status-badge" data-stage={stage} className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${styles[stage]}`}>
      {stageLabel[stage]}
    </span>
  );
}
