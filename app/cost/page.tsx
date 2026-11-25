import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/lib/db";
import { costlyApplications, dailyLimitInr, projectedPerApplicationInr, spentTodayInr } from "@/lib/limit";

type Row = { label: string; calls: number; inr: string };
const inr = (v: string | number | null) => `₹${Number(v ?? 0).toFixed(2)}`;

function Table({ title, head, rows }: { title: string; head: string; rows: Row[] }) {
  return (
    <section className="mt-6">
      <h2 className="font-medium">{title}</h2>
      <table className="mt-2 w-full text-sm">
        <thead className="text-left text-xs text-zinc-500"><tr><th className="py-1">{head}</th><th>Calls</th><th>Cost</th></tr></thead>
        <tbody className="divide-y">{rows.map((r) => <tr key={r.label}><td className="py-1">{r.label}</td><td>{r.calls}</td><td>{inr(r.inr)}</td></tr>)}</tbody>
      </table>
      {!rows.length && <p className="mt-2 text-sm text-zinc-500">No model calls yet.</p>}
    </section>
  );
}

async function Costs() {
  const sql = db();
  const [spent, limit] = [await spentTodayInr(sql), await dailyLimitInr(sql)];
  const days = (await sql`select to_char((created_at at time zone 'Asia/Kolkata')::date, 'DD Mon YYYY') as label, count(*)::int as calls, sum(cost_inr) as inr
    from decision_log where decision = 'model call ok' group by (created_at at time zone 'Asia/Kolkata')::date order by (created_at at time zone 'Asia/Kolkata')::date desc limit 14`) as Row[];
  const steps = (await sql`select step as label, count(*)::int as calls, sum(cost_inr) as inr from decision_log where decision = 'model call ok' group by step order by sum(cost_inr) desc nulls last`) as Row[];
  const apps = (await sql`select coalesce(a.company_name, 'No application') as label, count(*)::int as calls, sum(d.cost_inr) as inr
    from decision_log d left join applications a on a.id = d.application_id where d.decision = 'model call ok' group by a.company_name order by sum(d.cost_inr) desc nulls last limit 15`) as Row[];
  const [costly, projected] = [await costlyApplications(sql), await projectedPerApplicationInr(sql)];
  const pct = Math.min(100, (spent / limit) * 100);
  return (
    <>
      <p className="mt-4 text-sm">Today: <b>{inr(spent)}</b> of {inr(limit)} daily limit. {spent >= limit && <b className="text-red-700">Limit reached: model calls are stopped until tomorrow.</b>}</p>
      <div className="mt-2 h-2 w-full rounded bg-zinc-100"><div className={`h-2 rounded ${pct >= 100 ? "bg-red-600" : pct >= 80 ? "bg-amber-500" : "bg-green-600"}`} style={{ width: `${pct}%` }} /></div>
      <p className="mt-3 text-sm">Projected cost of the next application: <b>{projected === null ? "not known yet" : inr(projected)}</b> (average of the applications processed so far; 20 at a time cost about ₹132 in the volume test).</p>
      {costly.length > 0 && (
        <p className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          Above the per-application ceiling (set on the Criteria page): {costly.map((c, i) => <span key={c.id}>{i > 0 && ", "}<Link href={`/applications/${c.id}`} className="underline">{c.company_name}</Link> ({inr(c.inr)})</span>)}.
        </p>
      )}
      <Table title="Per day (Indian dates)" head="Day" rows={days} />
      <Table title="Per step" head="Step" rows={steps} />
      <Table title="Per application (top 15)" head="Application" rows={apps} />
    </>
  );
}

export default function CostPage() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <Link href="/" className="text-sm text-zinc-500">← Applications</Link>
      <h1 className="mt-2 text-2xl font-semibold">Cost</h1>
      <p className="mt-1 text-sm text-zinc-600">Model spend from the decision log. The daily limit is set on the Criteria page. Web search costs are not included here.</p>
      <Suspense fallback={<p className="mt-4 text-sm text-zinc-500">Loading…</p>}><Costs /></Suspense>
    </main>
  );
}
