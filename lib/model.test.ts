import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { callModel } from "./model";

const rows: { decision: string; reason: string }[] = [];
const sql = (async (s: TemplateStringsArray, ...v: unknown[]) => {
  if (/from settings/.test(s.join(""))) return [{ value: "85" }];
  if (/insert into decision_log/.test(s.join(""))) rows.push({ decision: String(v[2]), reason: String(v[3]) });
  return [];
}) as never;
const ok = { text: "{}", candidates: [{ finishReason: "STOP" }], usageMetadata: {} };
const call = { step: "extraction", promptVersion: "extract-v1", applicationId: 1, input: "x" };

test("a dead connection is retried after 1, 2 and 4 seconds, then fails with a plain message", async () => {
  rows.length = 0;
  const waits: number[] = [];
  const client = { models: { generateContent: async () => { throw new TypeError("fetch failed"); } } } as never;
  await assert.rejects(callModel(call, { client, sql, sleep: async (ms) => void waits.push(ms) }), /could not be reached.*1, 2, 4 seconds/);
  assert.deepEqual(waits, [1000, 2000, 4000]);
  assert.equal(rows.filter((r) => r.decision === "model call retry").length, 3);
  assert.equal(rows.at(-1)?.decision, "model call failed");
});

test("a connection that comes back is retried to success; an answer with an error status is not retried here", async () => {
  rows.length = 0;
  let n = 0;
  const waits: number[] = [];
  const flaky = { models: { generateContent: async () => { if (++n < 3) throw new TypeError("fetch failed"); return ok; } } } as never;
  assert.equal((await callModel(call, { client: flaky, sql, sleep: async (ms) => void waits.push(ms) })).text, "{}");
  assert.deepEqual(waits, [1000, 2000]);

  let m = 0;
  const denied = { models: { generateContent: async () => { m++; throw Object.assign(new Error("invalid key"), { status: 401 }); } } } as never;
  await assert.rejects(callModel(call, { client: denied, sql, sleep: async () => {} }), /invalid key/);
  assert.equal(m, 1); // Portkey owns retries for statuses; a wrong key is permanent
});

test("no file but lib/model.ts talks to a model provider", () => {
  const files = [...readdirSync("lib").map((f) => `lib/${f}`), ...readdirSync("scripts").map((f) => `scripts/${f}`)].filter((f) => /\.(ts|mts|mjs)$/.test(f) && !f.endsWith(".test.ts"));
  for (const f of files) {
    if (f === "lib/model.ts") continue;
    const src = readFileSync(f, "utf8");
    assert.doesNotMatch(src.replace(/import type [^\n]*\n/g, ""), /@google\/genai|generativelanguage\.googleapis|api\.openai\.com|api\.anthropic\.com/, f);
  }
});
