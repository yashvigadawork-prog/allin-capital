import assert from "node:assert/strict";
import { copyFileSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";
import { PGlite } from "@electric-sql/pglite";
import { importData, parseMemos } from "./importData";

// Neon's tagged-template sql, backed by an in-memory Postgres so no account is needed.
async function freshDb() {
  const pg = new PGlite();
  for (const f of ["db/schema.sql", "db/seed.sql"])
    for (const s of readFileSync(f, "utf8").split(/;\s*$/m).map((x) => x.trim()).filter(Boolean)) await pg.query(s);
  const sql = async (s: TemplateStringsArray, ...v: unknown[]) =>
    (await pg.query(s[0] + v.map((_, i) => `$${i + 1}${s[i + 1]}`).join(""), v)).rows;
  return { pg, sql: sql as never };
}

const haveData = existsSync("data/MESA_T2_Case 03_Deal Memos.pdf");

test("loads the real case files, keeps decisions out of the backtest text, and is safe to rerun", { skip: !haveData }, async () => {
  const { pg, sql } = await freshDb();
  const r = await importData("data", sql);
  assert.deepEqual(r.problems, []);
  assert.deepEqual(r.counts, { applications: 10, past_deals: 12, "decisions: funded": 6, "decisions: passed": 6, partner_notes: 5 });

  const deals = (await pg.query("select company_name, original_application, partner_memo from past_deals")).rows as {
    company_name: string;
    original_application: string;
    partner_memo: string;
  }[];
  for (const d of deals) {
    assert.ok(d.original_application.length > 40, `${d.company_name}: description missing`);
    assert.doesNotMatch(
      d.original_application,
      /\b(INVESTED|PASSED)\b|Why we|Founder assessment|Risks and open/,
      `${d.company_name} leaks the decision`,
    );
    assert.match(d.partner_memo, /Founder assessment\./);
  }
  assert.equal((await importData("data", sql)).counts.applications, 10); // rerun: no duplicates
  assert.equal(((await pg.query("select count(*)::int n from past_deals")).rows[0] as { n: number }).n, 12);
});

test("a missing, unknown or unreadable file is reported, never guessed", { skip: !haveData }, async () => {
  const { sql } = await freshDb();
  const dir = mkdtempSync(join(tmpdir(), "import-"));
  copyFileSync("data/CAPilot_Deck.pdf", join(dir, "CAPilot_Deck.pdf")); // no form
  writeFileSync(join(dir, "random.pdf"), "not a pdf");
  const r = await importData(dir, sql);
  const text = r.problems.join("\n");
  assert.match(text, /CAPilot: missing its form file/);
  assert.match(text, /random\.pdf: not recognised/);
  assert.match(text, /Deal Memos/);
  assert.equal(r.counts.applications, 0);
});

test("a memo without its reason section is skipped and named", () => {
  const { memos, problems } = parseMemos(
    "Memo 1: Acme\nSector: Fintech | Stage: Pre-seed | Source: Warm intro |\nDecision: PASSED\nWhat it does. Things.\nFounder assessment. Fine.\nRisks and open questions. Some.",
  );
  assert.equal(memos.length, 0);
  assert.match(problems[0], /Memo 1 \(Acme\).*Why we passed/);
});
