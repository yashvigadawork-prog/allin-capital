// Submits 20 test applications at once (copies of the real ones), runs them through the queue, reports, then removes them.
// This spends real model and search credits: about INR 5 to 6 per application.
import { db } from "../lib/db";
import { enqueue, runQueue } from "../lib/queue";

const N = 20;
const sql = db();
const sources = (await sql`select deck_text, form_responses from applications where company_name not like 'LOADTEST%' order by id`) as { deck_text: string; form_responses: unknown }[];
if (!sources.length) throw new Error("There are no applications to copy. Import the case data first.");

const started = new Date();
const ids: number[] = [];
for (let i = 0; i < N; i++) {
  const s = sources[i % sources.length];
  const [a] = (await sql`insert into applications (company_name, deck_text, form_responses) values (${`LOADTEST ${String(i + 1).padStart(2, "0")}`}, ${s.deck_text}, ${JSON.stringify(s.form_responses)}::jsonb) returning id`) as { id: number }[];
  ids.push(a.id);
}
await enqueue(sql, ids);
const t0 = Date.now();
await runQueue();
const seconds = Math.round((Date.now() - t0) / 1000);

const jobs = (await sql`select application_id, kind, status, error from jobs where application_id = any(${ids}::int[])`) as { application_id: number; kind: string; status: string; error: string | null }[];
const complete = ids.filter((id) => jobs.filter((j) => j.application_id === id).every((j) => j.status === "done")).length;
const [cost] = (await sql`select coalesce(sum(cost_inr), 0) as inr, count(*)::int as calls from decision_log where created_at >= ${started.toISOString()}`) as { inr: string; calls: number }[];
const reasons = new Map<string, number>();
for (const j of jobs) if (j.status === "failed" && !j.error?.startsWith("Not run")) reasons.set(`${j.kind}: ${j.error?.slice(0, 120)}`, (reasons.get(`${j.kind}: ${j.error?.slice(0, 120)}`) ?? 0) + 1);

console.log(`Applications submitted: ${N}`);
console.log(`Total time: ${seconds} s (${(seconds / N).toFixed(1)} s per application)`);
console.log(`Applications fully completed (read, researched, scored): ${complete}`);
console.log(`Applications with a failed step: ${N - complete}`);
for (const [r, n] of reasons) console.log(`  ${n} x ${r}`);
console.log(`Model calls logged: ${cost.calls}; cost INR ${Number(cost.inr).toFixed(2)}`);

await sql`delete from applications where id = any(${ids}::int[])`; // jobs, scores and research for them go with it
console.log("Test applications removed.");
