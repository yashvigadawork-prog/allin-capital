import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { editReply, handleReply, parseReply, sendReply, tickReply } from "./replies";

const LINK = "https://cal.com/riya/intro";
async function freshDb() {
  const pg = new PGlite();
  for (const f of ["db/schema.sql", "db/seed.sql"])
    for (const s of readFileSync(f, "utf8").split(/;\s*$/m).map((x) => x.trim()).filter(Boolean)) await pg.query(s);
  const sql = (async (s: TemplateStringsArray, ...v: unknown[]) => (await pg.query(s[0] + v.map((_, i) => `$${i + 1}${s[i + 1]}`).join(""), v)).rows) as never;
  const id = ((await pg.query("insert into applications (company_name) values ('Acme') returning id")).rows[0] as { id: number }).id;
  await pg.query("insert into extracted_fields (application_id, fields, empty_fields) values ($1,$2,'{}')", [id, JSON.stringify({ product: "Software for CA firms", traction: null })]);
  return { pg, sql, id };
}
const answer = (o: object) => ({ models: { generateContent: async () => ({ text: JSON.stringify(o), candidates: [{ finishReason: "STOP" }], usageMetadata: {} }) } } as never);
const err = (r: unknown) => (r as { error: string }).error;

test("each class is handled as the spec says, and checkable claims are checked by code", () => {
  const reply = "Thanks! Could we do Friday morning instead? Also what is your cheque size?";
  const book = parseReply(JSON.stringify({ class: "wants to book", basis: "Thanks!", draft: `Great.\n${LINK}\nRiya` }), reply, LINK);
  assert.equal(book.cls, "wants to book");
  assert.ok(book.body);
  assert.throws(() => parseReply(JSON.stringify({ class: "wants to book", basis: "Thanks!", draft: "No link" }), reply, LINK), /booking link/);
  const time = parseReply(JSON.stringify({ class: "proposes another time", basis: "Could we do Friday morning instead?", requested_time: "Friday morning", draft: `Try ${LINK}` }), reply, LINK);
  assert.match(time.flags[0], /Friday morning/);
  const q = parseReply(JSON.stringify({ class: "asks a question", basis: "what is your cheque size?", draft: "Our cheque size is [RIYA: cheque size]." }), reply, LINK);
  assert.match(q.flags.join(), /Fill in 1 gap/);
  for (const w of ["Our cheque size is [amount].", "Our cheque size is TBD.", "Our cheque size is [INSERT CHEQUE SIZE]."])
    assert.match(parseReply(JSON.stringify({ class: "asks a question", basis: "what is your cheque size?", draft: w }), reply, LINK).flags.join(), /Fill in 1 gap/);
  for (const c of ["declines", "unclear"]) {
    const x = parseReply(JSON.stringify({ class: c, basis: "Thanks!", draft: "should be dropped" }), reply, LINK);
    assert.equal(x.body, null);
  }
  assert.match(parseReply(JSON.stringify({ class: "declines", basis: "invented sentence", draft: null }), reply, LINK).flags[0], /not in the reply/);
  assert.throws(() => parseReply(JSON.stringify({ class: "maybe", basis: "x" }), reply, LINK), /five/);
});

test("a reply is stored and logged; a model failure becomes unclear, not a crash; nothing sends unticked or with a gap", async () => {
  process.env.CAL_BOOKING_LINK = LINK;
  process.env.EMAIL_TO = "test@example.com";
  delete process.env.TEST_MODE;
  const { pg, sql, id } = await freshDb();
  const sent: string[] = [];
  const send = async (m: { to: string }) => void sent.push(m.to);

  const q = await handleReply(id, "What is your cheque size?", { sql, client: answer({ class: "asks a question", basis: "What is your cheque size?", requested_time: null, draft: "We back pre-seed. Cheque size: [RIYA: cheque size].\nRiya" }) });
  assert.match(err(await sendReply(q.id, { sql, send })), /Nothing is sent/);
  await assert.rejects(tickReply(sql, q.id), /placeholder/);
  await editReply(sql, q.id, "We back pre-seed. Cheque size: 1 to 2 crore.\nRiya");
  await tickReply(sql, q.id);
  assert.deepEqual(await sendReply(q.id, { sql, send }), { sentTo: "test@example.com" });
  assert.match(err(await sendReply(q.id, { sql, send })), /already sent/);
  assert.equal(sent.length, 1);

  const d = await handleReply(id, "No thanks, we are not raising.", { sql, client: answer({ class: "declines", basis: "we are not raising.", draft: null }) });
  await assert.rejects(tickReply(sql, d.id), /no draft/);
  await handleReply(id, "hello", { sql, client: answer({ class: "banana" }) });
  const rows = (await pg.query("select classification, draft_body from founder_replies order by id")).rows as { classification: string; draft_body: string | null }[];
  assert.deepEqual(rows.map((r) => r.classification), ["asks a question", "declines", "unclear"]);
  assert.equal(rows[2].draft_body, null);
  assert.equal(((await pg.query("select count(*)::int n from decision_log where step = 'reply-classify' and decision in ('asks a question','declines','unclear')")).rows[0] as { n: number }).n, 3);
});
