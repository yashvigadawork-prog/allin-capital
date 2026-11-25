import Link from "next/link";
import { NewForm } from "./NewForm";

export default function NewApplication() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <Link href="/" className="text-sm text-zinc-500">← Applications</Link>
      <h1 className="mt-2 text-2xl font-semibold">Add an application</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Upload the deck and the form as PDFs, or paste their text. Reading starts when you press Run all on the home page, or Read again on the application.
      </p>
      <NewForm />
    </main>
  );
}
