import assert from "node:assert/strict";
import { test } from "node:test";
import { redact } from "./redact";

test("removes emails and phone numbers", () => {
  assert.equal(redact("Write to hello@yatrika.example today"), "Write to [email removed] today");
  assert.equal(redact("Call +91 98765 43210 or 98765-43210."), "Call [phone removed] or [phone removed].");
});

test("leaves money, dates, percentages and chart numbers alone", () => {
  const t = "Raising INR 1.5 Cr at INR 10 Cr post. ARR INR 9.4 L, 31 firms, founders 90%, since February 2026.\n18\n41\n78";
  assert.equal(redact(t), t);
});

test("removes UPI ids, PAN and Aadhaar numbers but not a row of years", () => {
  assert.equal(redact("Pay riya@okhdfc now"), "Pay [email removed] now");
  assert.equal(redact("PAN ABCDE1234F"), "PAN [PAN removed]");
  assert.equal(redact("Aadhaar 2345 6789 0123 and 234567890123"), "Aadhaar [ID number removed] and [ID number removed]");
  assert.equal(redact("FY 2023 2024 2025 revenue"), "FY 2023 2024 2025 revenue");
});
