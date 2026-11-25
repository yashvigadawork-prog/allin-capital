// Step 7: flags for Riya, worked out by code from the extracted fields. A flag never rejects or scores anything.
import { isEmpty } from "./extract";

export type Flag = { kind: "out_of_scope" | "deeptech"; term: string; text: string };

const text = (v: unknown) => (typeof v === "string" && !isEmpty(v) ? v : "");
const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
const terms = (list: string) => list.split(",").map((t) => t.trim()).filter(Boolean);

function firstMatch(haystack: string, list: string): string | null {
  for (const t of terms(list)) if (new RegExp(`(?<![\\w])${escape(t)}(?![\\w])`, "i").test(haystack)) return t;
  return null;
}

/** Out-of-scope sectors and deeptech, matched as whole words in the stated sector, product and market. */
export function computeFlags(fields: Record<string, unknown>, outOfScope: string, deeptech: string): Flag[] {
  const flags: Flag[] = [];
  const sectorProduct = `${text(fields.sector)} ${text(fields.product)}`;
  const wide = `${sectorProduct} ${text(fields.market)}`;
  const out = firstMatch(wide, outOfScope);
  if (out)
    flags.push({
      kind: "out_of_scope",
      term: out,
      text: `The application mentions "${out}", a sector the partners may not back (a setting they can change). Flagged for Riya, not rejected.`,
    });
  const deep = firstMatch(sectorProduct, deeptech);
  if (deep)
    flags.push({
      kind: "deeptech",
      term: deep,
      text: `Looks like deeptech (matched "${deep}"). For deeptech the partners take the second call, with Aditya joining. Riya to confirm.`,
    });
  return flags;
}

type Sql = (s: TemplateStringsArray, ...v: unknown[]) => Promise<unknown>;

/** Other applications that name the same founder. Both are kept; this only tells Riya. */
export async function duplicateFounders(sql: Sql, applicationId: number): Promise<{ id: number; company_name: string; founder: string }[]> {
  return (await sql`with f as (
      select e.application_id, lower(trim(x->>'name')) as n, x->>'name' as name from extracted_fields e,
        jsonb_array_elements(case when jsonb_typeof(e.fields->'founders') = 'array' then e.fields->'founders' else '[]'::jsonb end) x
      where trim(coalesce(x->>'name', '')) <> '')
    select distinct a.id, a.company_name, mine.name as founder from f mine join f other on other.n = mine.n and other.application_id <> mine.application_id
      join applications a on a.id = other.application_id where mine.application_id = ${applicationId} order by a.id`) as { id: number; company_name: string; founder: string }[];
}
