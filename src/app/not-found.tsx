import Link from "next/link";

export default function NotFound() {
  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-4 py-24 text-center">
      <h1 className="text-xl font-semibold">Not found</h1>
      <p className="text-sm text-slate-600">This page does not exist, or it belongs to a different demo workspace.</p>
      <Link href="/dashboard" className="btn-primary">Go to your cases</Link>
    </main>
  );
}
