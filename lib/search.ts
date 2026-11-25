// The only file that talks to the web search service (Tavily). Swap this file to change provider.
// Each call here is ONE outbound web request. lib/research.ts counts them against the 8-fetch cap.

export type Hit = { url: string; title: string; text: string };
export type WebTools = {
  search(query: string): Promise<Hit[]>;
  read(url: string): Promise<string>;
};

const READ_LIMIT = 8000; // characters kept from one page
const TIMEOUT_MS = 20_000;

export function tavily(apiKey: string | undefined = process.env.SEARCH_API_KEY, fetchFn: typeof fetch = fetch): WebTools {
  if (!apiKey) throw new Error("SEARCH_API_KEY is empty. Paste your Tavily key into .env.local and restart.");

  async function post(path: string, body: unknown): Promise<Record<string, unknown>> {
    const res = await fetchFn(`https://api.tavily.com/${path}`, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status === 401 || res.status === 403) throw new Error("The search service rejected the key. Check SEARCH_API_KEY in .env.local.");
    if (res.status === 429) throw new Error("The search service says too many requests, or the plan limit is used up.");
    if (!res.ok) throw new Error(`The search service answered with an error (${res.status}).`);
    return res.json();
  }

  return {
    async search(query) {
      const j = await post("search", { query, search_depth: "basic", max_results: 5, include_answer: false, include_raw_content: false });
      const results = (Array.isArray(j.results) ? j.results : []) as { url?: unknown; title?: unknown; content?: unknown }[];
      return results
        .filter((r): r is { url: string; title?: unknown; content?: unknown } => typeof r?.url === "string")
        .map((r) => ({ url: r.url, title: String(r.title ?? ""), text: String(r.content ?? "") }));
    },
    async read(url) {
      const j = await post("extract", { urls: url, extract_depth: "basic", format: "markdown" });
      const page = (Array.isArray(j.results) ? j.results[0] : undefined) as { raw_content?: unknown } | undefined;
      if (!page || typeof page.raw_content !== "string" || !page.raw_content.trim()) throw new Error("The page could not be read.");
      return page.raw_content.slice(0, READ_LIMIT);
    },
  };
}
