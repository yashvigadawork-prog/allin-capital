// Loads the case PDFs in data/ into the database. Never guesses: anything it cannot read or parse
// is listed in `problems` and skipped. Safe to run again: rows are updated, not duplicated.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { db } from "./db";
import { pdfPages } from "./pdf";

type Sql = ReturnType<typeof db>;
export type ImportReport = { counts: Record<string, number>; problems: string[]; notes: string[] };

const clean = (s: string) => s.replace(/\s+/g, " ").trim();
const SECTIONS = ["What it does.", "Founder assessment.", "Risks and open questions."] as const;

type Memo = { number: number; company: string; sector: string; stage: string; source: string;
  decision: "funded" | "passed"; whatItDoes: string; founder: string; hidden: string; why: string };

export function parseMemos(text: string): { memos: Memo[]; problems: string[] } {
  const memos: Memo[] = [];
  const problems: string[] = [];
  const heads = [...text.matchAll(/^Memo (\d+): (.+)$/gm)];
  heads.forEach((h, i) => {
    const label = `Memo ${h[1]} (${h[2].trim()})`;
    const body = clean(text.slice(h.index! + h[0].length, heads[i + 1]?.index ?? text.length));
    const hd = body.match(/^Sector: (.+?) \| Stage: (.+?) \| Source: (.+?) \| Decision: (INVESTED|PASSED)\s*/);
    if (!hd) return void problems.push(`${label}: could not find the Sector / Stage / Source / Decision line.`);
    // Split on the four section labels; parts = ["", label, text, label, text, ...]
    const parts = body.slice(hd[0].length).split(/(What it does\.|Founder assessment\.|Risks and open questions\.|Why we (?:invested|passed)\.)/);
    const sec = new Map<string, string>();
    for (let k = 1; k < parts.length; k += 2) sec.set(parts[k], parts[k + 1].trim());
    const whyLabel = hd[4] === "INVESTED" ? "Why we invested." : "Why we passed.";
    const missing = [...SECTIONS, whyLabel].filter((l) => !sec.get(l));
    if (missing.length) return void problems.push(`${label}: missing or empty section(s): ${missing.join(", ")}`);
    memos.push({
      number: Number(h[1]), company: h[2].trim(), sector: hd[1], stage: hd[2], source: hd[3],
      decision: hd[4] === "INVESTED" ? "funded" : "passed",
      whatItDoes: sec.get("What it does.")!,
      founder: sec.get("Founder assessment.")!,
      hidden: [`Founder assessment. ${sec.get("Founder assessment.")}`, `Risks and open questions. ${sec.get("Risks and open questions.")}`,
        `${whyLabel} ${sec.get(whyLabel)}`].join("\n\n"),
      why: sec.get(whyLabel)!,
    });
  });
  if (!heads.length) problems.push("No 'Memo N:' headings found in the deal memos file.");
  return { memos, problems };
}

export function parseNotes(text: string): { meetings: { n: number; title: string; body: string }[]; problems: string[] } {
  const heads = [...text.matchAll(/^Meeting (\d+) - (.+)$/gm)];
  const meetings = heads.map((h, i) => ({
    n: Number(h[1]), title: h[2].trim(), body: text.slice(h.index! + h[0].length, heads[i + 1]?.index ?? text.length).trim(),
  }));
  return { meetings, problems: meetings.length ? [] : ["No 'Meeting N - title' headings found in the partner notes."] };
}

async function read(dir: string, file: string): Promise<string[]> {
  const pages = await pdfPages(new Uint8Array(readFileSync(join(dir, file))));
  if (pages.join("").trim().length < 200) throw new Error("no readable text (a scanned image?)");
  return pages;
}

