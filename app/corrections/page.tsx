import Link from "next/link";
import { Suspense } from "react";
import { learningStatus } from "@/lib/corrections";
import { db } from "@/lib/db";

type ByCriterion = { name: string; n: number; up: number; down: number; avg: number | null; scored: number };
type Recent = { id: number; company_name: string; criterion: string; old_score: number | null; new_score: number; reason: string; sector: string | null; stage: string | null };

async function Body() {
  const sql = db();
  let by: ByCriterion[], recent: Recent[], learning: Awaited<ReturnType<typeof learningStatus>>;
  try {
    by = (await sql`select c.name, count(k.id)::int as n,
        count(k.id) filter (where k.new_score > coalesce(k.old_score, 0))::int as up,
        count(k.id) filter (where k.new_score < k.old_score)::int as down,
        round(avg(abs(k.new_score - k.old_score)), 1)::float as avg,
        (select count(*) from scores s where s.criterion_id = c.id and s.score is not null)::int as scored
      from criteria c left join corrections k on k.criterion_id = c.id group by c.id, c.name order by n desc, c.id`) as ByCriterion[];
    recent = (await sql`select k.id, a.company_name, c.name as criterion, k.old_score, k.new_score, k.reason, k.sector, k.stage
      from corrections k join applications a on a.id = k.application_id join criteria c on c.id = k.criterion_id order by k.id desc limit 30`) as Recent[];
    learning = await learningStatus(sql);
  } catch (e) {
    return <p className="mt-6 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">Could not read the database: {e instanceof Error ? e.message : "Unknown error"}</p>;
  }
  return (
    <>
      <p className={`mt-6 rounded border p-3 text-sm ${learning.on ? "border-zinc-300" : "border-amber-300 bg-amber-50"}`}>
        <strong>Learning from corrections is {learning.on ? "on" : "off"}.</strong> {learning.why}
      </p>
      <h2 className="mt-8 font-medium">Most-corrected criteria</h2>
      <p className="text-xs text-zinc-500">A criterion Riya keeps changing may no longer match what the fund actually looks for. That is drift from the written criteria, for the partners to look at.</p>
      <table className="mt-2 w-full text-sm">
        <thead className="text-left text-xs text-zinc-500">
          <tr><th className="py-1">Criterion</th><th>Corrections</th><th>Raised</th><th>Lowered</th><th>Average change</th><th>Share of scores changed</th></tr>
        </thead>
        <tbody className="divide-y">
          {by.map((r) => (
            <tr key={r.name}>
              <td className="py-1">{r.name}</td><td>{r.n}</td><td>{r.up}</td><td>{r.down}</td>
              <td>{r.avg ?? "–"}</td><td>{r.scored ? `${Math.round((r.n / r.scored) * 100)}%` : "–"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2 className="mt-8 font-medium">Latest corrections</h2>
      {recent.length === 0 && <p className="mt-2 text-sm text-zinc-600">None yet. Correct a score on an application page.</p>}
      <ul className="mt-2 space-y-2 text-sm">
        {recent.map((r) => (
          <li key={r.id} className="rounded border p-2">
            <strong>{r.company_name}</strong> · {r.criterion}: {r.old_score ?? "gap"} to {r.new_score}
            <span className="text-xs text-zinc-500"> ({r.sector ?? "sector unknown"}, {r.stage ?? "stage unknown"})</span>
            <div className="text-zinc-700">{r.reason}</div>
          </li>
        ))}
      </ul>
    </>
  );
}

export default function CorrectionsPage() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <Link href="/" className="text-sm text-zinc-500">← Applications</Link>
      <h1 className="mt-2 text-2xl font-semibold">Corrections</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Every score Riya changes is saved with her reason and the company&apos;s sector and stage. When a similar company is scored, up to 3 corrections per criterion are shown to the scorer and next to the score.
      </p>
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">Loading…</p>}>
        <Body />
      </Suspense>
    </main>
  );
}
