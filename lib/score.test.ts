import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { computeFlags } from "./flags";
import { checkPortfolio, parseOverlaps, portfolioList } from "./portfolio";
import { type Criterion, type Material, type Raw, checkSource, conflictsFor, finalise, pagesOf, parseScores, scoreAllPending, scoreApplication } from "./score";

async function freshDb() {
  const pg = new PGlite();
  for (const f of ["db/schema.sql", "db/seed.sql"])
    for (const s of readFileSync(f, "utf8").split(/;\s*$/m).map((x) => x.trim()).filter(Boolean)) await pg.query(s);
  const sql = async (s: TemplateStringsArray, ...v: unknown[]) =>
    (await pg.query(s[0] + v.map((_, i) => `$${i + 1}${s[i + 1]}`).join(""), v)).rows;
  return { pg, sql: sql as never };
}

const DECK = "[Deck page 1]\nWe turn GST filings into a one-click flow for CA firms.\n\n[Deck page 2]\nDhruv worked four years at a Pune CA firm before starting CAPilot.";
const FORM = "[Form page 1]\nTraction: 24 firms are paying us.";
const material = (findings: Material["findings"] = []): Material => ({ pages: pagesOf(DECK, FORM), findings });

const crit = (over: Partial<Criterion> = {}): Criterion => ({ id: 1, name: "Why now", definition: "d", status: "proposed, partners to confirm", decisive_fields: ["why_now"], ...over });
const raw = (over: Partial<Raw> = {}): Raw => ({
  criterion: "Why now", score: 4, source: "Deck page 1", evidence: "one-click flow for CA firms", reasoning: "Clear change.", gaps: [], ...over,
});
const ctx = (over: Record<string, unknown> = {}) => ({
  fields: { why_now: "GST e-invoicing mandate", founders: [{ name: "Dhruv Shah", role: null, past_roles: [] }], product: "x", market: "y", traction: "z" } as Record<string, unknown>,
  material: material(), cap: 2, deckForm: [] as { field: string; deck_says: string; form_says: string }[], ...over,
});

const fields = {
  founders: [{ name: "Dhruv Shah", role: "CEO", past_roles: ["CA, 4 years"] }],
  product: "GST filing assistant", market: "CA firms in India", why_now: null, traction: "24 firms",
  team_start_dates: [{ founder: "Dhruv Shah", started: "February 2026" }], full_time_status: "Not stated",
  sector: "Fintech", stage: "Pre-seed", prior_startup_experience: "None",
};

async function addExtracted(pg: PGlite, name = "CAPilot", f: Record<string, unknown> = fields, conflicts: unknown[] = []) {
  const r = await pg.query("insert into applications (company_name, deck_text, form_responses, status) values ($1,$2,$3::jsonb,'extracted') returning id",
    [name, DECK, JSON.stringify({ text: FORM })]);
  const id = (r.rows[0] as { id: number }).id;
  await pg.query("insert into extracted_fields (application_id, fields, conflicts) values ($1,$2::jsonb,$3::jsonb)", [id, JSON.stringify(f), JSON.stringify(conflicts)]);
  return id;
}

const goodScores = (over: Record<string, Partial<Raw>> = {}) => ({
  scores: [
    { criterion: "Why now", score: 4, source: "Deck page 1", evidence: "one-click flow for CA firms", reasoning: "r1", gaps: [], ...over["Why now"] },
    { criterion: "Founder-market fit", score: 4, source: "Deck page 2", evidence: "four years at a Pune CA firm", reasoning: "r2", gaps: [], ...over["Founder-market fit"] },
    { criterion: "Ability to build", score: 3, source: "Deck page 1", evidence: "GST filings into a one-click flow", reasoning: "r3", gaps: [], ...over["Ability to build"] },
    { criterion: "Team and commitment", score: 5, source: "Form page 1", evidence: "24 firms are paying us", reasoning: "r4", gaps: [], ...over["Team and commitment"] },
    { criterion: "Path to market", score: 3, source: "Form page 1", evidence: "24 firms are paying us", reasoning: "r5", gaps: [], ...over["Path to market"] },
  ],
});

