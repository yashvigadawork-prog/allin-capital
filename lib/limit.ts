// Step 17: the daily spend limit lives here, in code (Portkey budget caps are not used). Days are Indian days.
import { db } from "./db";
import { setting } from "./settings";

type Sql = ReturnType<typeof db>;
export const DEFAULT_DAILY_LIMIT_INR = 500;

export async function spentTodayInr(sql: Sql): Promise<number> {
  const rows = (await sql`select coalesce(sum(cost_inr), 0) as inr from decision_log
    where (created_at at time zone 'Asia/Kolkata')::date = (now() at time zone 'Asia/Kolkata')::date`) as { inr: string }[];
  return Number(rows[0]?.inr ?? 0);
}

export async function dailyLimitInr(sql: Sql): Promise<number> {
  const v = Number(await setting(sql, "daily_limit_inr", String(DEFAULT_DAILY_LIMIT_INR)));
  return v > 0 ? v : DEFAULT_DAILY_LIMIT_INR;
}

/** Throws a plain message once today's model spend has reached the limit. Checked before every model call. */
export async function assertUnderLimit(sql: Sql): Promise<void> {
  const [spent, limit] = [await spentTodayInr(sql), await dailyLimitInr(sql)];
  if (spent >= limit)
    throw new Error(`The daily spending limit is reached (INR ${spent.toFixed(2)} of INR ${limit.toFixed(2)} today). Nothing more will run until tomorrow, or raise the limit on the Criteria page.`);
}

export const DEFAULT_APP_CEILING_INR = 25;

export async function limitStatus(sql: Sql): Promise<{ spent: number; limit: number; pct: number }> {
  const [spent, limit] = [await spentTodayInr(sql), await dailyLimitInr(sql)];
  return { spent, limit, pct: (spent / limit) * 100 };
}

/** The queue stops taking new jobs once the day's limit is reached. */
export async function overLimit(sql: Sql): Promise<boolean> {
  return (await limitStatus(sql)).pct >= 100;
}

/** Applications whose total model cost is above the per-application ceiling (a setting). Flag only, nothing is stopped. */
export async function costlyApplications(sql: Sql): Promise<{ id: number; company_name: string; inr: number }[]> {
  const ceiling = Number(await setting(sql, "app_cost_ceiling_inr", String(DEFAULT_APP_CEILING_INR))) || DEFAULT_APP_CEILING_INR;
  const rows = (await sql`select a.id, a.company_name, sum(d.cost_inr) as inr from decision_log d join applications a on a.id = d.application_id
    where d.decision = 'model call ok' group by a.id, a.company_name having sum(d.cost_inr) > ${ceiling} order by sum(d.cost_inr) desc`) as { id: number; company_name: string; inr: string }[];
  return rows.map((r) => ({ id: r.id, company_name: r.company_name, inr: Number(r.inr) }));
}

/** Average model cost of an application that has been processed so far, a projection for the next one. */
export async function projectedPerApplicationInr(sql: Sql): Promise<number | null> {
  const [r] = (await sql`select sum(cost_inr) as inr, count(distinct application_id) as n from decision_log where decision = 'model call ok' and application_id is not null`) as { inr: string | null; n: string }[];
  return r && Number(r.n) > 0 ? Number(r.inr) / Number(r.n) : null;
}
