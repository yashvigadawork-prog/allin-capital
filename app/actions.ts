"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { redirect } from "next/navigation";
import { saveCorrection } from "@/lib/corrections";
import { db } from "@/lib/db";
import { draftIntro, sendIntro, tickReviewed } from "@/lib/email";
import { draftFollowup, logLinkUse, sendFollowup, tickFollowup } from "@/lib/followup";
import { extractApplication, runAllPending } from "@/lib/extract";
import { enqueue, runQueue } from "@/lib/queue";
import { pdfPages } from "@/lib/pdf";
import { editReply, handleReply, sendReply, tickReply } from "@/lib/replies";
import { researchApplication } from "@/lib/research";
import { scoreAllPending, scoreApplication } from "@/lib/score";

export async function runAll() {
  await runAllPending();
  revalidatePath("/");
}

export async function rerun(f: FormData) {
  const id = Number(f.get("id"));
  await extractApplication(id);
  revalidatePath("/");
  revalidatePath(`/applications/${id}`);
}

export async function score(f: FormData) {
  const id = Number(f.get("id"));
  await scoreApplication(id);
  revalidatePath("/");
  revalidatePath(`/applications/${id}`);
}

export async function correct(f: FormData) {
  await saveCorrection(db(), Number(f.get("score_id")), Number(f.get("new_score")), String(f.get("reason") ?? ""));
  revalidatePath("/");
  revalidatePath("/corrections");
  revalidatePath(`/applications/${Number(f.get("application_id"))}`);
}

export async function scoreAll() {
  await scoreAllPending();
  revalidatePath("/");
}

export async function research(f: FormData) {
  const id = Number(f.get("id"));
  await researchApplication(id);
  revalidatePath(`/applications/${id}`);
}

// One side of an application (deck or form): an uploaded PDF wins over pasted text. Page markers match the case-file loader.
async function sideText(kind: "Deck" | "Form", file: FormDataEntryValue | null, pasted: FormDataEntryValue | null) {
  let text = "";
  if (file instanceof File && file.size > 0) {
    if (!/\.pdf$/i.test(file.name)) throw new Error(`${kind}: only PDF files can be uploaded. Paste the text instead.`);
    const pages = await pdfPages(new Uint8Array(await file.arrayBuffer()));
    text = pages.map((t, i) => `[${kind} page ${i + 1}]\n${t}`).join("\n\n");
    if (pages.join("").trim().length < 50) throw new Error(`${kind}: the PDF has no readable text (a scanned image?). Paste the text instead.`);
  } else if (String(pasted ?? "").trim()) {
    text = `[${kind} page 1]\n${String(pasted).trim()}`;
  }
  return text;
}

export async function addApplication(_prev: { error?: string }, f: FormData): Promise<{ error?: string }> {
  const company = String(f.get("company") ?? "").trim();
  if (!company) return { error: "Enter the company name." };
  let deck: string, form: string;
  try {
    deck = await sideText("Deck", f.get("deck_file"), f.get("deck_text"));
    form = await sideText("Form", f.get("form_file"), f.get("form_text"));
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Could not read the upload." };
  }
  if (!deck && !form) return { error: "Add the deck or the form, as a PDF or as pasted text." };

  const sql = db();
  if ((await sql`select 1 from applications where company_name = ${company}`).length)
    return { error: `An application called "${company}" already exists.` };
  const [row] = (await sql`insert into applications (company_name, deck_text, form_responses)
    values (${company}, ${deck}, ${JSON.stringify({ text: form })}::jsonb) returning id`) as { id: number }[];
  redirect(`/applications/${row.id}`);
}

// Errors are thrown so the page's error screen shows the plain-words message.
export async function draftEmail(f: FormData) {
  const id = Number(f.get("id"));
  const r = await draftIntro(id);
  if ("error" in r) throw new Error(r.error);
  revalidatePath(`/applications/${id}`);
}

export async function tickEmail(f: FormData) {
  await tickReviewed(db(), Number(f.get("proposal_id")));
  revalidatePath(`/applications/${Number(f.get("id"))}`);
}

export async function sendEmail(f: FormData) {
  const r = await sendIntro(Number(f.get("proposal_id")));
  if ("error" in r) throw new Error(r.error);
  revalidatePath(`/applications/${Number(f.get("id"))}`);
}

export async function addReply(f: FormData) {
  const id = Number(f.get("id"));
  await handleReply(id, String(f.get("reply") ?? ""));
  revalidatePath(`/applications/${id}`);
}

export async function editReplyDraft(f: FormData) {
  await editReply(db(), Number(f.get("reply_id")), String(f.get("body") ?? ""));
  revalidatePath(`/applications/${Number(f.get("id"))}`);
}

export async function tickReplyDraft(f: FormData) {
  await tickReply(db(), Number(f.get("reply_id")));
  revalidatePath(`/applications/${Number(f.get("id"))}`);
}

export async function sendReplyDraft(f: FormData) {
  const r = await sendReply(Number(f.get("reply_id")));
  if ("error" in r) throw new Error(r.error);
  revalidatePath(`/applications/${Number(f.get("id"))}`);
}

export async function draftFollowupAction(f: FormData) {
  const id = Number(f.get("id"));
  const r = await draftFollowup(id);
  if ("error" in r) throw new Error(r.error);
  revalidatePath(`/applications/${id}`);
}

export async function tickFollowupAction(f: FormData) {
  await tickFollowup(db(), Number(f.get("followup_id")));
  revalidatePath(`/applications/${Number(f.get("id"))}`);
}

export async function sendFollowupAction(f: FormData) {
  const r = await sendFollowup(Number(f.get("followup_id")));
  if ("error" in r) throw new Error(r.error);
  revalidatePath(`/applications/${Number(f.get("id"))}`);
}

export async function logBookingLink(id: number, how: "opened" | "copied") {
  await logLinkUse(db(), id, how === "copied" ? "copied" : "opened");
}

// Puts every application that has not been read yet into the queue and starts working. The page returns at once;
// progress is on the Queue page.
export async function processNew() {
  const sql = db();
  const ids = ((await sql`select id from applications where status = 'new' order by id`) as { id: number }[]).map((r) => r.id);
  await enqueue(sql, ids);
  after(() => runQueue().then(() => undefined));
  revalidatePath("/queue");
}

export async function resumeQueue() {
  after(() => runQueue().then(() => undefined));
  revalidatePath("/queue");
}
