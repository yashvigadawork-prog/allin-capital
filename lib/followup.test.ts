import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { bookingLink, bookingUrl, draftFollowup, followupDue, sendFollowup, tickFollowup } from "./followup";

const LINK = "https://cal.com/riya/intro";
async function freshDb() {
  const pg = new PGlite();
  for (const f of ["db/schema.sql", "db/seed.sql"])
    for (const s of readFileSync(f, "utf8").split(/;\s*$/m).map((x) => x.trim()).filter(Boolean)) await pg.query(s);
  const sql = (async (s: TemplateStringsArray, ...v: unknown[]) => (await pg.query(s[0] + v.map((_, i) => `$${i + 1}${s[i + 1]}`).join(""), v)).rows) as never;
  const id = ((await pg.query("insert into applications (company_name) values ('Acme') returning id")).rows[0] as { id: number }).id;
  await pg.query("insert into extracted_fields (application_id, fields, empty_fields) values ($1,$2,'{}')", [id, JSON.stringify({ founders: [{ name: "Dhruv Shah", role: "CEO", past_roles: [] }] })]);
  const crit = (await pg.query("select id from criteria order by id")).rows as { id: number }[];
  for (const [i, s] of [4, 3, 3, 2, 1].entries()) await pg.query("insert into scores (application_id, criterion_id, score, source) values ($1,$2,$3,'Deck page 1')", [id, crit[i].id, s]);
  return { pg, sql, id };
}
const client = { models: { generateContent: async () => ({ text: JSON.stringify({ body: `Just following up.\n${LINK}\nRiya, All In Capital` }), candidates: [{ finishReason: "STOP" }], usageMetadata: {} }) } } as never;
const err = (r: unknown) => (r as { error: string }).error;

test("the booking link carries name and email", () => {
  const u = new URL(bookingUrl(LINK, "Dhruv Shah", "t@example.com"));
  assert.equal(u.searchParams.get("name"), "Dhruv Shah");
  assert.equal(u.searchParams.get("email"), "t@example.com");
});

test("one follow-up, only with no reply and after the wait; ticked before sending; never a second", async () => {
  process.env.CAL_BOOKING_LINK = LINK;
  process.env.EMAIL_TO = "test@example.com";
  delete process.env.TEST_MODE;
  const { pg, sql, id } = await freshDb();
  assert.match(err(await draftFollowup(id, { sql, client })), /No follow-up is due/); // no intro sent yet
  await pg.query("insert into call_proposals (application_id, subject, body, check_ok, reviewed_by_human, sent_at) values ($1,'Intro','b',true,true,now())", [id]);
  await pg.query("insert into settings (key, value) values ('followup_days','3') on conflict (key) do update set value = '3'");
  assert.equal(await followupDue(sql, id), null); // sent just now, waiting 3 days
  await pg.query("update settings set value = '0' where key = 'followup_days'");
  assert.ok(await followupDue(sql, id));

  const sent: string[] = [];
  const send = async (m: { to: string }) => void sent.push(m.to);
  const d = (await draftFollowup(id, { sql, client })) as { id: number };
  assert.match(err(await sendFollowup(d.id, { sql, send })), /Nothing is sent/);
  await tickFollowup(sql, d.id);
  assert.deepEqual(await sendFollowup(d.id, { sql, send }), { sentTo: "test@example.com" });
  assert.equal(sent.length, 1);
  assert.match(err(await draftFollowup(id, { sql, client })), /No follow-up is due/); // never a second

  const two = await freshDb();
  await two.pg.query("insert into call_proposals (application_id, subject, body, check_ok, reviewed_by_human, sent_at) values ($1,'Intro','b',true,true,now())", [two.id]);
  await two.pg.query("insert into founder_replies (application_id, reply_text, classification) values ($1,'hi','unclear')", [two.id]);
  assert.equal(await followupDue(two.sql, two.id), null); // a reply stops the follow-up
});

test("the booking link shows only after the tick and for an advance recommendation, with the founder's name", async () => {
  process.env.CAL_BOOKING_LINK = LINK;
  process.env.EMAIL_TO = "test@example.com";
  const { pg, sql, id } = await freshDb();
  assert.equal(await bookingLink(sql, id), null);
  await pg.query("insert into call_proposals (application_id, subject, body, check_ok, reviewed_by_human) values ($1,'Intro','b',true,false)", [id]);
  assert.equal(await bookingLink(sql, id), null); // drafted, not ticked
  await pg.query("update call_proposals set reviewed_by_human = true");
  const u = new URL((await bookingLink(sql, id))!);
  assert.equal(u.searchParams.get("name"), "Dhruv Shah");
  await pg.query("update scores set score = 1");
  assert.equal(await bookingLink(sql, id), null); // no longer recommended
});
