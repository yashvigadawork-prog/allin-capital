// Step 16: Langfuse tracing. One trace per application; every model call is a step inside it.
// Sent as OpenTelemetry JSON to Langfuse (its old ingestion API was shut down on 2026-11-16); no extra package.
// A tracing failure never fails a model call.
import { createHash, randomBytes } from "node:crypto";

export type Span = {
  traceId: string; name: string; model: string; promptVersion: string;
  input: string; output?: string; error?: string; start: Date; end: Date;
  inputTokens?: number; outputTokens?: number; costUsd?: number | null;
};

const base = () => (process.env.LANGFUSE_BASE_URL ?? "").replace(/\/$/, "");
export const tracingOn = () => !!(base() && process.env.LANGFUSE_PUBLIC_KEY && process.env.LANGFUSE_SECRET_KEY);

/** Same trace for every step of one application (a fixed 32-hex id). Calls with no application each get their own. */
export const traceIdFor = (applicationId: number | null) =>
  applicationId ? createHash("sha256").update(`application-${applicationId}`).digest("hex").slice(0, 32) : randomBytes(16).toString("hex");

export const traceUrl = (traceId: string | null) => (traceId && tracingOn() ? `${base()}/trace/${traceId}` : null);

const str = (key: string, v: string) => ({ key, value: { stringValue: v } });
const nano = (d: Date) => String(BigInt(d.getTime()) * BigInt(1000000));

export function payload(s: Span, applicationId: number | null = null) {
  const attrs = [
    str("langfuse.observation.type", "generation"),
    str("langfuse.trace.name", applicationId ? `application ${applicationId}` : s.name),
    str("langfuse.observation.model.name", s.model),
    str("langfuse.version", s.promptVersion),
    str("langfuse.observation.metadata.promptVersion", s.promptVersion),
    str("langfuse.observation.input", s.input),
    str("langfuse.observation.usage_details", JSON.stringify({ input: s.inputTokens ?? 0, output: s.outputTokens ?? 0 })),
    str("langfuse.observation.level", s.error ? "ERROR" : "DEFAULT"),
  ];
  if (s.output !== undefined) attrs.push(str("langfuse.observation.output", s.output));
  if (s.error) attrs.push(str("langfuse.observation.status_message", s.error));
  if (s.costUsd != null) attrs.push(str("langfuse.observation.cost_details", JSON.stringify({ total: s.costUsd })));
  return {
    resourceSpans: [{
      resource: { attributes: [str("service.name", "allin-screener")] },
      scopeSpans: [{ scope: { name: "allin-screener" }, spans: [{
        traceId: s.traceId, spanId: randomBytes(8).toString("hex"), name: s.name, kind: 1,
        startTimeUnixNano: nano(s.start), endTimeUnixNano: nano(s.end), attributes: attrs,
        status: s.error ? { code: 2, message: s.error } : { code: 1 },
      }] }],
    }],
  };
}

export async function sendSpan(s: Span, applicationId: number | null = null, doFetch: typeof fetch = fetch): Promise<void> {
  if (!tracingOn()) return;
  try {
    const auth = Buffer.from(`${process.env.LANGFUSE_PUBLIC_KEY}:${process.env.LANGFUSE_SECRET_KEY}`).toString("base64");
    const r = await doFetch(`${base()}/api/public/otel/v1/traces`, {
      method: "POST", headers: { "content-type": "application/json", authorization: `Basic ${auth}`, "x-langfuse-ingestion-version": "4" },
      body: JSON.stringify(payload(s, applicationId)), signal: AbortSignal.timeout(5000),
    });
    if (!r.ok) console.warn(`Langfuse tracing: HTTP ${r.status} ${(await r.text()).slice(0, 200)}`);
  } catch (e) {
    console.warn(`Langfuse tracing skipped: ${e instanceof Error ? e.message : e}`);
  }
}
