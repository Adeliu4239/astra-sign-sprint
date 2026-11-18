import { statusLabel, type EffectiveStatus } from "@/lib/signing/state";

const styles: Record<EffectiveStatus | "no_document", string> = {
  no_document: "bg-slate-100 text-slate-700 ring-slate-200",
  draft: "bg-sky-50 text-sky-800 ring-sky-200",
  pending: "bg-amber-50 text-amber-800 ring-amber-200",
  completed: "bg-emerald-50 text-emerald-800 ring-emerald-200",
  revoked: "bg-red-50 text-red-700 ring-red-200",
  expired: "bg-red-50 text-red-700 ring-red-200",
};

export function StatusBadge({ status }: { status: EffectiveStatus | "no_document" }) {
  return (
    <span data-testid="status-badge" className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ${styles[status]}`}>
      {statusLabel[status]}
    </span>
  );
}