export async function importData(dir: string, sql: Sql): Promise<ImportReport> {
  const problems: string[] = [];
  const notes: string[] = [];
  const files = readdirSync(dir).filter((f) => !f.startsWith("."));
  const used = new Set<string>();

  // 1. Applications: <Company>_Deck.pdf + <Company>_Form*.pdf
  const decks = new Map<string, string>();
  const forms = new Map<string, string>();
  for (const f of files) {
    const d = f.match(/^(.+)_Deck\.pdf$/i);
    const fm = f.match(/^(.+)_Form( Response)?\.pdf$/i);
    if (d) decks.set(d[1], f);
    else if (fm) forms.set(fm[1], f);
  }
  for (const company of [...new Set([...decks.keys(), ...forms.keys()])].sort()) {
    const deckFile = decks.get(company), formFile = forms.get(company);
    if (!deckFile || !formFile) { problems.push(`${company}: missing its ${deckFile ? "form" : "deck"} file, so the application was not loaded.`); continue; }
    used.add(deckFile).add(formFile);
    try {
      const deck = await read(dir, deckFile);
      const form = await read(dir, formFile);
      if (!clean(form.join(" ")).toLowerCase().includes(company.toLowerCase()))
        notes.push(`${company}: the form text does not mention "${company}" by name. Loaded anyway; please check the pairing.`);
      const mark = (kind: string, pages: string[]) => pages.map((t, i) => `[${kind} page ${i + 1}]\n${t}`).join("\n\n");
      const formJson = JSON.stringify({ deck_file: deckFile, form_file: formFile, text: mark("Form", form) });
      await sql`insert into applications (company_name, deck_text, form_responses)
        values (${company}, ${mark("Deck", deck)}, ${formJson}::jsonb)
        on conflict (company_name) do update set deck_text = excluded.deck_text, form_responses = excluded.form_responses`;
    } catch (e) {
      problems.push(`${company}: could not read the deck or form (${e instanceof Error ? e.message : e}).`);
    }
  }

  // 2. Deal memos
  const memoFile = files.find((f) => /deal memos/i.test(f));
  if (!memoFile) problems.push("No file with 'Deal Memos' in its name was found.");
  else {
    used.add(memoFile);
    try {
      const { memos, problems: mp } = parseMemos((await read(dir, memoFile)).join("\n"));
      problems.push(...mp);
      for (const m of memos) {
        const [deal] = (await sql`insert into past_deals (company_name, sector, stage, source_channel, original_application, partner_memo, founder_text)
          values (${m.company}, ${m.sector}, ${m.stage}, ${m.source}, ${m.whatItDoes}, ${m.hidden}, ${m.founder})
          on conflict (company_name) do update set sector = excluded.sector, stage = excluded.stage,
            source_channel = excluded.source_channel, original_application = excluded.original_application,
            partner_memo = excluded.partner_memo, founder_text = excluded.founder_text returning id`) as { id: number }[];
        await sql`insert into partner_decisions (past_deal_id, decision, partner_note)
          values (${deal.id}, ${m.decision}, ${m.why})
          on conflict (past_deal_id) do update set decision = excluded.decision, partner_note = excluded.partner_note`;
      }
    } catch (e) {
      problems.push(`${memoFile}: could not read (${e instanceof Error ? e.message : e}).`);
    }
  }

  // 3. Partner meeting notes
  const notesFile = files.find((f) => /partner meeting notes/i.test(f));
  if (!notesFile) problems.push("No file with 'Partner Meeting Notes' in its name was found.");
  else {
    used.add(notesFile);
    try {
      const { meetings, problems: np } = parseNotes((await read(dir, notesFile)).join("\n"));
      problems.push(...np);
      for (const m of meetings)
        await sql`insert into partner_notes (meeting, title, body) values (${m.n}, ${m.title}, ${m.body})
          on conflict (meeting) do update set title = excluded.title, body = excluded.body`;
    } catch (e) {
      problems.push(`${notesFile}: could not read (${e instanceof Error ? e.message : e}).`);
    }
  }

  for (const f of files) if (!used.has(f)) problems.push(`${f}: not recognised as an application deck, form, deal memos or partner notes, so it was ignored.`);

  const n = async (rows: Promise<unknown>) => ((await rows) as { n: number }[])[0].n;
  const counts = {
    applications: await n(sql`select count(*)::int as n from applications`),
    past_deals: await n(sql`select count(*)::int as n from past_deals`),
    "decisions: funded": await n(sql`select count(*)::int as n from partner_decisions where decision = 'funded'`),
    "decisions: passed": await n(sql`select count(*)::int as n from partner_decisions where decision = 'passed'`),
    partner_notes: await n(sql`select count(*)::int as n from partner_notes`),
  };
  return { counts, problems, notes };
}
