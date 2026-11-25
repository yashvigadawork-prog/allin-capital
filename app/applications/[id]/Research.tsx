import { research } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { db } from "@/lib/db";
import { MAX_FETCHES, type Finding, researchGaps } from "@/lib/research";

type Row = Finding & { id: number };
type Log = { url: string; reason: string; status: string; kind: string | null; detail: string | null };

const host = (u: string) => {
  try {
    return new URL(u).hostname.replace(/^www\./, "");
  } catch {
    return u;
  }
};

export async function Research({ id, extracted, fields }: { id: number; extracted: boolean; fields: Record<string, unknown> | null }) {
  const sql = db();
  const [meta] = (await sql`select researched_at, research_note from applications where id = ${id}`) as { researched_at: string | null; research_note: string | null }[];
  const findings = (await sql`select id, kind, subject, claim, url, quote, identity, relation, application_says
    from research_findings where application_id = ${id} order by kind, subject, id`) as Row[];
  // The log of the latest run only: the run that produced the findings, or the latest attempt.
  const log = (await sql`select url, reason, status, kind, detail from research_log
    where application_id = ${id} and run_id = (select run_id from research_log where application_id = ${id} order by id desc limit 1)
    order by id`) as Log[];
  const gaps = meta?.researched_at && fields ? researchGaps(fields, findings) : [];
  const groups = [...new Set(findings.map((f) => `${f.kind}|${f.subject}`))];

  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Web research</h2>
      <form action={research} className="mt-2 flex items-center gap-3">
        <input type="hidden" name="id" value={id} />
        <SubmitButton pendingText="Searching the web… about a minute">{meta?.researched_at ? "Research again" : "Research founders and market"}</SubmitButton>
        <span className="text-sm text-zinc-500">
          {!extracted ? "Read the application first." : meta?.researched_at ? `Done. At most ${MAX_FETCHES} web requests per run.` : `Not done yet. At most ${MAX_FETCHES} web requests per run.`}
        </span>
      </form>
      {meta?.research_note && <p className="mt-3 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{meta.research_note}</p>}

      {meta?.researched_at && (
        <>
          {gaps.length > 0 && (
            <div className="mt-4 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
              <strong>Gaps (nothing found, not a low score):</strong>
              <ul className="mt-1 list-disc pl-5">{gaps.map((g) => <li key={g}>{g}</li>)}</ul>
            </div>
          )}
          {groups.map((g) => {
            const [kind, subject] = [g.split("|")[0], g.slice(g.indexOf("|") + 1)];
            return (
              <div key={g} className="mt-5">
                <h3 className="text-sm font-medium capitalize">{kind}: {subject}</h3>
                <ul className="mt-1 space-y-3">
                  {findings.filter((f) => `${f.kind}|${f.subject}` === g).map((f) => (
                    <li key={f.id} className={`text-sm ${f.identity === "unclear" ? "text-zinc-500" : ""}`}>
                      <p>
                        {f.claim}
                        {f.identity === "unclear" && <span className="ml-2 rounded bg-zinc-100 px-1.5 py-0.5 text-xs">could be a different person</span>}
                        {f.relation === "contradicts" && <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-xs text-amber-800">conflicts with the application</span>}
                      </p>
                      {f.relation === "contradicts" && f.application_says && <p className="text-xs text-amber-800">Application says: {f.application_says}</p>}
                      <p className="text-xs text-zinc-500">
                        “{f.quote}” — <a href={f.url} target="_blank" rel="noreferrer noopener" className="underline">{host(f.url)}</a>
                      </p>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
          {!findings.length && <p className="mt-4 text-sm text-zinc-600">No usable findings. The pages that came back did not support any.</p>}
        </>
      )}

      {log.length > 0 && (
        <details className="mt-5 text-sm">
          <summary className="cursor-pointer text-zinc-600">Web requests in the latest run ({log.length} of {MAX_FETCHES})</summary>
          <ul className="mt-2 space-y-1 text-xs">
            {log.map((l, i) => (
              <li key={i} className={l.status === "failed" ? "text-red-700" : "text-zinc-600"}>
                {l.kind === "read" ? "Read" : "Search"}: {l.reason} — {l.kind === "read" ? host(l.url) : l.url}
                {l.status === "failed" && ` (failed: ${l.detail ?? "unknown"})`}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
