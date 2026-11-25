// Step 14: a database queue. Jobs are claimed one at a time by a limited number of workers, so many applications
// can be queued at once without hitting model rate limits. A failed job is retried, then stops with its reason.
import { db } from "./db";
import { extractApplication } from "./extract";
import { overLimit } from "./limit";
import { researchApplication } from "./research";
import { scoreApplication } from "./score";
import { setting } from "./settings";

type Sql = ReturnType<typeof db>;
type Result = { ok: boolean; error?: string };
export type Runners = Record<"extract" | "research" | "score", (id: number) => Promise<Result>>;
type Job = { id: number; application_id: number; kind: keyof Runners; attempts: number };

const real: Runners = { extract: (id) => extractApplication(id), research: (id) => researchApplication(id), score: (id) => scoreApplication(id) };

/** Three chained jobs per application. An application that already has unfinished jobs is skipped. */
export async function enqueue(sql: Sql, applicationIds: number[]): Promise<number> {
  let added = 0;
  for (const id of applicationIds) {
    const [busy] = (await sql`select 1 as x from jobs where application_id = ${id} and status in ('queued', 'running') limit 1`) as unknown[];
    if (busy) continue;
    const [a] = (await sql`insert into jobs (application_id, kind) values (${id}, 'extract') returning id`) as { id: number }[];
    const [b] = (await sql`insert into jobs (application_id, kind, after_job) values (${id}, 'research', ${a.id}) returning id`) as { id: number }[];
    await sql`insert into jobs (application_id, kind, after_job) values (${id}, 'score', ${b.id})`;
    added++;
  }
  return added;
}

async function claim(sql: Sql): Promise<Job | null> {
  // A worker that died mid-job leaves it "running"; after 15 minutes it goes back in the queue.
  await sql`update jobs set status = 'queued' where status = 'running' and started_at < now() - interval '15 minutes'`;
  const [j] = (await sql`update jobs set status = 'running', attempts = attempts + 1, started_at = now()
    where id = (select j.id from jobs j where j.status = 'queued'
        and (j.after_job is null or exists (select 1 from jobs p where p.id = j.after_job and p.status = 'done'))
      order by j.id for update skip locked limit 1)
    returning id, application_id, kind, attempts`) as Job[];
  return j ?? null;
}

async function finish(sql: Sql, job: Job, error: string | null, maxAttempts: number) {
  if (!error) {
    await sql`update jobs set status = 'done', error = null, finished_at = now() where id = ${job.id}`;
  } else if (job.attempts < maxAttempts) {
    await sql`update jobs set status = 'queued', error = ${`Attempt ${job.attempts} failed, trying again: ${error}`} where id = ${job.id}`;
  } else {
    await sql`update jobs set status = 'failed', error = ${error}, finished_at = now() where id = ${job.id}`;
    // Later steps of the same application can never run, so stop them with a visible reason.
    await sql`with recursive later as (select id from jobs where after_job = ${job.id} union select j.id from jobs j join later l on j.after_job = l.id)
      update jobs set status = 'failed', error = ${`Not run: the ${job.kind} step failed.`}, finished_at = now() where id in (select id from later)`;
  }
}

/** Runs queued jobs until none are runnable, with at most `queue_concurrency` at the same time. */
export async function runQueue(deps: { sql?: Sql; runners?: Runners } = {}): Promise<{ done: number; failed: number }> {
  const sql = deps.sql ?? db();
  const run = deps.runners ?? real;
  const workers = Math.max(1, Math.min(10, Number(await setting(sql, "queue_concurrency", "3")) || 3));
  const maxAttempts = Math.max(1, Number(await setting(sql, "job_max_attempts", "2")) || 2);
  await Promise.all(
    Array.from({ length: workers }, async () => {
      // At the daily limit the queue pauses: unstarted jobs stay queued until the limit is raised and the queue is resumed.
      while (!(await overLimit(sql))) {
        const job = await claim(sql);
        if (!job) break;
        let error: string | null = null;
        try {
          const r = await run[job.kind](job.application_id);
          if (!r.ok) error = r.error ?? "The step failed without a reason.";
        } catch (e) {
          error = e instanceof Error ? e.message.slice(0, 300) : "Unknown error";
        }
        await finish(sql, job, error, maxAttempts);
      }
    }),
  );
  const [c] = (await sql`select (count(*) filter (where status = 'done'))::int as done, (count(*) filter (where status = 'failed'))::int as failed from jobs`) as { done: number; failed: number }[];
  return c;
}