function fakeModel(opts: { score?: (input: string) => unknown; portfolio?: unknown; failPortfolio?: boolean } = {}) {
  const seen = { score: 0, portfolio: 0, last: undefined as undefined | { contents: string } };
  const client = {
    models: {
      generateContent: async (req: { contents: string; config: { systemInstruction: string } }) => {
        const isPortfolio = /overlaps with companies/.test(req.config.systemInstruction);
        if (isPortfolio) {
          seen.portfolio++;
          if (opts.failPortfolio) throw new Error("quota used up");
        } else {
          seen.score++;
          seen.last = req;
        }
        const out = isPortfolio ? (opts.portfolio ?? { overlaps: [] }) : (opts.score ? opts.score(req.contents) : goodScores());
        return { text: typeof out === "string" ? out : JSON.stringify(out), candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5 } };
      },
    },
  };
  return { seen, client: client as never };
}

test("the seed has five criteria with decisive facts, and a public portfolio list to check against", async () => {
  const { pg } = await freshDb();
  const c = (await pg.query("select name, decisive_fields from criteria order by id")).rows as { name: string; decisive_fields: string[] }[];
  assert.deepEqual(c.map((x) => x.name), ["Why now", "Founder-market fit", "Ability to build", "Team and commitment", "Path to market"]);
  assert.deepEqual(c[3].decisive_fields, ["team_start_dates", "full_time_status"]);
  assert.ok(((await pg.query("select count(*)::int n from portfolio_companies")).rows[0] as { n: number }).n >= 60);
  assert.equal(((await pg.query("select value from settings where key = 'missing_evidence_cap'")).rows[0] as { value: string }).value, "2");
});

test("there is no total score: the scores table has no total column and a row has none", async () => {
  const { pg } = await freshDb();
  const cols = (await pg.query("select column_name from information_schema.columns where table_name = 'scores'")).rows as { column_name: string }[];
  assert.ok(!cols.some((c) => /total|overall|sum/i.test(c.column_name)));
  assert.ok(!Object.keys(finalise(crit(), raw(), ctx())).some((k) => /total|overall/i.test(k)));
});

test("a score is kept only when its source exists and the quote is really there", () => {
  const ok = finalise(crit(), raw(), ctx());
  assert.equal(ok.score, 4);
  assert.equal(ok.source, "Deck page 1");
  for (const bad of [
    raw({ evidence: "a quote that is nowhere in the deck" }),
    raw({ source: "Deck page 9" }),
    raw({ source: "somewhere" }),
    raw({ evidence: "" }),
    raw({ source: "https://nowhere.example" }),
  ]) {
    const r = finalise(crit(), bad, ctx());
    assert.equal(r.score, null, JSON.stringify(bad)); // a gap, never a low score
    assert.equal(r.model_score, 4); // what the model said is kept for the audit
    assert.match(r.gaps.join(" "), /without a source that could be checked/);
    assert.ok(r.source.length > 0); // a source string is never empty
    assert.equal(r.evidence, null);
  }
  assert.equal(checkSource(raw({ source: "Deck page 2", evidence: "FOUR  years at a pune CA firm" }), material()), null); // spacing and case do not matter
});

test("web sources must be a confirmed research finding and the quote must be in it", () => {
  const f = [{ kind: "founder", subject: "Dhruv Shah", claim: "Ran a CA practice", url: "https://news.example/a", quote: "Dhruv ran a CA practice in Pune", relation: "supports", application_says: null }];
  const m = material(f);
  assert.equal(checkSource(raw({ source: "https://news.example/a", evidence: "ran a CA practice in Pune" }), m), null);
  assert.match(checkSource(raw({ source: "https://news.example/a", evidence: "sold the company for a lot" }), m)!, /not in that research finding/);
  assert.match(checkSource(raw({ source: "https://news.example/zzz", evidence: "ran a CA practice in Pune" }), m)!, /not in the research/);
});

test("missing-evidence rule: a missing decisive fact caps the score, labelled; 0 turns it off; gaps are never capped", () => {
  const missing = { fields: { ...ctx().fields, why_now: null } };
  const capped = finalise(crit(), raw({ score: 4 }), ctx(missing));
  assert.equal(capped.score, 2);
  assert.equal(capped.model_score, 4);
  assert.equal(capped.capped, "capped from 4 to 2: evidence missing (why now)");
  assert.ok(capped.gaps.includes("Not stated in the application: why now."));
  assert.equal(finalise(crit(), raw({ score: 4 }), ctx({ ...missing, cap: 0 })).score, 4); // gap only
  assert.equal(finalise(crit(), raw({ score: 2 }), ctx(missing)).capped, null); // already at the cap
  assert.equal(finalise(crit(), raw({ score: 1 }), ctx(missing)).score, 1); // the cap never raises
  const gap = finalise(crit(), raw({ score: null, source: "", evidence: "", gaps: ["No dated trigger"] }), ctx(missing));
  assert.equal(gap.score, null);
  assert.equal(gap.capped, null);
  assert.ok(gap.gaps.includes("No dated trigger"));
  assert.equal(finalise(crit(), raw({ score: 4 }), ctx()).capped, null); // fact present, no cap
});

