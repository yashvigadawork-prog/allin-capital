import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/lib/db";
import { addCompany, removeCompany } from "./actions";

type Row = { id: number; name: string; description: string | null; source_url: string | null };

async function List() {
  let rows: Row[];
  try {
    rows = (await db()`select id, name, description, source_url from portfolio_companies order by lower(name)`) as Row[];
  } catch (e) {
    return <p className="mt-6 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">Could not read the database: {e instanceof Error ? e.message : "Unknown error"}</p>;
  }
  return (
    <>
      <form action={addCompany} className="mt-6 rounded border border-dashed p-4">
        <h2 className="mb-2 font-medium">Add a company</h2>
        <input name="name" required placeholder="Company name" className="w-full rounded border p-2 text-sm" />
        <input name="description" placeholder="What it does, in one line" className="mt-2 w-full rounded border p-2 text-sm" />
        <button className="mt-3 rounded bg-black px-3 py-1 text-sm text-white">Add</button>
      </form>
      <p className="mt-6 text-sm text-zinc-600">{rows.length} companies. Funded past deals from the deal memos are added automatically at check time.</p>
      <table className="mt-2 w-full text-sm">
        <tbody className="divide-y align-top">
          {rows.map((r) => (
            <tr key={r.id}>
              <td className="w-40 py-2 pr-3 font-medium">{r.name}</td>
              <td className="text-zinc-600">{r.description}</td>
              <td className="w-20 text-right">
                <form action={removeCompany}>
                  <input type="hidden" name="id" value={r.id} />
                  <button className="text-xs text-zinc-500 underline">Remove</button>
                </form>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export default function Portfolio() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <Link href="/" className="text-sm text-zinc-500">← Applications</Link>
      <h1 className="mt-2 text-2xl font-semibold">Portfolio companies</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Every application is checked against this list, and an overlap is flagged for Riya even when it may be a false alarm. Copied from{" "}
        <a href="https://www.allincapital.vc/portfolio" className="underline" target="_blank" rel="noreferrer noopener">the fund&apos;s public portfolio page</a>{" "}
        on 21 Nov 2026. The partners should confirm it is complete, since that page is public marketing, not their books.
      </p>
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">Loading…</p>}>
        <List />
      </Suspense>
    </main>
  );
}
