import { draftFollowupAction, sendFollowupAction, tickFollowupAction } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { db } from "@/lib/db";
import { bookingLink, followupDue } from "@/lib/followup";
import { BookButtons } from "./BookButtons";

type F = { id: number; subject: string; body: string; reviewed_by_human: boolean; sent_at: string | null; sent_to: string | null };

export async function Followup({ id }: { id: number }) {
  const sql = db();
  const [intro] = (await sql`select 1 as x from call_proposals where application_id = ${id} and sent_at is not null limit 1`) as unknown[];
  const url = await bookingLink(sql, id);
  if (!intro && !url) return null;
  const [f] = (await sql`select id, subject, body, reviewed_by_human, sent_at, sent_to from followups where application_id = ${id}`) as F[];
  const due = !f && (await followupDue(sql, id));
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Follow-up and booking</h2>
      {url && (
        <>
          <BookButtons id={id} url={url} />
          <p className="mt-1 text-xs text-zinc-500">Opens your Cal.com page with the founder&apos;s name filled in. In test mode the email filled in is your test address.</p>
        </>
      )}
      {due && (
        <form action={draftFollowupAction} className="mt-3">
          <input type="hidden" name="id" value={id} />
          <p className="mb-1 text-sm text-amber-800">No reply yet. A follow-up is due. Only one is ever drafted.</p>
          <SubmitButton pendingText="Drafting…">Draft follow-up</SubmitButton>
        </form>
      )}
      {f && (
        <div className="mt-3 rounded border p-3 text-sm">
          <p className="font-medium">{f.subject}</p>
          <pre className="mt-2 whitespace-pre-wrap font-sans">{f.body}</pre>
          {f.sent_at ? (
            <p className="mt-2 text-green-700">Sent to {f.sent_to} on {new Date(f.sent_at).toLocaleString("en-IN")}.</p>
          ) : (
            <form action={f.reviewed_by_human ? sendFollowupAction : tickFollowupAction} className="mt-3 flex items-center gap-2">
              <input type="hidden" name="id" value={id} />
              <input type="hidden" name="followup_id" value={f.id} />
              {f.reviewed_by_human && <span className="text-xs text-zinc-600">Reviewed by Riya.</span>}
              <SubmitButton pendingText="Saving…">{f.reviewed_by_human ? "Send" : "I reviewed this"}</SubmitButton>
            </form>
          )}
        </div>
      )}
    </section>
  );
}
