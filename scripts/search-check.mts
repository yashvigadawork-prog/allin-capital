// npm run search:check — one real web search, to prove the Tavily key works. Uses one search request.
import { tavily } from "../lib/search";

const hits = await tavily().search("Inc42 startup funding India");
console.log(`The search worked: ${hits.length} result(s).`);
for (const h of hits.slice(0, 3)) console.log(`- ${h.title}\n  ${h.url}`);
