import type { Metadata } from "next";
import { SignerEntry } from "@/components/SignerEntry";

export const metadata: Metadata = { title: "Review and sign — FileSign", referrer: "no-referrer", robots: { index: false } };

export default function SignPage() {
  return (
    <>
      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <span className="grid h-8 w-8 place-items-center rounded-lg bg-indigo-600 text-sm font-semibold text-white">FS</span>
          <div>
            <p className="font-semibold leading-tight">FileSign</p>
            <p className="text-xs text-slate-500">Secure document signing</p>
          </div>
        </div>
      </header>
      <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">
        <SignerEntry />
      </main>
    </>
  );
}
