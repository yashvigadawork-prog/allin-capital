import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { agrees, keepFacts, parseVerdict, recommend, runBacktest } from "./backtest";

async function freshDb() {
  const pg = new PGlite();
  for (const f of ["db/schema.sql", "db/seed.sql"])
    for (const s of readFileSync(f, "utf8").split(/;\s*$/m).map((x) => x.trim()).filter(Boolean)) await pg.query(s);
  const sql = (async (s: TemplateStringsArray, ...v: unknown[]) => (await pg.query(s[0] + v.map((_, i) => `$${i + 1}${s[i + 1]}`).join(""), v)).rows) as never;
  return { pg, sql };
}

const rows = (...scores: (number | null)[]) => scores.map((score) => ({ score }));

test("the recommendation: advance needs 3 strong criteria; 3 or more unknown means no recommendation", () => {
  assert.equal(recommend(rows(4, 3, 3, 2, 1)).result, "advance");
  assert.equal(recommend(rows(4, 3, 2, 2, 1)).result, "pass for now");
  assert.equal(recommend(rows(4, 4, null, null, null)).result, "insufficient data"); // two strong scores do not make a recommendation
  assert.equal(recommend(rows(5, 5, 5, null, null)).result, "advance"); // two gaps are still enough to judge
  assert.deepEqual(recommend(rows(4, 3, null, 1, 2)), { result: "pass for now", strong: 2, gaps: 1 });
});

test("agreement: advance fits funded, pass fits passed, no recommendation is neither", () => {
  assert.equal(agrees("advance", "funded"), true);
  assert.equal(agrees("pass for now", "passed"), true);
  assert.equal(agrees("advance", "passed"), false);
  assert.equal(agrees("pass for now", "funded"), false);
  assert.equal(agrees("insufficient data", "funded"), null);
});

test("a verdict must be one of the three allowed, otherwise it is unclear", () => {
  assert.equal(parseVerdict('{"verdict":"we were wrong","note":"n"}').verdict, "we were wrong");
  assert.equal(parseVerdict('{"verdict":"the app was wrong","note":"n"}').verdict, "the app was wrong");
  assert.equal(parseVerdict('{"verdict":"definitely fine","note":"n"}').verdict, "unclear");
  assert.equal(parseVerdict("not json").verdict, "unclear");
});

test("the backtest code never reads the memo column", () => {
  assert.doesNotMatch(readFileSync("lib/backtest.ts", "utf8"), /partner_memo/);
});

test("a run scores from sector and description only, judges disagreements afterwards, and keeps no-recommendation apart", async () => {
  const { pg, sql } = await freshDb();
  const deals: [string, string, string, string, string][] = [
    ["Alpha Co", "Fintech", "Seed round", "We help CA firms file returns faster with software.", "funded"],
    ["Bravo Co", "Consumer", "Pre-seed", "A snack brand selling in marketplaces across cities.", "passed"],
    ["Charlie Co", "Deeptech", "Pre-seed", "Hardware for warehouses.", "funded"],
  ];
  for (const [name, sector, stage, what, decision] of deals) {
    const id = ((await pg.query("insert into past_deals (company_name, sector, stage, original_application, partner_memo) values ($1,$2,$3,$4,'SECRET MEMO TEXT') returning id", [name, sector, stage, what])).rows[0] as { id: number }).id;
    await pg.query("insert into partner_decisions (past_deal_id, decision, partner_note) values ($1,$2,$3)", [id, decision, `reason for ${name} PARTNER NOTE`]);
  }
  const seen: string[] = [];
  const client = { models: { generateContent: async (req: { contents: string; config: { systemInstruction: string } }) => {
    seen.push(req.contents);
    if (/review a backtest/.test(req.config.systemInstruction))
      return { text: JSON.stringify({ verdict: "we were wrong", note: "Their reason is thin." }), candidates: [{ finishReason: "STOP" }], usageMetadata: {} };
    const hardware = /Hardware for warehouses/.test(req.contents);
    const quote = /CA firms/.test(req.contents) ? "CA firms file returns faster" : "snack brand selling in marketplaces";
    const names = ["Why now", "Founder-market fit", "Ability to build", "Team and commitment", "Path to market"];
    return {
      text: JSON.stringify({ scores: names.map((criterion, i) => hardware
        ? { criterion, score: null, source: null, evidence: null, reasoning: "nothing stated", gaps: ["not stated"] }
        : { criterion, score: i < 3 ? 4 : null, source: "Deck page 1", evidence: quote, reasoning: "fits", gaps: [] }) }),
      candidates: [{ finishReason: "STOP" }], usageMetadata: {},
    };
  } } };

  const r = await runBacktest({ sql, client: client as never }, 1);
  assert.deepEqual(r, { run: 1, scored: 3, failed: 0 });

  const out = (await pg.query("select p.company_name, b.result, b.agrees, b.verdict from backtest_results b join past_deals p on p.id = b.past_deal_id order by p.id")).rows;
  assert.deepEqual(out, [
    { company_name: "Alpha Co", result: "advance", agrees: true, verdict: null },
    { company_name: "Bravo Co", result: "advance", agrees: false, verdict: "we were wrong" }, // advanced a deal the partners passed
    { company_name: "Charlie Co", result: "insufficient data", agrees: null, verdict: null },
  ]);

  const scoring = seen.filter((s) => s.includes("<criteria>"));
  assert.equal(scoring.length, 3);
  for (const s of scoring) assert.doesNotMatch(s, /SECRET MEMO|PARTNER NOTE|Alpha Co|Bravo Co|Charlie Co|Seed round|Pre-seed/); // no memo, note, name or stage
  const verdictInputs = seen.filter((s) => s.includes("<partner_reason>"));
  assert.equal(verdictInputs.length, 1); // only the one disagreement
  assert.match(verdictInputs[0], /reason for Bravo Co PARTNER NOTE/);

  await runBacktest({ sql, client: client as never }, 1);
  assert.equal(((await pg.query("select max(run_id)::int n from backtest_results")).rows[0] as { n: number }).n, 2); // a second run is kept beside the first
});

