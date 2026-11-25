// The home-page list. Scored applications first: most criteria at 3 or more, then most at 4 or more, then fewest gaps.
// Then read-but-unscored (fewest empty fields first), then the rest. Ties by id, so the order never changes between runs.
// There is no total score: these are counts of criteria, and a gap is never counted as a low score.
import { db } from "./db";

type Sql = ReturnType<typeof db>;

export type Ranked = {
  id: number; company_name: string; status: string; status_note: string | null; empty_fields: string[] | null;
  fields: Record<string, unknown> | null; c3: number; c4: number; gaps: number; n: number; overlaps: number;
};

export async function rankedApplications(sql: Sql = db()): Promise<Ranked[]> {
  return (await sql`select a.id, a.company_name, a.status, a.status_note, e.empty_fields, e.fields,
      (count(s.id) filter (where s.score >= 3))::int as c3, (count(s.id) filter (where s.score >= 4))::int as c4,
      (count(s.id) filter (where s.score is null))::int as gaps, count(s.id)::int as n,
      (select count(*) from portfolio_overlaps o where o.application_id = a.id)::int as overlaps
    from applications a left join extracted_fields e on e.application_id = a.id left join scores s on s.application_id = a.id
    group by a.id, e.id
    order by (a.status = 'scored') desc, (a.status = 'extracted') desc, c3 desc, c4 desc, gaps, coalesce(array_length(e.empty_fields, 1), 0), a.id`) as Ranked[];
}