test("odd model scores and skipped criteria become gaps", () => {
  assert.equal(finalise(crit(), raw({ score: 7 }), ctx()).score, null);
  assert.equal(finalise(crit(), raw({ score: 3.5 }), ctx()).score, null);
  assert.equal(finalise(crit(), raw({ score: "4" }), ctx()).score, null);
  const skipped = finalise(crit(), undefined, ctx());
  assert.equal(skipped.score, null);
  assert.match(skipped.gaps.join(" "), /no answer for this criterion/);
});

test("conflicts come from code: deck against form, and web research against the application", () => {
  const deckForm = [{ field: "traction", deck_says: "31 firms", form_says: "24 firms" }];
  const path = crit({ name: "Path to market", decisive_fields: ["market", "traction"] });
  assert.match(conflictsFor(path, deckForm, [])!, /traction: the deck says "31 firms", the form says "24 firms"/);
  assert.equal(conflictsFor(crit(), deckForm, []), null); // not related to this criterion
  const web = [{ kind: "founder", subject: "A", claim: "Previously founded Foo", url: "u", quote: "q", relation: "contradicts", application_says: "No prior startup" }];
  assert.match(conflictsFor(crit({ decisive_fields: ["founders"] }), [], web)!, /application says "No prior startup"/);
  assert.equal(conflictsFor(path, [], web), null);
});

test("parsing and page lookup", () => {
  assert.equal(pagesOf(DECK, FORM).get("deck 2")!.includes("Pune"), true);
  assert.ok(pagesOf(DECK, FORM).has("form 1"));
  assert.equal(parseScores("```json\n" + JSON.stringify(goodScores()) + "\n```").length, 5);
  assert.throws(() => parseScores("no"), /not valid JSON/);
  assert.throws(() => parseScores("{}"), /no "scores"/);
});

test("scoring an application stores five rows with sources, gaps and a cap, and no total", async () => {
  const { pg, sql } = await freshDb();
  const id = await addExtracted(pg, "CAPilot", fields, [{ field: "traction", deck_says: "31 firms", form_says: "24 firms" }]);
  const { client, seen } = fakeModel();
  const r = await scoreApplication(id, { client, sql });
  assert.deepEqual(r, { ok: true, scored: 5, gaps: 0, capped: 2 }); // why_now and full_time_status are not stated
  const rows = (await pg.query("select c.name, s.score, s.model_score, s.source, s.capped, s.conflict, s.gaps, s.basis from scores s join criteria c on c.id = s.criterion_id order by c.id")).rows as
    { name: string; score: number; model_score: number; source: string; capped: string | null; conflict: string | null; gaps: string[]; basis: string }[];
  assert.deepEqual(rows.map((x) => x.score), [2, 4, 3, 2, 3]);
  assert.equal(rows[0].model_score, 4);
  assert.match(rows[0].capped!, /capped from 4 to 2/);
  assert.match(rows[3].capped!, /full time status/);
  assert.match(rows[4].conflict!, /31 firms/);
  assert.ok(rows.every((x) => x.source.length > 0 && /written criteria/.test(x.basis)));
  assert.equal(((await pg.query("select status from applications")).rows[0] as { status: string }).status, "scored");
  assert.match(seen.last!.contents, /<criteria>/);
  assert.match(seen.last!.contents, /Path to market/);
  const log = (await pg.query("select reason from decision_log where step = 'scoring' and decision like 'scored%'")).rows[0] as { reason: string };
  assert.match(log.reason, /no total score/);
});

test("scoring again replaces the rows in place, so corrections can keep pointing at them", async () => {
  const { pg, sql } = await freshDb();
  const id = await addExtracted(pg);
  await scoreApplication(id, { client: fakeModel().client, sql });
  const before = (await pg.query("select id from scores order by id")).rows.map((x) => (x as { id: number }).id);
  await scoreApplication(id, { client: fakeModel({ score: () => goodScores({ "Founder-market fit": { score: 5 } }) }).client, sql });
  const after = (await pg.query("select s.id, s.score from scores s join criteria c on c.id = s.criterion_id order by s.id")).rows as { id: number; score: number }[];
  assert.deepEqual(after.map((x) => x.id), before);
  assert.equal(after[1].score, 5);
});

