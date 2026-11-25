import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { learningStatus, saveCorrection, similarCorrections } from "./corrections";
import { scoreApplication } from "./score";

async function freshDb() {
  const pg = new PGlite();
  for (const f of ["db/schema.sql", "db/seed.sql"])
    for (const s of readFileSync(f, "utf8").split(/;\s*$/m).map((x) => x.trim()).filter(Boolean)) await pg.query(s);
  const sql = (async (s: TemplateStringsArray, ...v: unknown[]) => (await pg.query(s[0] + v.map((_, i) => `$${i + 1}${s[i + 1]}`).join(""), v)).rows) as never;
  return { pg, sql };
}

const DECK = "[Deck page 1]\nWe turn GST filings into a one-click flow for CA firms.";
const FORM = "[Form page 1]\nTraction: 24 firms are paying us.";
const fields = (sector: string, stage = "Pre-seed") => ({
  founders: [{ name: "A Founder", role: "CEO", past_roles: [] }], product: "p", market: "m", why_now: "w", traction: "t",
  team_start_dates: [{ founder: "A Founder", started: "2026" }], full_time_status: "Full time", sector, stage, prior_startup_experience: "None",
});

async function addApp(pg: PGlite, name: string, f: Record<string, unknown>) {
  const id = ((await pg.query("insert into applications (company_name, deck_text, form_responses, status) values ($1,$2,$3::jsonb,'extracted') returning id", [name, DECK, JSON.stringify({ text: FORM })])).rows[0] as { id: number }).id;
  await pg.query("insert into extracted_fields (application_id, fields, conflicts) values ($1,$2::jsonb,'[]'::jsonb)", [id, JSON.stringify(f)]);
  return id;
}

const reply = () => ({
  scores: ["Why now", "Founder-market fit", "Ability to build", "Team and commitment", "Path to market"].map((criterion) => ({
    criterion, score: 3, source: "Deck page 1", evidence: "one-click flow for CA firms", reasoning: "r", gaps: [],
  })),
});
function model() {
  const inputs: string[] = [];
  const client = { models: { generateContent: async (req: { contents: string; config: { systemInstruction: string } }) => {
    const portfolio = /overlaps with companies/.test(req.config.systemInstruction);
    if (!portfolio) inputs.push(req.contents);
    return { text: JSON.stringify(portfolio ? { overlaps: [] } : reply()), candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 } };
  } } };
  return { inputs, client: client as never };
}
const scoreIdOf = async (pg: PGlite, app: number, criterion = "Why now") =>
  ((await pg.query("select s.id from scores s join criteria c on c.id = s.criterion_id where s.application_id = $1 and c.name = $2", [app, criterion])).rows[0] as { id: number }).id;

test("a fintech correction is shown, and sent to the scorer, for a similar fintech application only", async () => {
  const { pg, sql } = await freshDb();
  const m = model();
  const a = await addApp(pg, "CAPilot", fields("Fintech"));
  await scoreApplication(a, { sql, client: m.client });
  await saveCorrection(sql, await scoreIdOf(pg, a), 5, "A CA who files GST daily is the strongest why-now we see.");
  assert.equal(((await pg.query("select score from scores where id = $1", [await scoreIdOf(pg, a)])).rows[0] as { score: number }).score, 5);

  const similar = await addApp(pg, "LedgerLite", fields("Fintech / SaaS"));
  const unrelated = await addApp(pg, "GrainKind", fields("Agritech"));
  await scoreApplication(similar, { sql, client: m.client });
  assert.match(m.inputs.at(-1)!, /<past_corrections>[\s\S]*Why now: CAPilot \(Fintech, Pre-seed\) changed 3 to 5\. Reason: A CA who files GST/);
  const used = (await pg.query("select example_ids from scores where application_id = $1 and example_ids <> '{}'", [similar])).rows;
  assert.equal(used.length, 1); // shown only next to the criterion it was about

  await scoreApplication(unrelated, { sql, client: m.client });
  assert.doesNotMatch(m.inputs.at(-1)!, /past_corrections/);
  assert.deepEqual(await similarCorrections(sql, a, fields("Fintech")), []); // never its own application's corrections
});

