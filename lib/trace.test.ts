import assert from "node:assert/strict";
import { test } from "node:test";
import { payload, traceIdFor } from "./trace";

const id = traceIdFor(7);
const span = { traceId: id, name: "scoring", model: "m", promptVersion: "score-v2", input: "in", output: "out", start: new Date(0), end: new Date(1000), inputTokens: 5, outputTokens: 6, costUsd: 0.01 };
const attrs = (p: ReturnType<typeof payload>) => Object.fromEntries(p.resourceSpans[0].scopeSpans[0].spans[0].attributes.map((a) => [a.key, a.value.stringValue]));

test("one trace per application; each model call is a step in it, carrying the prompt version and cost", () => {
  assert.match(id, /^[0-9a-f]{32}$/);
  assert.equal(traceIdFor(7), id);
  assert.notEqual(traceIdFor(null), traceIdFor(null));
  const a = attrs(payload(span, 7));
  assert.equal(a["langfuse.trace.name"], "application 7");
  assert.equal(a["langfuse.version"], "score-v2");
  assert.equal(a["langfuse.observation.cost_details"], '{"total":0.01}');
  assert.equal(payload(span).resourceSpans[0].scopeSpans[0].spans[0].traceId, id);
  assert.equal(attrs(payload({ ...span, output: undefined, error: "cut off" }))["langfuse.observation.level"], "ERROR");
});
