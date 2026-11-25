// Pure money maths, kept apart from the model call so it can be tested without a database.

type Price = { in: number; out: number }; // USD per million tokens

// Paid-tier prices from the Gemini API pricing page, checked 21 Nov 2026. Thinking tokens bill as output.
// shortcut: text input only (audio costs more), no cached-token pricing; revisit if either is used.
function price(model: string, inputTokens: number, now: Date): Price | null {
  switch (model) {
    case "gemini-3.8-flash":
    case "gemini-3.6-flash":
      // Introductory price ends 31 Dec 2026; it doubles from 1 Jan 2027.
      return now.toISOString() < "2027-01-01" ? { in: 0.75, out: 3.75 } : { in: 1.5, out: 7.5 };
    case "gemini-3.5-flash-lite":
      return { in: 0.3, out: 2.5 };
    case "gemini-3.1-flash-lite":
      return { in: 0.25, out: 1.5 };
    case "gemini-3-flash-preview":
      return { in: 0.5, out: 3 };
    case "gemini-3.1-pro-preview":
      return inputTokens <= 200_000 ? { in: 2, out: 12 } : { in: 4, out: 18 };
    default:
      return null;
  }
}

/** Cost in USD, or null if the model has no price here (the call is still logged, cost blank).
 *  outputTokens must include thinking tokens. */
export function costUsd(model: string, inputTokens: number, outputTokens: number, now = new Date()): number | null {
  const p = price(model, inputTokens, now);
  return p ? (inputTokens * p.in + outputTokens * p.out) / 1_000_000 : null;
}

export function usdToInr(usd: number, rate: number): number {
  return usd * rate;
}
