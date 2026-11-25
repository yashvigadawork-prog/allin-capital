import Link from "next/link";
import { Suspense } from "react";
import { processNew, resumeQueue } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { db } from "@/lib/db";

type J = { application_id: number; company_name: string; kind: string; status: string; attempts: number; error: string | null };

const colour: Record<string, string> = { queued: "bg-zinc-100 text-zinc-700", running: "bg-blue-100 text-blue-800", done: "bg-green-100 text-green-800", failed: "bg-red-100 text-red-800" };

async function Status() {
  const sql = db();
  const jobs = (await sql`select j.application_id, a.company_name, j.kind, j.status, j.attempts, j.error
    from jobs j join applications a on a.id = j.application_id order by j.application_id, j.id`) as J[];
  const count = (s: string) => jobs.filter((j) => j.status === s).length;
  const byApp = new Map<number, J[]>();
  for (const j of jobs) byApp.set(j.application_id, [...(byApp.get(j.application_id) ?? []), j]);
  const active = count("queued") + count("running") > 0;
  return (
    <>
      {active && <meta httpEquiv="refresh" content="5" />}
      <p className="mt-4 text-sm">
        Queued {count("queued")} · Running {count("running")} · Done {count("done")} · Failed {count("failed")} (steps, three per application)
        {active && <span className="text-zinc-500"> · this page refreshes by itself</span>}
      </p>
      <table className="mt-4 w-full text-sm">
        <thead className="text-left text-xs text-zinc-500"><tr><th className="py-1">Application</th><th>Read</th><th>Research</th><th>Score</th><th>Why it stopped</th></tr></thead>
        <tbody className="divide-y align-top">
          {[...byApp.entries()].map(([id, js]) => (
            <tr key={id}>
              <td className="py-2"><Link href={`/applications/${id}`} className="underline">{js[0].company_name}</Link></td>
              {["extract", "research", "score"].map((k) => {
                const j = js.find((x) => x.kind === k);
                return <td key={k}>{j && <span className={`rounded px-2 py-0.5 text-xs ${colour[j.status]}`}>{j.status}{j.attempts > 1 ? ` (try ${j.attempts})` : ""}</span>}</td>;
              })}
              <td className="text-xs text-red-800">{js.find((x) => x.status === "failed" && !x.error?.startsWith("Not run"))?.error ?? js.find((x) => x.error && x.status === "queued")?.error}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {!jobs.length && <p className="mt-4 text-sm text-zinc-500">The queue is empty.</p>}
    </>
  );
}

export default function QueuePage() {
  return (
    <main className="mx-auto max-w-4xl p-8">
      <Link href="/" className="text-sm text-zinc-500">← Applications</Link>
      <h1 className="mt-2 text-2xl font-semibold">Queue</h1>
      <p className="mt-1 text-sm text-zinc-600">Reads, researches and scores many applications at once, a few at a time (set on the Criteria page). A step that fails is tried once more, then stops with its reason.</p>
      <div className="mt-3 flex gap-3">
        <form action={processNew}><SubmitButton pendingText="Starting…">Process all new applications</SubmitButton></form>
        <form action={resumeQueue}><SubmitButton pendingText="Starting…">Resume queue</SubmitButton></form>
      </div>
      <Suspense fallback={<p className="mt-4 text-sm text-zinc-500">Loading…</p>}>
        <Status />
      </Suspense>
    </main>
  );
}