test("bad JSON is asked twice and fails without touching earlier scores; unread applications are refused", async () => {
  const { pg, sql } = await freshDb();
  const id = await addExtracted(pg);
  await scoreApplication(id, { client: fakeModel().client, sql });
  const bad = fakeModel({ score: () => "garbage" });
  const r = await scoreApplication(id, { client: bad.client, sql });
  assert.equal(r.ok, false);
  assert.equal(bad.seen.score, 2);
  assert.match(((await pg.query("select score_note from applications")).rows[0] as { score_note: string }).score_note, /asked twice/);
  assert.equal(((await pg.query("select count(*)::int n from scores")).rows[0] as { n: number }).n, 5);
  const raw = await pg.query("insert into applications (company_name, deck_text) values ('Raw','x') returning id");
  assert.match((await scoreApplication((raw.rows[0] as { id: number }).id, { client: bad.client, sql })).error!, /Read the application first/);
});

test("a missing criterion in the model's answer is stored as a gap", async () => {
  const { pg, sql } = await freshDb();
  const id = await addExtracted(pg);
  const partial = goodScores();
  partial.scores.pop();
  await scoreApplication(id, { client: fakeModel({ score: () => partial }).client, sql });
  const last = (await pg.query("select s.score, s.gaps from scores s join criteria c on c.id = s.criterion_id where c.name = 'Path to market'")).rows[0] as { score: number | null; gaps: string[] };
  assert.equal(last.score, null);
  assert.match(last.gaps.join(" "), /no answer for this criterion/);
});

test("only confirmed research reaches the model, and emails never do", async () => {
  const { pg, sql } = await freshDb();
  const id = await addExtracted(pg);
  const add = (identity: string, claim: string) =>
    pg.query("insert into research_findings (application_id, run_id, kind, subject, claim, url, quote, identity, relation) values ($1,'r','founder','Dhruv Shah',$2,'https://news.example/a','a quote long enough',$3,'adds')", [id, claim, identity]);
  await add("confirmed", "Confirmed claim");
  await add("unclear", "Unclear claim");
  await pg.query("update applications set deck_text = deck_text || ' Write to dhruv@capilot.example' where id = $1", [id]);
  const { client, seen } = fakeModel();
  await scoreApplication(id, { client, sql });
  assert.match(seen.last!.contents, /Confirmed claim/);
  assert.doesNotMatch(seen.last!.contents, /Unclear claim/);
  assert.doesNotMatch(seen.last!.contents, /dhruv@capilot\.example/);
});

test("score all only touches applications that were read and not yet scored", async () => {
  const { pg, sql } = await freshDb();
  await addExtracted(pg, "A");
  await addExtracted(pg, "B");
  await pg.query("insert into applications (company_name, deck_text, status) values ('New','x','new')");
  assert.deepEqual(await scoreAllPending({ client: fakeModel().client, sql }), { done: 2, failed: 0 });
  assert.deepEqual(await scoreAllPending({ client: fakeModel().client, sql }), { done: 0, failed: 0 });
});

test("flags: out-of-scope and deeptech match whole words only", () => {
  const web3 = computeFlags({ sector: "Web3 gaming", product: "x", market: "y" }, "Web3, crypto", "robotics, space");
  assert.equal(web3[0].kind, "out_of_scope");
  assert.match(web3[0].text, /not rejected/);
  assert.equal(computeFlags({ sector: "SaaS", product: "A workspace tool", market: null }, "Web3", "space").length, 0); // "workspace" is not "space"
  assert.equal(computeFlags({ sector: "Space tech", product: "x", market: null }, "Web3", "robotics, space")[0].kind, "deeptech");
  assert.equal(computeFlags({ sector: null, product: null, market: null }, "Web3", "space").length, 0);
});

