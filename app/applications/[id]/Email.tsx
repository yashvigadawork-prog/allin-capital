import { draftEmail, sendEmail, tickEmail } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { recommend } from "@/lib/backtest";
import { db } from "@/lib/db";

type P = { id: number; subject: string; body: string; check_ok: boolean; check_problems: string[]; reviewed_by_human: boolean; sent_at: string | null; sent_to: string | null; drafted_by: string; checked_by: string };

export async function Email({ id }: { id: number }) {
  const sql = db();
  const scores = (await sql`select score from scores where application_id = ${id}`) as { score: number | null }[];
  if (!scores.length) return null;
  const rec = recommend(scores);
  if (rec.result !== "advance")
    return <p className="mt-8 text-sm text-zinc-500">No intro email: the app does not recommend a call (needs 3 criteria at 3 or more, with fewer than 3 unknown).</p>;
  const [p] = (await sql`select id, subject, body, check_ok, check_problems, reviewed_by_human, sent_at, sent_to, drafted_by, checked_by from call_proposals
    where application_id = ${id} order by id desc limit 1`) as P[];
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Intro email</h2>
      <p className="text-xs text-zinc-500">Test mode: the email goes only to your own test address, never to the founder.</p>
      {p && (
        <div className="mt-3 rounded border p-3 text-sm">
          <p className="font-medium">{p.subject}</p>
          <pre className="mt-2 whitespace-pre-wrap font-sans">{p.body}</pre>
          <p className="mt-3 text-xs text-zinc-500">Drafted by {p.drafted_by}, checked by {p.checked_by} (a different model).</p>
          {p.check_ok ? (
            <p className="mt-1 text-green-700">The check found no problem.</p>
          ) : (
            <div className="mt-1 rounded border border-red-300 bg-red-50 p-2 text-red-800">
              <strong>The check blocked this draft:</strong>
              <ul className="list-disc pl-5">{p.check_problems.map((x, i) => <li key={i}>{x}</li>)}</ul>
            </div>
          )}
          {p.sent_at ? (
            <p className="mt-3 text-green-700">Sent to {p.sent_to} on {new Date(p.sent_at).toLocaleString("en-IN")}.</p>
          ) : (
            <div className="mt-3 flex flex-wrap items-center gap-3">
              {!p.reviewed_by_human && (
                <form action={tickEmail} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="proposal_id" value={p.id} />
                  <SubmitButton pendingText="Saving…">I reviewed this</SubmitButton>
                </form>
              )}
              {p.reviewed_by_human && (
                <form action={sendEmail} className="flex items-center gap-2">
                  <input type="hidden" name="id" value={id} />
                  <input type="hidden" name="proposal_id" value={p.id} />
                  <span className="text-xs text-zinc-600">Reviewed by Riya.</span>
                  <SubmitButton pendingText="Sending…">Send</SubmitButton>
                </form>
              )}
            </div>
          )}
        </div>
      )}
      {!p?.sent_at && (
        <form action={draftEmail} className="mt-3">
          <input type="hidden" name="id" value={id} />
          <SubmitButton pendingText="Drafting and checking…">{p ? "Draft again" : "Draft intro email"}</SubmitButton>
        </form>
      )}
    </section>
  );
}
