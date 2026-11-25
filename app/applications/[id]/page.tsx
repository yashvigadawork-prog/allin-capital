import Link from "next/link";
import { notFound } from "next/navigation";
import { Suspense } from "react";
import { rerun } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { db } from "@/lib/db";
import { FIELDS, isEmpty } from "@/lib/extract";
import { traceUrl } from "@/lib/trace";
import { Email } from "./Email";
import { Followup } from "./Followup";
import { Replies } from "./Replies";
import { Research } from "./Research";
import { Scores } from "./Scores";

type App = { id: number; company_name: string; status: string; status_note: string | null; deck_text: string | null; form_text: string | null };
type Ext = { fields: Record<string, unknown>; sources: Record<string, string | null> | null; conflicts: { field: string; deck_says: string; form_says: string }[] | null; empty_fields: string[] };

const label = (f: string) => f.replace(/_/g, " ");
const show = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v, null, 1));

async function Detail({ params }: { params: Promise<{ id: string }> }) {
  const id = Number((await params).id);
  if (!Number.isInteger(id)) notFound();
  const sql = db();
  const [app] = (await sql`select id, company_name, status, status_note, deck_text, form_responses->>'text' as form_text from applications where id = ${id}`) as App[];
  if (!app) notFound();
  const [ext] = (await sql`select fields, sources, conflicts, empty_fields from extracted_fields where application_id = ${id}`) as Ext[];
  const [tr] = (await sql`select trace_id from decision_log where application_id = ${id} and trace_id is not null limit 1`) as { trace_id: string }[];
  const trace = traceUrl(tr?.trace_id ?? null);
  return (
    <>
      <h1 className="mt-2 text-2xl font-semibold">{app.company_name}</h1>
      {trace && <a href={trace} target="_blank" rel="noreferrer" className="text-sm underline">View trace in Langfuse</a>}
      <form action={rerun} className="mt-3 flex items-center gap-3">
        <input type="hidden" name="id" value={app.id} />
        <SubmitButton pendingText="Reading…">{ext ? "Read again" : "Read this application"}</SubmitButton>
        <span className="text-sm text-zinc-500">
          {app.status === "new" ? "Not read yet." : app.status === "extracted" || app.status === "scored" ? "Read." : "Needs a human."}
        </span>
      </form>
      {app.status_note && (
        <p className="mt-4 rounded border border-red-300 bg-red-50 p-3 text-sm text-red-800">{app.status_note}</p>
      )}
      {ext && (
        <>
          <p className="mt-6 text-sm">
            <strong>Not stated in the application:</strong> {ext.empty_fields.length ? ext.empty_fields.map(label).join(", ") : "nothing, every field was filled"}
          </p>
          <p className="text-xs text-zinc-500">A missing fact is a gap to ask about. It is not a low score.</p>
          <table className="mt-4 w-full text-sm">
            <tbody className="divide-y align-top">
              {FIELDS.map((f) => {
                const v = ext.fields[f];
                return (
                  <tr key={f}>
                    <td className="w-44 py-2 pr-3 font-medium capitalize">{label(f)}</td>
                    <td>
                      {isEmpty(v) ? <span className="text-amber-700">Not stated (gap)</span> : <pre className="whitespace-pre-wrap font-sans">{show(v)}</pre>}
                    </td>
                    <td className="w-28 pl-3 text-xs text-zinc-500">{!isEmpty(v) ? ext.sources?.[f] ?? "no source given" : ""}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!!ext.conflicts?.length && (
            <div className="mt-6 rounded border border-amber-300 bg-amber-50 p-3 text-sm">
              <strong>The deck and the form disagree:</strong>
              <ul className="mt-1 list-disc pl-5">
                {ext.conflicts.map((c, i) => (
                  <li key={i}>{label(c.field)}: deck says &quot;{c.deck_says}&quot;, form says &quot;{c.form_says}&quot;</li>
                ))}
              </ul>
            </div>
          )}
        </>
      )}
      <Research id={app.id} extracted={!!ext} fields={ext?.fields ?? null} />
      <Scores id={app.id} extracted={!!ext} fields={ext?.fields ?? null} />
      <Email id={app.id} />
      <Replies id={app.id} />
      <Followup id={app.id} />
      <details className="mt-10 text-sm">
        <summary className="cursor-pointer text-zinc-600">Original text (deck and form)</summary>
        <pre className="mt-2 whitespace-pre-wrap rounded border p-3 text-xs">{app.deck_text}{"\n\n"}{app.form_text}</pre>
      </details>
    </>
  );
}

export default function ApplicationPage({ params }: { params: Promise<{ id: string }> }) {
  return (
    <main className="mx-auto max-w-3xl p-8">
      <Link href="/" className="text-sm text-zinc-500">← Applications</Link>
      <Suspense fallback={<p className="mt-6 text-sm text-zinc-500">Loading…</p>}>
        <Detail params={params} />
      </Suspense>
    </main>
  );
}
