import { addReply, editReplyDraft, sendReplyDraft, tickReplyDraft } from "@/app/actions";
import { SubmitButton } from "@/components/SubmitButton";
import { db } from "@/lib/db";
import { HOLE } from "@/lib/replies";

type R = { id: number; reply_text: string; classification: string; basis: string | null; flags: string[]; draft_body: string | null; reviewed_by_human: boolean; sent_at: string | null; sent_to: string | null };

export async function Replies({ id }: { id: number }) {
  const sql = db();
  const [sent] = (await sql`select 1 as x from call_proposals where application_id = ${id} and sent_at is not null limit 1`) as unknown[];
  if (!sent) return null; // a reply only makes sense after the intro email went out
  const replies = (await sql`select id, reply_text, classification, basis, flags, draft_body, reviewed_by_human, sent_at, sent_to from founder_replies where application_id = ${id} order by id desc`) as R[];
  return (
    <section className="mt-10">
      <h2 className="text-lg font-semibold">Founder reply</h2>
      <form action={addReply} className="mt-2">
        <input type="hidden" name="id" value={id} />
        <textarea name="reply" required rows={4} placeholder="Paste the founder's reply here" className="w-full rounded border p-2 text-sm" />
        <div className="mt-2"><SubmitButton pendingText="Reading the reply…">Classify and draft an answer</SubmitButton></div>
      </form>
      {replies.map((r) => (
        <div key={r.id} className="mt-4 rounded border p-3 text-sm">
          <p><span className="rounded bg-zinc-100 px-2 py-0.5 font-medium">{r.classification}</span></p>
          <blockquote className="mt-2 border-l-2 pl-3 text-zinc-600">{r.reply_text}</blockquote>
          {r.basis && <p className="mt-2 text-xs text-zinc-500">Based on: &quot;{r.basis}&quot;</p>}
          {r.flags.length > 0 && (
            <ul className="mt-2 list-disc rounded border border-amber-300 bg-amber-50 p-2 pl-6 text-amber-900">{r.flags.map((x, i) => <li key={i}>{x}</li>)}</ul>
          )}
          {r.draft_body && (r.sent_at ? (
            <>
              <pre className="mt-3 whitespace-pre-wrap font-sans">{r.draft_body}</pre>
              <p className="mt-2 text-green-700">Sent to {r.sent_to} on {new Date(r.sent_at).toLocaleString("en-IN")}.</p>
            </>
          ) : (
            <>
              <form action={editReplyDraft} className="mt-3">
                <input type="hidden" name="id" value={id} />
                <input type="hidden" name="reply_id" value={r.id} />
                <textarea name="body" defaultValue={r.draft_body} rows={8} className="w-full rounded border p-2 font-sans text-sm" />
                <button className="mt-1 rounded border px-3 py-1 text-xs">Save edits (clears the tick)</button>
              </form>
              <div className="mt-2 flex items-center gap-3">
                {!r.reviewed_by_human ? (
                  <form action={tickReplyDraft}>
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="reply_id" value={r.id} />
                    <SubmitButton pendingText="Saving…">I reviewed this</SubmitButton>
                  </form>
                ) : (
                  <form action={sendReplyDraft} className="flex items-center gap-2">
                    <input type="hidden" name="id" value={id} />
                    <input type="hidden" name="reply_id" value={r.id} />
                    <span className="text-xs text-zinc-600">Reviewed by Riya.</span>
                    <SubmitButton pendingText="Sending…">Send</SubmitButton>
                  </form>
                )}
                {HOLE.test(r.draft_body) && <span className="text-xs text-red-700">Fill in the bracketed gaps first.</span>}
              </div>
            </>
          ))}
        </div>
      ))}
    </section>
  );
}
