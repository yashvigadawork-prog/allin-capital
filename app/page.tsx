import Link from "next/link";
import { Suspense } from "react";
import { runAll, scoreAll } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { db } from "@/lib/db";
import { computeFlags } from "@/lib/flags";
import { type Ranked, rankedApplications } from "@/lib/rank";
import { setting } from "@/lib/settings";

const STATUS: Record<string, string> = { new: "Not read yet", extracted: "Read", scored: "Scored", manual_review: "Needs a human" };

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <h1 className="text-2xl font-semibold">All In Capital screener</h1>
      <p className="mt-1 text-sm text-zinc-500">
        <Link href="/applications/new" className="underline">Add an application</Link> ·{" "}
        <Link href="/deals" className="underline">Past deals</Link> ·{" "}
        <Link href="/portfolio" className="underline">Portfolio</Link> ·{" "}
        <Link href="/corrections" className="underline">Corrections</Link> ·{" "}
        <Link href="/backtest" className="underline">Backtest</Link> ·{" "}
        <Link href="/queue" className="underline">Queue</Link> ·{" "}
        <Link href="/cost" className="underline">Cost</Link> ·{" "}
        <Link href="/prompts" className="underline">Prompts</Link> ·{" "}
        <Link href="/settings" className="underline">Criteria and settings</Link>
      </p>
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">Loading…</p>}>
        <Applications />
      </Suspense>
    </main>
  );
}

async function Applications() {
  let rows: Ranked[];
  let outOfScope = "", deeptech = "";
  try {
    // Scored first: most criteria at 3 or more, then most at 4 or more, then fewest gaps. Then read-but-unscored, fewest
    // empty fields first. Ties by id, so the order never changes between runs. No total score is made.
    const sql = db();
    outOfScope = await setting(sql, "out_of_scope_sectors", "");
    deeptech = await setting(sql, "deeptech_keywords", "");
    rows = await rankedApplications(sql);
  } catch (e) {
    return (
      <p className="mt-6 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
        Could not read the database: {e instanceof Error ? e.message : "Unknown error"}
      </p>
    );
  }
  if (!rows.length) return <p className="mt-6 text-sm text-zinc-600">No applications yet. Run <code>npm run import</code> or add one.</p>;
  const pending = rows.filter((r) => r.status === "new").length;
  const toScore = rows.filter((r) => r.status === "extracted").length;
  return (
    <>
      <div className="mt-6 flex items-center justify-between">
        <p className="text-sm text-zinc-500">
          Scored applications come first: most criteria at 3 or more, then most at 4 or more, then fewest gaps. There is no total score and nothing here is a verdict.
        </p>
        <div className="flex gap-2">
          {pending > 0 && (
            <form action={runAll}>
              <SubmitButton pendingText={`Reading ${pending} applications… this takes a few minutes`}>Run all ({pending})</SubmitButton>
            </form>
          )}
          {toScore > 0 && (
            <form action={scoreAll}>
              <SubmitButton pendingText={`Scoring ${toScore} applications… this takes a few minutes`}>Score all ({toScore})</SubmitButton>
            </form>
          )}
        </div>
      </div>
      <table className="mt-4 w-full text-sm">
        <thead className="text-left text-zinc-500">
          <tr><th className="py-1">#</th><th>Company</th><th>Status</th><th>Criteria at 3 or more</th><th>For Riya</th></tr>
        </thead>
        <tbody className="divide-y">
          {rows.map((r, i) => (
            <tr key={r.id}>
              <td className="py-2 pr-2 text-zinc-500">{i + 1}</td>
              <td><Link href={`/applications/${r.id}`} className="underline">{r.company_name}</Link></td>
              <td className={r.status === "manual_review" ? "text-red-700" : ""}>{STATUS[r.status] ?? r.status}</td>
              <td className="text-zinc-600">
                {r.status === "scored"
                  ? `${r.c3} of ${r.n}${r.gaps ? `, ${r.gaps} gap${r.gaps > 1 ? "s" : ""}` : ""}`
                  : r.status === "extracted"
                    ? `not scored (${r.empty_fields?.length ?? 0} fields not stated)`
                    : "–"}
              </td>
              <td className="text-xs text-amber-800">
                {[
                  r.overlaps > 0 ? "Portfolio overlap" : null,
                  ...(r.fields ? computeFlags(r.fields, outOfScope, deeptech).map((f) => (f.kind === "deeptech" ? "Deeptech" : "Sector out of scope?")) : []),
                ].filter(Boolean).join(", ")}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
