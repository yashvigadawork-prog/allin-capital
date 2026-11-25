import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { assertUnderLimit, spentTodayInr } from "./limit";
import { callModel } from "./model";

async function freshDb() {
  const pg = new PGlite();
  for (const f of ["db/schema.sql", "db/seed.sql"])
    for (const s of readFileSync(f, "utf8").split(/;\s*$/m).map((x) => x.trim()).filter(Boolean)) await pg.query(s);
  const sql = (async (s: TemplateStringsArray, ...v: unknown[]) => (await pg.query(s[0] + v.map((_, i) => `$${i + 1}${s[i + 1]}`).join(""), v)).rows) as never;
  return { pg, sql };
}
const spend = (pg: PGlite, inr: number, ago = "0 days") =>
  pg.query("insert into decision_log (step, decision, reason, cost_inr, created_at) values ('x','model call ok','r',$1, now() - $2::interval)", [inr, ago]);

test("the daily limit counts only today's spend and blocks the model call before it is made", async () => {
  const { pg, sql } = await freshDb();
  await spend(pg, 900, "3 days"); // an old day does not count
  await spend(pg, 100);
  assert.equal(await spentTodayInr(sql), 100);
  await assertUnderLimit(sql); // default limit 500
  await pg.query("insert into settings (key, value) values ('daily_limit_inr','150') on conflict (key) do update set value = '150'");
  await spend(pg, 60);
  await assert.rejects(assertUnderLimit(sql), /daily spending limit is reached/);
  let called = false;
  const client = { models: { generateContent: async () => { called = true; throw new Error("must not be called"); } } } as never;
  await assert.rejects(callModel({ step: "extraction", promptVersion: "extract-v1", applicationId: null, input: "x" }, { client, sql }), /daily spending limit/);
  assert.equal(called, false);
  assert.equal(((await pg.query("select count(*)::int as n from decision_log where decision = 'model call blocked'")).rows[0] as { n: number }).n, 1);
});