test("a correction needs a reason and a score from 1 to 5; scoring again keeps what Riya changed", async () => {
  const { pg, sql } = await freshDb();
  const m = model();
  const a = await addApp(pg, "CAPilot", fields("Fintech"));
  await scoreApplication(a, { sql, client: m.client });
  const id = await scoreIdOf(pg, a);
  await assert.rejects(saveCorrection(sql, id, 4, "  "), /one-line reason/);
  await assert.rejects(saveCorrection(sql, id, 6, "x"), /1 to 5/);
  await assert.rejects(saveCorrection(sql, id, 3, "x"), /already the score/);
  await saveCorrection(sql, id, 4, "Better than it reads.");
  await scoreApplication(a, { sql, client: m.client });
  const row = (await pg.query("select score, model_score from scores where id = $1", [id])).rows[0] as { score: number; model_score: number };
  assert.deepEqual(row, { score: 4, model_score: 3 }); // her 4 stands, the model's 3 is kept
  assert.equal(((await pg.query("select count(*)::int n from corrections")).rows[0] as { n: number }).n, 1);
});

test("best matches win, not the newest: shared sector words first, then same stage, 3 per criterion", async () => {
  const { pg, sql } = await freshDb();
  const m = model();
  const old = await addApp(pg, "Old", fields("Fintech, lending", "Pre-seed"));
  const weak = await addApp(pg, "Weak", fields("Healthtech and fintech", "Seed"));
  await scoreApplication(old, { sql, client: m.client });
  await scoreApplication(weak, { sql, client: m.client });
  await saveCorrection(sql, await scoreIdOf(pg, old), 4, "old, strong match");
  for (let i = 0; i < 3; i++) {
    const x = await addApp(pg, `Newer${i}`, fields("Fintech", "Seed"));
    await scoreApplication(x, { sql, client: m.client });
    await saveCorrection(sql, await scoreIdOf(pg, x), 4, `newer ${i}`);
  }
  const got = await similarCorrections(sql, weak, fields("Fintech, lending", "Pre-seed"));
  assert.equal(got.length, 3);
  assert.equal(got[0].reason, "old, strong match"); // two shared words and the same stage, though it is the oldest
});

test("kill rule: when Riya keeps correcting scores that used past corrections, the scorer stops getting them", async () => {
  const { pg, sql } = await freshDb();
  const m = model();
  await pg.query("insert into settings (key, value) values ('learning_kill_min', '2'), ('learning_kill_rate', '50')");
  const first = await addApp(pg, "First", fields("Fintech"));
  await scoreApplication(first, { sql, client: m.client });
  await saveCorrection(sql, await scoreIdOf(pg, first), 5, "first lesson");
  assert.equal((await learningStatus(sql)).on, true); // nothing has used it yet

  for (const name of ["Second", "Third"]) {
    const a = await addApp(pg, name, fields("Fintech"));
    await scoreApplication(a, { sql, client: m.client });
    await saveCorrection(sql, await scoreIdOf(pg, a), 1, `${name} disagrees`); // corrected again after seeing the example
  }
  const status = await learningStatus(sql);
  assert.equal(status.on, false);
  assert.match(status.why, /corrected 2 of 2 scores/);

  const fourth = await addApp(pg, "Fourth", fields("Fintech"));
  await scoreApplication(fourth, { sql, client: m.client });
  assert.doesNotMatch(m.inputs.at(-1)!, /past_corrections/); // reverted: no examples
  await pg.query("update settings set value = '10' where key = 'learning_kill_min'"); // needing more evidence restores it
  assert.equal((await learningStatus(sql)).on, true);
  await pg.query("insert into settings (key, value) values ('learning_enabled', 'off')");
  assert.equal((await learningStatus(sql)).on, false);
});
