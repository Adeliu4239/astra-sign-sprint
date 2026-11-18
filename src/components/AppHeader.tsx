import Link from "next/link";

export function AppHeader({ workspaceName }: { workspaceName?: string }) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
        <Link href={workspaceName ? "/dashboard" : "/"} className="flex items-center gap-2 font-semibold text-slate-900">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-sm text-white">FS</span>
          FileSign
        </Link>
        {workspaceName && (
          <div className="flex items-center gap-3 text-sm text-slate-600">
            <span className="hidden sm:inline rounded-full bg-amber-50 px-3 py-1 text-amber-800 ring-1 ring-amber-200">
              {workspaceName} · synthetic data only
            </span>
            <Link href="/dashboard" className="font-medium text-indigo-700 hover:underline">
              Cases
            </Link>
          </div>
        )}
      </div>
    </header>
  );
}
