import Link from "next/link";
import { Suspense } from "react";
import { SubmitButton } from "@/components/SubmitButton";
import { INSUFFICIENT_GAPS } from "@/lib/backtest";
import { db } from "@/lib/db";
import { run, runFacts } from "./actions";

type Row = {
  run_id: number; company_name: string; sector: string | null; what: string | null; result: string | null; decision: string; agrees: boolean | null;
  verdict: string | null; verdict_note: string | null; error: string | null; note: string | null; created_at: string;
  scores: { criterion_id: number; score: number | null; reasoning: string }[] | null;
};

async function Report({ mode }: { mode: "description" | "facts" }) {
  let rows: Row[], names: { id: number; name: string }[];
  try {
    rows = (await db()`select b.run_id, p.company_name, p.sector, p.original_application as what, b.result, b.decision, b.agrees, b.verdict, b.verdict_note, b.error, d.partner_note as note, b.created_at, b.scores
      from backtest_results b join past_deals p on p.id = b.past_deal_id join partner_decisions d on d.past_deal_id = p.id
      where b.mode = ${mode} and b.run_id = (select max(run_id) from backtest_results where mode = ${mode}) order by p.id`) as Row[];
    names = (await db()`select id, name from criteria`) as { id: number; name: string }[];
  } catch (e) {
    return <p className="mt-6 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">Could not read the database: {e instanceof Error ? e.message : "Unknown error"}</p>;
  }
  if (!rows.length) return <p className="mt-6 text-sm text-zinc-600">No backtest has been run yet.</p>;

  const scoredRows = rows.filter((r) => !r.error);
  const agree = scoredRows.filter((r) => r.agrees === true).length;
  const bad = scoredRows.filter((r) => r.agrees === false);
  const none = scoredRows.filter((r) => r.agrees === null).length;
  const judged = agree + bad.length;
  const missed = bad.filter((r) => r.decision === "funded");
  const extra = bad.filter((r) => r.decision === "passed");
  const rate = judged ? Math.round((bad.length / judged) * 100) : null;
  const name = (id: number) => names.find((n) => n.id === id)?.name ?? `criterion ${id}`;

  return (
    <>
      <p className="mt-6 text-xs text-zinc-500">Run {rows[0].run_id}, {new Date(rows[0].created_at).toLocaleString("en-IN")}</p>
      <div className="mt-2 rounded border p-4 text-sm">
        <p>Deals: <strong>{rows.length}</strong>. Agree: <strong>{agree}</strong>. Disagree: <strong>{bad.length}</strong>. No recommendation (too many unknowns): <strong>{none}</strong>.{rows.length > scoredRows.length && <> Failed: <strong>{rows.length - scoredRows.length}</strong>.</>}</p>
        <p className="mt-2 text-base">Disagreement rate: <strong>{rate === null ? "not available" : `${rate}% (${bad.length} of ${judged} deals that got a recommendation)`}</strong></p>
        <p className="mt-1 text-xs text-zinc-500">
          Compare with the 30% limit in the pack, which is a proposal for the partners to confirm. The {none} deals with no recommendation are left out of the rate, not counted as agreement.
        </p>
        <ul className="mt-2 list-disc pl-5 text-xs text-zinc-600">
          <li>Funded, but the app would not advance: {missed.length}. These are the serious ones, deals the app would have let go.</li>
          <li>Passed, but the app would advance: {extra.length}. Less serious: the partners may have taken a call first and passed afterwards.</li>
        </ul>
      </div>
      <p className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-xs">
        <strong>What this does and does not test.</strong> No original applications exist for these deals, only memos written after each decision. {mode === "facts" ? "So each deal was scored from its sector, the one-paragraph description and the plain facts about the founders that a model copied from the memo's founder section, with judgements removed (every fact is checked against the memo text). The partners wrote that memo after deciding, and chose what to put in it, so this run probably flatters the app. Read the rate as a ceiling on how well the app agrees, not proof." : "So each deal was scored from its sector and the one-paragraph description only. Company name, stage, source, web research and the memo were withheld. This tests how well a product description alone fits the criteria, much more than founder quality."} Company name, stage, source and web research were always withheld. When {INSUFFICIENT_GAPS} or more criteria are unknown the app makes no recommendation. The verdicts are suggestions from a model that read the partners&apos; own reason, for the partners to confirm.
      </p>

      <h2 className="mt-8 font-medium">Disagreements</h2>
      {bad.length === 0 && <p className="mt-2 text-sm text-zinc-600">None in this run.</p>}
      <div className="mt-2 space-y-4">
        {bad.map((r) => (
          <div key={r.company_name} className="rounded border p-3 text-sm">
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <h3 className="font-medium">{r.company_name} <span className="text-xs font-normal text-zinc-500">({r.sector})</span></h3>
              <span className="text-xs">App: {r.result}. Partners: {r.decision}.</span>
            </div>
            <p className="mt-1 text-xs text-zinc-500">{r.what}</p>
            <ul className="mt-2 text-xs">
              {r.scores?.map((s) => <li key={s.criterion_id}><strong>{name(s.criterion_id)}:</strong> {s.score ?? "gap"}. {s.reasoning}</li>)}
            </ul>
            <p className="mt-2 text-xs"><strong>Partners&apos; reason:</strong> {r.note}</p>
            <p className="mt-2 text-xs text-blue-800"><strong>Suggested verdict: {r.verdict}.</strong> {r.verdict_note}</p>
          </div>
        ))}
      </div>

      <h2 className="mt-8 font-medium">All deals</h2>
      <table className="mt-2 w-full text-sm">
        <tbody className="divide-y">
          {rows.map((r) => (
            <tr key={r.company_name}>
              <td className="py-1">{r.company_name}</td>
              <td>{r.decision}</td>
              <td>{r.error ? `failed: ${r.error}` : r.result}</td>
              <td>{r.agrees === null ? "no recommendation" : r.agrees ? "agree" : "disagree"}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}

export default function BacktestPage() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <Link href="/" className="text-sm text-zinc-500">← Applications</Link>
      <h1 className="mt-2 text-2xl font-semibold">Backtest on past deals</h1>
      <p className="mt-1 text-sm text-zinc-500">Scores the 12 past deals and compares the app&apos;s recommendation with what the partners decided.</p>
      <h2 className="mt-6 text-lg font-semibold">With founder facts from the memos</h2>
      <form action={runFacts} className="mt-2">
        <SubmitButton pendingText="Running… about 3 minutes">Run with founder facts</SubmitButton>
      </form>
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">Loading…</p>}>
        <Report mode="facts" />
      </Suspense>
      <h2 className="mt-12 text-lg font-semibold">From the description only</h2>
      <form action={run} className="mt-2">
        <SubmitButton pendingText="Running… about 2 minutes">Run from the description only</SubmitButton>
      </form>
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">Loading…</p>}>
        <Report mode="description" />
      </Suspense>
    </main>
  );
}
