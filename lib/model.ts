// The only file in the app allowed to call a model provider (Google Gemini).
// Every call writes one row to decision_log: step, prompt version, application, tokens, cost.
import { GoogleGenAI } from "@google/genai";
import { costUsd, usdToInr } from "./cost";
import { db } from "./db";
import { assertUnderLimit } from "./limit";
import { redact } from "./redact";
import { sendSpan, traceIdFor } from "./trace";

type Sql = ReturnType<typeof db>;

const errText = (e: unknown) => (e instanceof Error ? e.message.slice(0, 300) : "Unknown error");
/** Retry waits in milliseconds: 1, 2 and 4 seconds. */
export const RETRY_WAITS = [1000, 2000, 4000];
/** Portkey's own retries, for failures from Google (rate limit, overload): 3 retries, which Portkey spaces 1, 2 and 4 seconds apart. */
export const PORTKEY_CONFIG = { retry: { attempts: 3, on_status_codes: [408, 429, 500, 502, 503, 504] } };

/** An error with no HTTP status means the request never got an answer (no network, timeout). Without Portkey,
 * Google's own busy/rate-limit answers are retried here as well, since nothing else will retry them. */
function isConnectionError(e: unknown, direct = false): boolean {
  if (!(e instanceof Error)) return false;
  const status = (e as { status?: unknown }).status;
  return typeof status !== "number" || (direct && PORTKEY_CONFIG.retry.on_status_codes.includes(status));
}

/** With PORTKEY_API_KEY set, every call goes through Portkey (logs, PORTKEY_CONFIG retries). Without it (Portkey
 * sign-ups were closed), calls go straight to Google and this file does all the retrying. Google's key travels with the request. */
const viaPortkey = () => !!process.env.PORTKEY_API_KEY;
function gatewayClient(): GoogleGenAI {
  const apiKey = process.env.GEMINI_API_KEY, portkey = process.env.PORTKEY_API_KEY;
  if (!apiKey) throw new Error("GEMINI_API_KEY is empty. Paste your key into .env.local and restart.");
  if (!portkey) return new GoogleGenAI({ apiKey });
  return new GoogleGenAI({
    apiKey,
    httpOptions: {
      baseUrl: "https://api.portkey.ai/v1",
      apiVersion: "",
      headers: { "x-portkey-api-key": portkey, "x-portkey-provider": "google", "x-portkey-config": JSON.stringify(PORTKEY_CONFIG) },
    },
  });
}

export const DEFAULT_MODEL = "gemini-3.8-flash";

export type ModelCall = {
  step: string; // e.g. "extraction"
  promptVersion: string; // e.g. "extract-v1"
  applicationId: number | null;
  /** callModel removes emails, phone numbers, PAN and Aadhaar numbers from this text before it is sent. */
  input: string;
  system?: string;
  model?: string;
  maxTokens?: number;
  /** Ask for a JSON answer. The caller must still validate it. */
  json?: boolean;
};

export type ModelResult = {
  text: string;
  model: string;
  inputTokens: number;
  outputTokens: number; // includes thinking tokens, which are billed as output
  costUsd: number | null;
  costInr: number | null;
};

async function usdInr(sql: Sql): Promise<number> {
  const rows = (await sql`select value from settings where key = 'usd_inr'`) as { value: string }[];
  const rate = Number(rows[0]?.value);
  if (!(rate > 0)) throw new Error("The USD to INR rate is not set. Set it on the Criteria page, then try again.");
  return rate;
}

async function logCall(
  sql: Sql,
  a: ModelCall,
  decision: string,
  reason: string,
  r?: { inputTokens: number; outputTokens: number; costUsd: number | null; costInr: number | null },
  t?: { start: Date; traceId: string; output?: string }, // given for final outcomes only, not retries
) {
  await sql`insert into decision_log
      (application_id, step, decision, reason, model, prompt_version, input_tokens, output_tokens, cost_usd, cost_inr, trace_id)
    values (${a.applicationId}, ${a.step}, ${decision}, ${reason}, ${a.model ?? DEFAULT_MODEL}, ${a.promptVersion},
      ${r?.inputTokens ?? null}, ${r?.outputTokens ?? null}, ${r?.costUsd ?? null}, ${r?.costInr ?? null}, ${t?.traceId ?? null})`;
  if (t)
    await sendSpan({
      traceId: t.traceId, name: a.step, model: a.model ?? DEFAULT_MODEL, promptVersion: a.promptVersion, input: redact(a.input),
      output: t.output, error: decision === "model call ok" ? undefined : reason, start: t.start, end: new Date(),
      inputTokens: r?.inputTokens, outputTokens: r?.outputTokens, costUsd: r?.costUsd,
    }, a.applicationId);
}

