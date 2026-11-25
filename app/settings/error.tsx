"use client";

// Production hides server error text, so say the likely causes in plain words.
export default function Error({ reset }: { reset: () => void }) {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
        Could not save. Check that the name is not already used, the definition is filled in, and the link starts with https://
      </p>
      <button onClick={reset} className="mt-4 rounded border px-3 py-1 text-sm">Try again</button>
    </main>
  );
}
