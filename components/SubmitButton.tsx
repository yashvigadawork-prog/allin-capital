"use client";

import { useFormStatus } from "react-dom";

export function SubmitButton({ children, pendingText }: { children: React.ReactNode; pendingText: string }) {
  const { pending } = useFormStatus();
  return (
    <button disabled={pending} className="rounded bg-black px-3 py-1 text-sm text-white disabled:opacity-60">
      {pending ? pendingText : children}
    </button>
  );
}
