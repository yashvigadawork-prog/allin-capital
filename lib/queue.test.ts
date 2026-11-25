import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { enqueue, runQueue, type Runners } from "./queue";

async function freshDb(n: number) {
  const pg = new PGlite();
  for (const f of ["db/schema.sql", "db/seed.sql"])
    for (const s of readFileSync(f, "utf8").split(/;\s*$/m).map((x) => x.trim()).filter(Boolean)) await pg.query(s);
  const sql = (async (s: TemplateStringsArray, ...v: unknown[]) => (await pg.query(s[0] + v.map((_, i) => `$${i + 1}${s[i + 1]}`).join(""), v)).rows) as never;
  const ids: number[] = [];
  for (let i = 0; i < n; i++) ids.push(((await pg.query("insert into applications (company_name) values ($1) returning id", [`App ${i}`])).rows[0] as { id: number }).id);
  return { pg, sql, ids };
}
const statuses = async (pg: PGlite) => (await pg.query("select kind, status, attempts, error from jobs order by id")).rows as { kind: string; status: string; attempts: number; error: string | null }[];

test("each application gets three chained jobs; they run in order and never more than the limit at once", async () => {
  const { pg, sql, ids } = await freshDb(6);
  assert.equal(await enqueue(sql, ids), 6);
  assert.equal(await enqueue(sql, ids), 0); // already queued
  await pg.query("insert into settings (key, value) values ('queue_concurrency','2') on conflict (key) do update set value = '2'");
  let running = 0, peak = 0;
  const order: string[] = [];
  const step = (kind: string) => async (id: number) => {
    order.push(`${id}:${kind}`);
    running++; peak = Math.max(peak, running);
    await new Promise((r) => setTimeout(r, 5));
    running--;
    return { ok: true };
  };
  const runners: Runners = { extract: step("extract"), research: step("research"), score: step("score") };
  const r = await runQueue({ sql, runners });
  assert.deepEqual(r, { done: 18, failed: 0 });
  assert.ok(peak <= 2 && peak >= 1);
  for (const id of ids) assert.deepEqual(order.filter((o) => o.startsWith(`${id}:`)), [`${id}:extract`, `${id}:research`, `${id}:score`]);
});

test("a failing step is retried once, then stops with its reason and the later steps are marked not run; other applications go on", async () => {
  const { pg, sql, ids } = await freshDb(2);
  await enqueue(sql, ids);
  let tries = 0;
  const ok = async () => ({ ok: true });
  const runners: Runners = {
    extract: async (id) => { if (id === ids[0]) { tries++; throw new Error("socket timeout"); } return { ok: true }; },
    research: ok, score: ok,
  };
  const r = await runQueue({ sql, runners });
  assert.equal(tries, 2); // one try and one retry
  assert.deepEqual(r, { done: 3, failed: 3 });
  const rows = await statuses(pg);
  assert.deepEqual(rows.slice(0, 3).map((x) => x.status), ["failed", "failed", "failed"]);
  assert.match(rows[0].error!, /socket timeout/);
  assert.match(rows[1].error!, /Not run: the extract step failed/);
  assert.deepEqual(rows.slice(3).map((x) => x.status), ["done", "done", "done"]);
});

test("a step that fails once and then works is retried to success; a returned error counts as a failure too", async () => {
  const { pg, sql, ids } = await freshDb(1);
  await enqueue(sql, ids);
  let n = 0;
  const ok = async () => ({ ok: true });
  const runners: Runners = { extract: async () => (++n === 1 ? { ok: false, error: "rate limit" } : { ok: true }), research: ok, score: ok };
  assert.deepEqual(await runQueue({ sql, runners }), { done: 3, failed: 0 });
  assert.equal((await statuses(pg))[0].attempts, 2);
});
