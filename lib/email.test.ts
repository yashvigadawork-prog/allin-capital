import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { draftIntro, parseCheck, parseDraft, sendIntro, tickReviewed } from "./email";

async function freshDb() {
  const pg = new PGlite();
  for (const f of ["db/schema.sql", "db/seed.sql"])
    for (const s of readFileSync(f, "utf8").split(/;\s*$/m).map((x) => x.trim()).filter(Boolean)) await pg.query(s);
  const sql = (async (s: TemplateStringsArray, ...v: unknown[]) => (await pg.query(s[0] + v.map((_, i) => `$${i + 1}${s[i + 1]}`).join(""), v)).rows) as never;
  return { pg, sql };
}

const LINK = "https://cal.com/riya/intro";
async function app(pg: PGlite, name: string, scores: (number | null)[]) {
  const id = ((await pg.query("insert into applications (company_name) values ($1) returning id", [name])).rows[0] as { id: number }).id;
  await pg.query("insert into extracted_fields (application_id, fields, empty_fields) values ($1, $2, '{}')", [id, JSON.stringify({ product: "Software for CA firms", traction: null })]);
  const crit = (await pg.query("select id from criteria order by id")).rows as { id: number }[];
  for (const [i, s] of scores.entries()) await pg.query("insert into scores (application_id, criterion_id, score, source) values ($1,$2,$3,'Deck page 1')", [id, crit[i].id, s]);
  return id;
}

const client = (problems: string[], models: string[] = []) => ({ models: { generateContent: async (req: { model: string; config: { systemInstruction: string } }) => {
  models.push(req.model);
  const text = /You check a draft/.test(req.config.systemInstruction)
    ? JSON.stringify({ problems })
    : JSON.stringify({ subject: "Intro call", body: `Hi, we liked your software for CA firms.\n${LINK}\nRiya` });
  return { text, candidates: [{ finishReason: "STOP" }], usageMetadata: {} };
} } } as never);

test("parsers: the draft must hold the link, and an unreadable check is a block", () => {
  assert.throws(() => parseDraft('{"subject":"s","body":"no link here"}', LINK), /booking link/);
  assert.deepEqual(parseDraft(`{"subject":"s","body":"see ${LINK}"}`, LINK), { subject: "s", body: `see ${LINK}` });
  assert.deepEqual(parseCheck('{"problems":[]}'), []);
  assert.equal(parseCheck("garbage").length, 1);
});

test("only an advance-to-call application gets a draft; drafter and checker are different models", async () => {
  process.env.CAL_BOOKING_LINK = LINK;
  const { pg, sql } = await freshDb();
  const no = await app(pg, "Weak Co", [2, 2, 3, 1, 1]);
  assert.match(((await draftIntro(no, { sql, client: client([]) })) as { error: string }).error, /not recommended/);
  const id = await app(pg, "Acme", [4, 3, 3, 2, null]);
  const models: string[] = [];
  assert.ok("proposalId" in (await draftIntro(id, { sql, client: client([], models) })));
  assert.equal(models.length, 2);
  assert.notEqual(models[0], models[1]);
  const row = (await pg.query("select check_ok, drafted_by, checked_by from call_proposals")).rows[0] as { check_ok: boolean; drafted_by: string; checked_by: string };
  assert.equal(row.check_ok, true);
  assert.notEqual(row.drafted_by, row.checked_by);
});

test("unticked drafts cannot be sent; flagged drafts cannot be ticked; the mail goes only to EMAIL_TO", async () => {
  process.env.CAL_BOOKING_LINK = LINK;
  process.env.EMAIL_TO = "test@example.com";
  delete process.env.TEST_MODE;
  const { pg, sql } = await freshDb();
  const id = await app(pg, "Acme", [4, 3, 3, 2, 1]);
  const sent: { to: string; subject: string }[] = [];
  const send = async (m: { to: string; subject: string; text: string }) => void sent.push(m);
  const err = (r: unknown) => (r as { error: string }).error;

  const bad = (await draftIntro(id, { sql, client: client(["Invented: 'raised $5M'"]) })) as { proposalId: number };
  await assert.rejects(tickReviewed(sql, bad.proposalId), /checker found problems/);
  assert.match(err(await sendIntro(bad.proposalId, { sql, send })), /Nothing is sent/);

  const ok = (await draftIntro(id, { sql, client: client([]) })) as { proposalId: number };
  assert.match(err(await sendIntro(ok.proposalId, { sql, send })), /Nothing is sent/); // clean check, but no tick
  assert.equal(sent.length, 0);
  await tickReviewed(sql, ok.proposalId);
  assert.deepEqual(await sendIntro(ok.proposalId, { sql, send }), { sentTo: "test@example.com" });
  assert.equal(sent.length, 1);
  assert.match(err(await sendIntro(ok.proposalId, { sql, send })), /already sent/); // never twice
  assert.equal(sent.length, 1);
  assert.equal(((await pg.query("select count(*)::int n from decision_log where step = 'intro-send' and decision = 'email sent'")).rows[0] as { n: number }).n, 1);

  process.env.TEST_MODE = "off";
  const again = (await draftIntro(id, { sql, client: client([]) })) as { proposalId: number };
  await tickReviewed(sql, again.proposalId);
  assert.match(err(await sendIntro(again.proposalId, { sql, send })), /Live sending is not built/);
  delete process.env.TEST_MODE;
});
