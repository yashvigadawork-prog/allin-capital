// Riya's corrections: saved with a reason, found again for similar companies, and switched off by a kill rule if they stop helping.
import { db } from "./db";
import { setting } from "./settings";

type Sql = ReturnType<typeof db>;

export type Example = { id: number; criterion_id: number; company: string; sector: string | null; stage: string | null; old_score: number | null; new_score: number; reason: string };

const PER_CRITERION = 3;
const STOP = new Set(["and", "the", "for", "with", "tech", "services", "platform"]);
const words = (s: unknown) => new Set(String(s ?? "").toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length >= 3 && !STOP.has(w)));

/** Saves one correction and changes the score. Throws plain-words errors for bad input. */
export async function saveCorrection(sql: Sql, scoreId: number, newScore: number, reason: string) {
  const why = reason.trim().slice(0, 300);
  if (!Number.isInteger(newScore) || newScore < 1 || newScore > 5) throw new Error("The corrected score must be a whole number from 1 to 5.");
  if (!why) throw new Error("Write a one-line reason. It is what makes the correction reusable.");
  const [s] = (await sql`select s.application_id, s.criterion_id, s.score, e.fields->>'sector' as sector, e.fields->>'stage' as stage
    from scores s left join extracted_fields e on e.application_id = s.application_id where s.id = ${scoreId}`) as
    { application_id: number; criterion_id: number; score: number | null; sector: string | null; stage: string | null }[];
  if (!s) throw new Error("That score was not found. Score the application again.");
  if (s.score === newScore) throw new Error("That is already the score.");
  await sql`insert into corrections (score_id, criterion_id, application_id, old_score, new_score, reason, sector, stage)
    values (${scoreId}, ${s.criterion_id}, ${s.application_id}, ${s.score}, ${newScore}, ${why}, ${s.sector}, ${s.stage})`;
  await sql`update scores set score = ${newScore} where id = ${scoreId}`;
}

/** Corrections made on other applications with a shared sector word, best first. Same stage ranks higher. At most 3 per criterion, not just the newest. */
export async function similarCorrections(sql: Sql, applicationId: number, fields: Record<string, unknown> | null): Promise<Example[]> {
  if (!fields) return [];
  const mine = words(fields.sector);
  if (!mine.size) return [];
  const stage = String(fields.stage ?? "").trim().toLowerCase();
  const rows = (await sql`select c.id, c.criterion_id, a.company_name as company, c.sector, c.stage, c.old_score, c.new_score, c.reason
    from corrections c join applications a on a.id = c.application_id where c.application_id <> ${applicationId}`) as Example[];
  const ranked = rows
    .map((r) => ({ r, shared: [...words(r.sector)].filter((w) => mine.has(w)).length, sameStage: !!stage && (r.stage ?? "").trim().toLowerCase() === stage }))
    .filter((x) => x.shared > 0)
    .sort((a, b) => b.shared - a.shared || +b.sameStage - +a.sameStage || b.r.id - a.r.id);
  const taken: Record<number, number> = {};
  return ranked.filter(({ r }) => (taken[r.criterion_id] = (taken[r.criterion_id] ?? 0) + 1) <= PER_CRITERION).map((x) => x.r);
}

export type Learning = { on: boolean; why: string; shown: number; changedAgain: number };

/**
 * The kill rule. Of the scores made while corrections were shown to the scorer, how many did Riya correct again?
 * At or above the rate in settings (and with enough scores to judge), the examples are no longer given to the scorer.
 * Nothing is deleted, so turning it back on, or dropping the rate, restores the learning.
 */
export async function learningStatus(sql: Sql): Promise<Learning> {
  const [n] = (await sql`select count(*)::int as shown,
      count(*) filter (where exists (select 1 from corrections c where c.score_id = s.id and c.created_at >= s.created_at))::int as changed
    from scores s where cardinality(s.example_ids) > 0`) as { shown: number; changed: number }[];
  const base = { shown: n.shown, changedAgain: n.changed };
  if ((await setting(sql, "learning_enabled", "on")) === "off") return { on: false, why: "Switched off in settings.", ...base };
  const rate = Math.max(0, Math.min(100, Number(await setting(sql, "learning_kill_rate", "50")) || 50));
  const min = Math.max(1, Number(await setting(sql, "learning_kill_min", "5")) || 5);
  if (n.shown >= min && (n.changed / n.shown) * 100 >= rate)
    return { on: false, why: `Riya corrected ${n.changed} of ${n.shown} scores that used past corrections (limit ${rate}%). Learning is off until the limit is raised.`, ...base };
  return { on: true, why: n.shown ? `Riya corrected ${n.changed} of ${n.shown} scores that used past corrections (limit ${rate}%).` : "No score has used a past correction yet.", ...base };
}