test("facts are kept only when the quote is in the founder section and they carry no sign of the decision", () => {
  const section = "Two founders. One spent six years at a logistics firm running a warehouse. We were impressed and decided to invest. They have worked together for three years.";
  const ans = JSON.stringify({ facts: [
    { fact: "A founder spent six years at a logistics firm running a warehouse.", quote: "spent six years at a logistics firm running a warehouse" },
    { fact: "The founders have worked together for three years.", quote: "worked together for three years" },
    { fact: "The founders ran a unicorn.", quote: "ran a unicorn before" }, // quote is not in the section
    { fact: "The fund decided to invest.", quote: "decided to invest" }, // gives the decision away
    { fact: "A founder spent six years at a logistics firm running a warehouse.", quote: "spent six years at a logistics firm running a warehouse" }, // repeat
  ] });
  assert.deepEqual(keepFacts(ans, section), ["A founder spent six years at a logistics firm running a warehouse.", "The founders have worked together for three years."]);
  assert.deepEqual(keepFacts("not json", section), []);
});

test("facts mode gives the scorer the founder facts as a second page, never the partners' reasons", async () => {
  const { pg, sql } = await freshDb();
  const id = ((await pg.query("insert into past_deals (company_name, sector, original_application, partner_memo, founder_text) values ('Delta Co','Fintech','We help CA firms file returns.','SECRET MEMO TEXT','A founder worked six years at a CA firm. Very strong, we loved them.') returning id")).rows[0] as { id: number }).id;
  await pg.query("insert into partner_decisions (past_deal_id, decision, partner_note) values ($1,'funded','WHY WE INVESTED')", [id]);
  const seen: string[] = [];
  const client = { models: { generateContent: async (req: { contents: string; config: { systemInstruction: string } }) => {
    seen.push(req.contents);
    if (/copy plain facts/.test(req.config.systemInstruction))
      return { text: JSON.stringify({ facts: [{ fact: "A founder worked six years at a CA firm.", quote: "worked six years at a CA firm" }, { fact: "We loved them.", quote: "we loved them" }] }), candidates: [{ finishReason: "STOP" }], usageMetadata: {} };
    const names = ["Why now", "Founder-market fit", "Ability to build", "Team and commitment", "Path to market"];
    return { text: JSON.stringify({ scores: names.map((criterion) => ({ criterion, score: 4, source: "Deck page 2", evidence: "worked six years at a CA firm", reasoning: "r", gaps: [] })) }), candidates: [{ finishReason: "STOP" }], usageMetadata: {} };
  } } };
  await runBacktest({ sql, client: client as never }, 1, "facts");
  const scoring = seen.find((s) => s.includes("<criteria>"))!;
  assert.match(scoring, /\[Deck page 2\][\s\S]*- A founder worked six years at a CA firm\./);
  assert.doesNotMatch(scoring, /SECRET MEMO|WHY WE INVESTED|loved|Delta Co/);
  const row = (await pg.query("select mode, result, agrees from backtest_results")).rows[0];
  assert.deepEqual(row, { mode: "facts", result: "advance", agrees: true });
});
