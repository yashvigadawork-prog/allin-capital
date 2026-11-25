// Makes one real model call and prints the row it logged. Costs a fraction of a rupee.
// Run: npm run model:check   (needs GEMINI_API_KEY and DATABASE_URL in .env.local)
import { db } from "../lib/db";
import { callModel } from "../lib/model";

const r = await callModel({
  step: "model-check",
  promptVersion: "check-v1",
  applicationId: null,
  input: "Reply with the single word: ok",
  maxTokens: 2000,
});
console.log("Answer:", r.text.trim());
console.log("Logged row:", (await db()`select step, decision, model, prompt_version, input_tokens, output_tokens, cost_usd, cost_inr
  from decision_log order by id desc limit 1`)[0]);
