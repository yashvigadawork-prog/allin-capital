import Link from "next/link";
import { correct, score } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { db } from "@/lib/db";
import { computeFlags, duplicateFounders } from "@/lib/flags";
import { setting } from "@/lib/settings";

type Row = {
  score_id: number | null; fix_from: number | null; fix_reason: string | null; examples: number[]; name: string; definition: string; score: number | null; model_score: number | null; source: string | null; evidence: string | null;
  reasoning: string | null; gaps: string[] | null; capped: string | null; conflict: string | null; basis: string | null; scored: boolean;
};

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

export async function Scores({ id, extracted, fields }: { id: number; extracted: boolean; fields: Record<string, unknown> | null }) {
  const sql = db();
  const [meta] = (await sql`select a.scored_at, a.score_note, a.scored_with_research, a.researched_at, e.created_at as read_at
    from applications a left join extracted_fields e on e.application_id = a.id where a.id = ${id}`) as
    { scored_at: string | null; score_note: string | null; scored_with_research: boolean | null; researched_at: string | null; read_at: string | null }[];
  const rows = (await sql`select s.id as score_id, fix.old_score as fix_from, fix.reason as fix_reason, s.example_ids as examples, c.name, c.definition, s.score, s.model_score, s.source, s.evidence, s.reasoning, s.gaps, s.capped, s.conflict, s.basis, (s.id is not null) as scored
    from criteria c left join scores s on s.criterion_id = c.id and s.application_id = ${id}
    left join lateral (select old_score, reason from corrections where score_id = s.id order by id desc limit 1) fix on true order by c.id`) as Row[];
  const used = rows.flatMap((r) => r.examples ?? []);
  const examples = used.length
    ? ((await sql`select c.id, a.company_name, c.old_score, c.new_score, c.reason from corrections c join applications a on a.id = c.application_id where c.id = any(${used}::int[])`) as
        { id: number; company_name: string; old_score: number | null; new_score: number; reason: string }[])
    : [];
  const overlaps = (await sql`select company, level, why from portfolio_overlaps where application_id = ${id} order by level desc, company`) as { company: string; level: string; why: string }[];
  const dupes = await duplicateFounders(sql, id);
  const flags = fields ? computeFlags(fields, await setting(sql, "out_of_scope_sectors", ""), await setting(sql, "deeptech_keywords", "")) : [];

  const scored = rows.filter((r) => r.scored);
  const atThree = scored.filter((r) => (r.score ?? 0) >= 3).length;
  const gaps = scored.filter((r) => r.score === null).length;
  const stale = meta?.scored_at && meta.read_at && new Date(meta.read_at) > new Date(meta.scored_at);

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Scores</h2>
      <form action={score} className="mt-2 flex items-center gap-3">
        <input type="hidden" name="id" value={id} />
        <SubmitButton pendingText="Scoring… about a minute">{meta?.scored_at ? "Score again" : "Score this application"}</SubmitButton>
        <span className="text-sm text-zinc-500">
          {!extracted ? "Read the application first." : meta?.scored_at ? (meta.scored_with_research ? "Scored with web research." : "Scored without web research.") : "Not scored yet."}
        </span>
      </form>
      {meta?.score_note && <p className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{meta.score_note}</p>}
      {stale && <p className="mt-3 rounded border border-amber-300 bg-amber-50 p-3 text-sm">The application was read again after these scores were made. Score again to refresh them.</p>}

      {(flags.length > 0 || overlaps.length > 0 || dupes.length > 0) && (
        <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
          <strong>For Riya to look at:</strong>
          <ul className="mt-1 list-disc space-y-1 pl-5">
            {overlaps.map((o) => (
              <li key={o.company}>
                Portfolio overlap ({o.level}): <strong>{o.company}</strong>. {o.why} Flagged even if it is a false alarm.
              </li>
            ))}
            {dupes.map((d) => <li key={d.id}>Same founder as <Link href={`/applications/${d.id}`} className="underline">{d.company_name}</Link> ({d.founder}). Both applications are kept.</li>)}
            {flags.map((f) => <li key={f.kind}>{f.text}</li>)}
          </ul>
        </div>
      )}

      {meta?.scored_at && (
        <>
          <p className="mt-4 text-sm">
            Criteria at 3 or more: <strong>{atThree} of {rows.length}</strong>. Criteria with a gap: <strong>{gaps}</strong>.
          </p>
          <p className="text-xs text-zinc-500">
            There is no total score on purpose. The “3 or more” count is the pack&apos;s proposed advance rule, for the partners to confirm. A gap is a missing fact, not a low score.
          </p>
          <div className="mt-4 space-y-4">
            {rows.map((r) => (
              <div key={r.name} className="rounded border p-3">
                <div className="flex items-baseline justify-between gap-3">
                  <h3 className="font-medium">{r.name}</h3>
                  <span className={`text-sm ${r.scored && r.score === null ? "text-amber-700" : ""}`}>
                    {!r.scored ? "Not scored yet" : r.score === null ? "Gap, no score" : `${r.score} of 5`}
                  </span>
                </div>
                {r.scored && (
                  <>
                    {r.fix_reason && <p className="mt-1 text-xs text-blue-800">Corrected from {r.fix_from ?? "a gap"} to {r.score}: {r.fix_reason}</p>}
                    {r.capped && !r.fix_reason && <p className="mt-1 text-xs text-amber-800">{r.capped}. The model said {r.model_score}.</p>}
                    {r.reasoning && <p className="mt-2 text-sm">{r.reasoning}</p>}
                    {r.evidence && (
                      <p className="mt-1 text-xs text-zinc-500">
                        “{r.evidence}” — {r.source && /^https?:\/\//i.test(r.source) ? (
                          <a href={r.source} target="_blank" rel="noreferrer noopener" className="underline">{host(r.source)}</a>
                        ) : (
                          r.source
                        )}
                      </p>
                    )}
                    {!!r.gaps?.length && (
                      <ul className="mt-2 list-disc pl-5 text-xs text-amber-800">{r.gaps.map((g, i) => <li key={i}>{g}</li>)}</ul>
                    )}
                    {r.conflict && <p className="mt-2 text-xs text-amber-800">Conflict: {r.conflict}</p>}
                    {!!r.examples?.length && (
                      <ul className="mt-2 list-disc pl-5 text-xs text-blue-800">
                        {examples.filter((e) => r.examples.includes(e.id)).map((e) => (
                          <li key={e.id}>Past correction on {e.company_name}: {e.old_score ?? "gap"} to {e.new_score}, {e.reason}</li>
                        ))}
                      </ul>
                    )}
                    <p className="mt-2 text-xs text-zinc-400">Basis: {r.basis}</p>
                    <form action={correct} className="mt-2 flex flex-wrap items-center gap-2 text-xs">
                      <input type="hidden" name="score_id" value={r.score_id ?? ""} />
                      <input type="hidden" name="application_id" value={id} />
                      <select name="new_score" aria-label={`Corrected score for ${r.name}`} className="rounded border p-1" defaultValue="">
                        <option value="" disabled>Correct to…</option>
                        {[1, 2, 3, 4, 5].map((n) => <option key={n} value={n}>{n}</option>)}
                      </select>
                      <input name="reason" required maxLength={300} placeholder="One-line reason" aria-label={`Reason for ${r.name}`} className="min-w-64 flex-1 rounded border p-1" />
                      <button className="rounded border px-2 py-1">Save correction</button>
                    </form>
                  </>
                )}
              </div>
            ))}
          </div>
        </>
      )}
    </section>
  );
}
