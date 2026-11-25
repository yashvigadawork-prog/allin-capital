import assert from "node:assert/strict";
import { test } from "node:test";
import { costUsd, usdToInr } from "./cost";

const before = new Date("2026-12-31T12:00:00Z");
const after = new Date("2027-01-01T12:00:00Z");

test("1 USD returns the configured rupee value", () => {
  assert.equal(usdToInr(1, 90), 90);
  assert.equal(usdToInr(1, 87.5), 87.5);
});

test("cost uses input and output prices per million tokens", () => {
  assert.equal(costUsd("gemini-3.8-flash", 1_000_000, 1_000_000, before), 4.5); // 0.75 + 3.75
  assert.equal(costUsd("gemini-3.5-flash-lite", 1_000_000, 1_000_000), 2.8); // 0.30 + 2.50
});

test("flash price doubles from 1 January 2027", () => {
  assert.equal(costUsd("gemini-3.8-flash", 1_000_000, 1_000_000, after), 9); // 1.50 + 7.50
});

test("pro price steps up above 200k prompt tokens", () => {
  assert.equal(costUsd("gemini-3.1-pro-preview", 200_000, 0), 0.4);
  assert.equal(costUsd("gemini-3.1-pro-preview", 200_001, 0), 200_001 * 4 / 1_000_000);
});

test("unknown model gives null, not a wrong number", () => {
  assert.equal(costUsd("some-future-model", 1000, 1000), null);
});
