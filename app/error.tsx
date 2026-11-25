"use client";

// Last-resort page so a failure shows a plain message, not a crash screen.
export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
        Something went wrong. Check that the database link and the Gemini key in .env.local are filled in, then try again.
      </p>
      <button onClick={reset} className="mt-4 rounded border px-3 py-1 text-sm">Try again</button>
    </main>
  );
}
