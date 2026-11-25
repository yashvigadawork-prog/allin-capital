import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { emptyFields, extractApplication, isEmpty, parseExtraction, runAllPending } from "./extract";

async function freshDb() {
  const pg = new PGlite();
  for (const f of ["db/schema.sql", "db/seed.sql"])
    for (const s of readFileSync(f, "utf8").split(/;\s*$/m).map((x) => x.trim()).filter(Boolean)) await pg.query(s);
  const sql = async (s: TemplateStringsArray, ...v: unknown[]) =>
    (await pg.query(s[0] + v.map((_, i) => `$${i + 1}${s[i + 1]}`).join(""), v)).rows;
  return { pg, sql: sql as never };
}

const good = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    fields: {
      founders: [{ name: "Dhruv Shah", role: "CEO", past_roles: ["CA, 4 years"] }],
      product: "GST assistant", market: "CA firms", why_now: null, traction: "INR 9.4 L ARR", ask: "INR 1.5 Cr",
      team_start_dates: [{ founder: "Dhruv Shah", started: "February 2026" }], full_time_status: "Not stated",
      sector: "Fintech", stage: "Pre-seed", prior_startup_experience: "None for either founder", ...over,
    },
    sources: { product: "Deck page 3" },
    deck_form_conflicts: [{ field: "traction", deck_says: "31 firms", form_says: "24 firms" }],
  });

function fakeClient(replies: string[], seen: { calls: number; last?: any } = { calls: 0 }) {
  return {
    seen,
    client: {
      models: {
        generateContent: async (req: any) => {
          seen.last = req;
          const text = replies[Math.min(seen.calls++, replies.length - 1)];
          return { text, candidates: [{ finishReason: "STOP" }], usageMetadata: { promptTokenCount: 100, candidatesTokenCount: 50 } };
        },
      },
    } as never,
  };
}

async function addApp(pg: PGlite, name: string, deck = "[Deck page 1]\nContact hello@x.example\nWe do GST.", status = "new") {
  const r = await pg.query("insert into applications (company_name, deck_text, form_responses, status) values ($1,$2,$3::jsonb,$4) returning id",
    [name, deck, JSON.stringify({ text: "[Form page 1]\nCompany " + name }), status]);
  return (r.rows[0] as { id: number }).id;
}

test("code finds empty fields: null, blank, placeholders and empty lists, but not real answers", () => {
  assert.equal(isEmpty(null), true);
  assert.equal(isEmpty("  "), true);
  assert.equal(isEmpty("Not stated"), true);
  assert.equal(isEmpty([]), true);
  assert.equal(isEmpty([{ name: null, past_roles: [] }]), true);
  assert.equal(isEmpty("None for either founder"), false);
  assert.equal(isEmpty(0), false);
  assert.deepEqual(emptyFields({ product: "x" }).includes("product"), false);
  assert.ok(emptyFields({}).length >= 11); // a field the model omitted counts as empty
});

test("parseExtraction accepts fenced JSON and rejects junk in plain words", () => {
  assert.ok(parseExtraction("```json\n" + good() + "\n```").fields);
  assert.throws(() => parseExtraction("sorry, I cannot"), /not valid JSON/);
  assert.throws(() => parseExtraction("[1,2]"), /no "fields"/);
});

test("a removed field shows as empty, and nothing is scored", async () => {
  const { pg, sql } = await freshDb();
  const id = await addApp(pg, "CAPilot");
  const { client, seen } = fakeClient([good()]);
  const r = await extractApplication(id, { client, sql });
  assert.deepEqual(r.empty, ["why_now", "full_time_status"]);
  const row = (await pg.query("select empty_fields, conflicts from extracted_fields")).rows[0] as any;
  assert.deepEqual(row.empty_fields, ["why_now", "full_time_status"]);
  assert.equal(row.conflicts[0].field, "traction");
  assert.equal(((await pg.query("select count(*)::int n from scores")).rows[0] as any).n, 0);
  assert.equal(((await pg.query("select status from applications")).rows[0] as any).status, "extracted");
  assert.match(seen.last.contents, /^<application id="\d+">/); // data is fenced off
  assert.match(seen.last.contents, /\[email removed\]/);
  assert.doesNotMatch(seen.last.contents, /hello@x\.example/);
  assert.equal(seen.last.config.responseMimeType, "application/json");
});

test("bad JSON is asked twice, then goes to manual review; a rerun can recover it", async () => {
  const { pg, sql } = await freshDb();
  const id = await addApp(pg, "Broken");
  const { client, seen } = fakeClient(["nope", "still nope"]);
  const r = await extractApplication(id, { client, sql });
  assert.equal(r.ok, false);
  assert.equal(seen.calls, 2);
  const a = (await pg.query("select status, status_note from applications")).rows[0] as any;
  assert.equal(a.status, "manual_review");
  assert.match(a.status_note, /by hand/);
  const ok = await extractApplication(id, { client: fakeClient([good()]).client, sql });
  assert.equal(ok.ok, true);
  assert.equal(((await pg.query("select status_note from applications")).rows[0] as any).status_note, null);
});

test("a failed model call is not retried and is explained", async () => {
  const { pg, sql } = await freshDb();
  const id = await addApp(pg, "Blocked");
  const client = { models: { generateContent: async () => ({ text: "", candidates: [{ finishReason: "SAFETY" }] }) } } as never;
  const r = await extractApplication(id, { client, sql });
  assert.equal(r.ok, false);
  assert.match(r.error!, /stopped early \(SAFETY\)/);
});

test("Run all only touches 'new' applications and one failure does not stop the rest", async () => {
  const { pg, sql } = await freshDb();
  await addApp(pg, "A");
  await addApp(pg, "B", "[Deck page 1]\nBAD");
  await addApp(pg, "C");
  await addApp(pg, "Already", undefined, "extracted");
  const client = {
    models: {
      generateContent: async (req: any) => ({
        text: /BAD/.test(req.contents) ? "garbage" : good(),
        candidates: [{ finishReason: "STOP" }],
        usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 },
      }),
    },
  } as never;
  assert.deepEqual(await runAllPending({ client, sql }), { done: 2, failed: 1 });
  const s = (await pg.query("select company_name, status from applications order by id")).rows;
  assert.deepEqual(s.map((r: any) => r.status), ["extracted", "manual_review", "extracted", "extracted"]);
});
