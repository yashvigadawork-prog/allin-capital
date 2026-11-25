import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/lib/db";

type Deal = { company_name: string; sector: string; stage: string; decision: string };

async function Deals() {
  let rows: Deal[];
  try {
    rows = (await db()`select d.company_name, d.sector, d.stage, x.decision
      from past_deals d join partner_decisions x on x.past_deal_id = d.id order by d.id`) as Deal[];
  } catch (e) {
    return (
      <p className="mt-6 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
        Could not read the database: {e instanceof Error ? e.message : "Unknown error"}
      </p>
    );
  }
  if (!rows.length) return <p className="mt-6 text-sm text-zinc-600">No past deals yet. Run <code>npm run import</code>.</p>;
  return (
    <table className="mt-6 w-full text-sm">
      <thead className="text-left text-zinc-500">
        <tr><th className="py-1">Company</th><th>Sector</th><th>Stage</th><th>Partners</th></tr>
      </thead>
      <tbody className="divide-y">
        {rows.map((d) => (
          <tr key={d.company_name}>
            <td className="py-2">{d.company_name}</td><td>{d.sector}</td><td>{d.stage}</td>
            <td>{d.decision === "funded" ? "Invested" : "Passed"}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function DealsPage() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <Link href="/" className="text-sm text-zinc-500">← Applications</Link>
      <h1 className="mt-2 text-2xl font-semibold">Past deals</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Stage is stored but kept out of the backtest text: every invested deal is &quot;Early round&quot; and every pass is &quot;Pre-seed&quot;, so it would give the answer away.
      </p>
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">Loading…</p>}>
        <Deals />
      </Suspense>
    </main>
  );
}
