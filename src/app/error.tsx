"use client";

export default function ErrorPage({ reset }: { error: Error; reset: () => void }) {
  return (
    <main className="mx-auto flex max-w-md flex-1 flex-col items-center justify-center gap-3 px-4 py-24 text-center">
      <h1 className="text-xl font-semibold">Something went wrong</h1>
      <p className="text-sm text-slate-600">The page could not be loaded. Your data is safe; please try again.</p>
      <button className="btn-primary" onClick={reset}>Try again</button>
    </main>
  );
}