test("portfolio list merges the public list and funded past deals, preferring a real description", async () => {
  const { pg, sql } = await freshDb();
  const d = await pg.query("insert into past_deals (company_name, original_application) values ('Wint Wealth','Bond platform for retail investors') returning id");
  await pg.query("insert into partner_decisions (past_deal_id, decision) values ($1,'funded')", [(d.rows[0] as { id: number }).id]);
  const p = await pg.query("insert into past_deals (company_name, original_application) values ('Petalry','Flowers') returning id");
  await pg.query("insert into partner_decisions (past_deal_id, decision) values ($1,'passed')", [(p.rows[0] as { id: number }).id]);
  const list = await portfolioList(sql);
  assert.equal(list.find((x) => x.name === "Wint Wealth")!.description, "Bond platform for retail investors");
  assert.ok(!list.some((x) => x.name === "Petalry")); // a pass is not a portfolio company
  assert.equal(list.filter((x) => /^wint wealth$/i.test(x.name)).length, 1);
});

test("portfolio check: overlap is flagged for Riya, invented companies are dropped, same name is caught by code", async () => {
  assert.deepEqual(parseOverlaps(JSON.stringify({ overlaps: [{ company: "volt", level: "likely", why: "Same loans" }, { company: "Invented Co", level: "likely", why: "x" }, { company: "Volt", level: "possible", why: "dup" }] }), ["Volt", "Piiko"]),
    [{ company: "Volt", level: "likely", why: "Same loans" }]);
  const { pg, sql } = await freshDb();
  const id = await addExtracted(pg, "Volt", { ...fields, product: "Loans against mutual funds" });
  const m = fakeModel({ portfolio: { overlaps: [{ company: "MoMoney", level: "possible", why: "Both are investing apps for young Indians." }, { company: "Not In List", level: "likely", why: "x" }] } });
  const r = await checkPortfolio(id, { client: m.client, sql });
  assert.equal(r.overlaps, 2);
  const rows = (await pg.query("select company, level from portfolio_overlaps order by company")).rows as { company: string; level: string }[];
  assert.deepEqual(rows, [{ company: "MoMoney", level: "possible" }, { company: "Volt", level: "likely" }]);
  assert.equal(m.seen.portfolio, 1);
});

test("if the portfolio model fails, the same-name check still runs and the scores are kept", async () => {
  const { pg, sql } = await freshDb();
  const id = await addExtracted(pg, "Volt");
  const r = await scoreApplication(id, { client: fakeModel({ failPortfolio: true }).client, sql });
  assert.equal(r.ok, true);
  assert.equal(((await pg.query("select count(*)::int n from scores")).rows[0] as { n: number }).n, 5);
  assert.equal(((await pg.query("select count(*)::int n from portfolio_overlaps")).rows[0] as { n: number }).n, 1);
  assert.match(((await pg.query("select score_note from applications")).rows[0] as { score_note: string }).score_note, /partly failed/);
  const other = await addExtracted(pg, "Totally New Co");
  const r2 = await scoreApplication(other, { client: fakeModel({ failPortfolio: true }).client, sql });
  assert.equal(r2.ok, true);
  assert.match(((await pg.query("select score_note from applications where id = $1", [other])).rows[0] as { score_note: string }).score_note, /portfolio check failed/);
});

test("the ranking is by criteria counts, never a total, stable, and a gap is not counted as low", async () => {
  const { pg, sql } = await freshDb();
  const a = await addExtracted(pg, "A");
  const b = await addExtracted(pg, "B");
  const c = await addExtracted(pg, "C");
  await addExtracted(pg, "Unscored");
  const set = async (id: number, scores: (number | null)[]) => {
    const crits = (await pg.query("select id from criteria order by id")).rows as { id: number }[];
    for (const [i, s] of scores.entries())
      await pg.query("insert into scores (application_id, criterion_id, score, source) values ($1,$2,$3,'Deck page 1')", [id, crits[i].id, s]);
    await pg.query("update applications set status = 'scored' where id = $1", [id]);
  };
  await set(a, [5, 5, 2, 2, 2]); // two at 3+, two at 4+ ... a high total but only 2 criteria at 3+
  await set(b, [3, 3, 3, null, null]); // three at 3+, two gaps
  await set(c, [3, 3, 3, 3, 2]); // four at 3+
  const { rankedApplications } = await import("./rank");
  const first = await rankedApplications(sql);
  assert.deepEqual(first.map((r) => r.company_name), ["C", "B", "A", "Unscored"]);
  assert.deepEqual([first[1].c3, first[1].gaps, first[1].n], [3, 2, 5]);
  assert.deepEqual(first.map((r) => r.id), (await rankedApplications(sql)).map((r) => r.id)); // same order on a second run
  assert.ok(!Object.keys(first[0]).some((k) => /total|overall/i.test(k)));
});
