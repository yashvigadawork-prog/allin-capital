import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { test } from "node:test";
import { callModel } from "./model";
import { PROMPTS, renderRegister } from "./prompts";

test("every model call in the code is in the register, and the docs file matches it", () => {
  const used = new Set<string>();
  for (const f of readdirSync("lib").filter((x) => x.endsWith(".ts") && !x.endsWith(".test.ts")))
    for (const m of readFileSync(`lib/${f}`, "utf8").matchAll(/step: "([a-z-]+)"/g)) used.add(m[1]);
  assert.deepEqual([...used].sort(), PROMPTS.map((p) => p.step).sort());
  assert.ok(PROMPTS.every((p) => /-v\d+$/.test(p.version)));
  assert.equal(readFileSync("docs/prompt-register.md", "utf8"), renderRegister());
});

test("an application with an email and a phone number reaches the model with both removed, and the call is logged with its version", async () => {
  let seen = "";
  const rows: unknown[][] = [];
  const sql = (async (s: TemplateStringsArray, ...v: unknown[]) => {
    if (/from settings/.test(s.join(""))) return [{ value: "85" }];
    rows.push(v);
    return [];
  }) as never;
  const client = { models: { generateContent: async (r: { contents: string }) => { seen = r.contents; return { text: "{}", candidates: [{ finishReason: "STOP" }], usageMetadata: {} }; } } } as never;
  await callModel({ step: "extraction", promptVersion: "extract-v1", applicationId: 1, input: "Founder Asha, asha@startup.example, +91 98765 43210, pays asha@okhdfc" }, { client, sql });
  assert.doesNotMatch(seen, /asha@|98765|43210/);
  assert.match(seen, /Founder Asha/);
  assert.ok(rows.some((r) => r.includes("extract-v1")));
  await assert.rejects(callModel({ step: "extraction", promptVersion: " ", applicationId: 1, input: "x" }, { client, sql }), /prompt version/);
});