export async function callModel(
  a: ModelCall,
  deps: { client?: GoogleGenAI; sql?: Sql; sleep?: (ms: number) => Promise<void> } = {}, // injectable so tests need no network or waiting
): Promise<ModelResult> {
  if (!a.step.trim() || !a.promptVersion.trim()) throw new Error("Every model call needs a step name and a prompt version.");
  const sql = deps.sql ?? db();
  const model = a.model ?? DEFAULT_MODEL;
  const rate = await usdInr(sql); // fail before spending money if costs could not be logged
  try {
    await assertUnderLimit(sql);
  } catch (e) {
    await logCall(sql, a, "model call blocked", errText(e));
    throw e;
  }
  const t = { start: new Date(), traceId: traceIdFor(a.applicationId) };

  let res;
  try {
    const client = deps.client ?? gatewayClient();
    // No temperature: Gemini 3.6 and later ignore it and Google plans to reject it. Repeatable results
    // come from code (stable sorting, stored results) and explicit rules in the prompt.
    const request = {
      model,
      contents: redact(a.input), // the one place personal contact details are removed, for every prompt
      config: {
        systemInstruction: a.system,
        maxOutputTokens: a.maxTokens ?? 16000,
        responseMimeType: a.json ? "application/json" : undefined,
      },
    };
    // Portkey retries failures it sees from Google (see PORTKEY_CONFIG). When our own connection fails the request
    // never reaches Portkey, so those errors are retried here, on the same 1, 2 and 4 second schedule.
    for (let attempt = 0; ; attempt++) {
      try {
        res = await client.models.generateContent(request);
        break;
      } catch (e) {
        const retryable = isConnectionError(e, !viaPortkey());
        if (!retryable || attempt >= RETRY_WAITS.length) {
          if (retryable) throw new Error(`The model service could not be reached, even after ${RETRY_WAITS.length} retries (${RETRY_WAITS.map((w) => w / 1000).join(", ")} seconds apart). Check the internet connection and try again.`);
          throw e;
        }
        await logCall(sql, a, "model call retry", `Connection failed (${errText(e)}). Waiting ${RETRY_WAITS[attempt] / 1000} s, then retry ${attempt + 1} of ${RETRY_WAITS.length}.`);
        await (deps.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms))))(RETRY_WAITS[attempt]);
      }
    }
  } catch (e) {
    await logCall(sql, a, "model call failed", errText(e), undefined, t);
    throw e;
  }

  const inputTokens = res.usageMetadata?.promptTokenCount ?? 0;
  const outputTokens = (res.usageMetadata?.candidatesTokenCount ?? 0) + (res.usageMetadata?.thoughtsTokenCount ?? 0);
  const usd = costUsd(model, inputTokens, outputTokens);
  const info = { inputTokens, outputTokens, costUsd: usd, costInr: usd === null ? null : usdToInr(usd, rate) };

  const blocked = res.promptFeedback?.blockReason;
  const finish = res.candidates?.[0]?.finishReason;
  if (blocked || finish !== "STOP") {
    const why = blocked
      ? `The model blocked this request (${blocked}).`
      : finish === "MAX_TOKENS"
        ? "The answer was cut off at the token limit."
        : `The model stopped early (${finish ?? "no reason given"}).`;
    await logCall(sql, a, "model call failed", why, info, t);
    throw new Error(why);
  }

  await logCall(sql, a, "model call ok", `Model call for ${a.step} with prompt ${a.promptVersion}.`, info, { ...t, output: res.text ?? "" });
  return { text: res.text ?? "", model, ...info };
}
