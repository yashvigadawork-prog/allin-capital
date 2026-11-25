import Link from "next/link";
import { Suspense } from "react";
import { db } from "@/lib/db";
import { setting } from "@/lib/settings";
import { addCriterion, saveCriterion, saveRate, saveRules } from "./actions";

type Criterion = { id: number; name: string; definition: string; source_url: string | null; status: string; decisive_fields: string[] };

const input = "mt-1 w-full rounded border p-2 text-sm";

function Fields({ c }: { c?: Criterion }) {
  return (
    <>
      <label className="block text-sm">Name
        <input name="name" required defaultValue={c?.name} className={input} />
      </label>
      <label className="mt-3 block text-sm">Definition, in plain words
        <textarea name="definition" required rows={2} defaultValue={c?.definition} className={input} />
      </label>
      <label className="mt-3 block text-sm">Source link
        <input name="source_url" type="url" defaultValue={c?.source_url ?? ""} className={input} />
      </label>
      <label className="mt-3 block text-sm">Facts that must be stated to score this without a cap (field names, separated by commas)
        <input name="decisive_fields" defaultValue={c?.decisive_fields.join(", ") ?? ""} className={input} />
      </label>
    </>
  );
}

async function Rate() {
  let value = "";
  try {
    const rows = (await db()`select value from settings where key = 'usd_inr'`) as { value: string }[];
    value = rows[0]?.value ?? "";
  } catch {
    return null; // the criteria list below already shows the database error
  }
  return (
    <form action={saveRate} className="mt-6 rounded border p-4">
      <label className="block text-sm">USD to INR rate, used to show model costs in rupees
        <input name="usd_inr" type="number" step="any" min="0" required defaultValue={value} className={input} />
      </label>
      <p className="mt-1 text-xs text-zinc-500">The starting value is a placeholder, not a quoted rate. Set today&apos;s rate.</p>
      <button className="mt-3 rounded bg-black px-3 py-1 text-sm text-white">Save rate</button>
    </form>
  );
}

async function Rules() {
  let cap = "", out = "", deep = "", rate = "", min = "", on = "", days = "", conc = "", limit = "", ceiling = "";
  try {
    const sql = db();
    cap = await setting(sql, "missing_evidence_cap", "2");
    out = await setting(sql, "out_of_scope_sectors", "");
    deep = await setting(sql, "deeptech_keywords", "");
    rate = await setting(sql, "learning_kill_rate", "50");
    min = await setting(sql, "learning_kill_min", "5");
    on = await setting(sql, "learning_enabled", "on");
    days = await setting(sql, "followup_days", "3");
    conc = await setting(sql, "queue_concurrency", "3");
    limit = await setting(sql, "daily_limit_inr", "500");
    ceiling = await setting(sql, "app_cost_ceiling_inr", "25");
  } catch {
    return null;
  }
  return (
    <form action={saveRules} className="mt-6 rounded border p-4">
      <h2 className="font-medium">Scoring rules <span className="text-xs font-normal text-zinc-500">(partner decisions still open)</span></h2>
      <label className="mt-3 block text-sm">When a decisive fact is not stated, cap that criterion at this score (0 = never cap, only list the gap)
        <input name="missing_evidence_cap" type="number" min="0" max="5" step="1" required defaultValue={cap} className={input} />
      </label>
      <label className="mt-3 block text-sm">Sectors to flag as possibly out of scope (separated by commas). They are flagged, never rejected.
        <input name="out_of_scope_sectors" defaultValue={out} className={input} />
      </label>
      <label className="mt-3 block text-sm">Words that suggest deeptech (the partners take the second call)
        <input name="deeptech_keywords" defaultValue={deep} className={input} />
      </label>
      <label className="mt-3 flex items-center gap-2 text-sm">
        <input name="learning_enabled" type="checkbox" defaultChecked={on !== "off"} /> Show past corrections to the scorer (learning)
      </label>
      <label className="mt-3 block text-sm">Kill rule: turn learning off when Riya corrects at least this percent of the scores that used past corrections
        <input name="learning_kill_rate" type="number" min="0" max="100" step="any" required defaultValue={rate} className={input} />
      </label>
      <label className="mt-3 block text-sm">…but only once at least this many scores have used past corrections
        <input name="learning_kill_min" type="number" min="1" step="1" required defaultValue={min} className={input} />
      </label>
      <label className="mt-3 block text-sm">Follow-up: draft one reminder when the intro email has had no reply after this many days (0 = straight away, for testing)
        <input name="followup_days" type="number" min="0" step="1" required defaultValue={days} className={input} />
      </label>
      <label className="mt-3 block text-sm">Queue: how many applications to work on at the same time (1 to 10; lower if the model complains about rate limits)
        <input name="queue_concurrency" type="number" min="1" max="10" step="1" required defaultValue={conc} className={input} />
      </label>
      <label className="mt-3 block text-sm">Daily spending limit on model calls, in rupees (all model calls stop for the rest of the day once it is reached; see the Cost page)
        <input name="daily_limit_inr" type="number" min="1" step="1" required defaultValue={limit} className={input} />
      </label>
      <label className="mt-3 block text-sm">Per-application cost ceiling, in rupees (an application that costs more is flagged on the Cost page; nothing is stopped)
        <input name="app_cost_ceiling_inr" type="number" min="1" step="1" required defaultValue={ceiling} className={input} />
      </label>
      <button className="mt-3 rounded bg-black px-3 py-1 text-sm text-white">Save rules</button>
    </form>
  );
}

async function Criteria() {
  let rows: Criterion[];
  try {
    rows = (await db()`select id, name, definition, source_url, status, decisive_fields from criteria order by id`) as Criterion[];
  } catch (e) {
    return (
      <p className="mt-6 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">
        Could not read the database: {e instanceof Error ? e.message : "Unknown error"}
      </p>
    );
  }
  return (
    <>
      {rows.length === 0 && <p className="mt-6 text-sm text-zinc-600">No criteria yet. Run <code>npm run db:setup</code>.</p>}
      {rows.map((c) => (
        <form key={c.id} action={saveCriterion} className="mt-6 rounded border p-4">
          <input type="hidden" name="id" value={c.id} />
          <Fields c={c} />
          <div className="mt-3 flex items-center justify-between">
            <span className="text-xs text-zinc-500">Status: {c.status}</span>
            <button className="rounded bg-black px-3 py-1 text-sm text-white">Save</button>
          </div>
        </form>
      ))}
      <form action={addCriterion} className="mt-8 rounded border border-dashed p-4">
        <h2 className="mb-3 font-medium">Add a criterion</h2>
        <Fields />
        <button className="mt-3 rounded bg-black px-3 py-1 text-sm text-white">Add</button>
      </form>
    </>
  );
}

export default function Settings() {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <Link href="/" className="text-sm text-zinc-500">← Applications</Link>
      <h1 className="mt-2 text-2xl font-semibold">Criteria and settings</h1>
      <p className="mt-1 text-sm text-zinc-500">
        Proposed from public sources. The partners confirm them. Wording is paraphrased, not the fund&apos;s own.
      </p>
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">Loading…</p>}>
        <Rate />
        <Rules />
        <Criteria />
      </Suspense>
    </main>
  );
}
