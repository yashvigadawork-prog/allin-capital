"use client";

import { useActionState } from "react";
import { addApplication } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";

const input = "mt-1 w-full rounded border p-2 text-sm";

export function NewForm() {
  const [state, action] = useActionState(addApplication, {});
  return (
    <form action={action} className="mt-6 space-y-6">
      <label className="block text-sm">Company name
        <input name="company" required className={input} />
      </label>
      {(["deck", "form"] as const).map((k) => (
        <fieldset key={k} className="rounded border p-4">
          <legend className="px-1 text-sm font-medium">{k === "deck" ? "Pitch deck" : "Application form"}</legend>
          <label className="block text-sm">Upload a PDF
            <input name={`${k}_file`} type="file" accept="application/pdf" className={input} />
          </label>
          <label className="mt-3 block text-sm">…or paste the text
            <textarea name={`${k}_text`} rows={5} className={input} />
          </label>
        </fieldset>
      ))}
      {state.error && <p className="rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{state.error}</p>}
      <SubmitButton pendingText="Saving…">Save application</SubmitButton>
    </form>
  );
}
