"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";
import { FIELDS } from "@/lib/extract";

// Trust boundary: the form is user input, so check it here, not just in the browser.
function read(f: FormData) {
  const name = String(f.get("name") ?? "").trim();
  const definition = String(f.get("definition") ?? "").trim();
  const source = String(f.get("source_url") ?? "").trim();
  if (!name || !definition) throw new Error("A criterion needs a name and a definition.");
  if (source && !/^https?:\/\//i.test(source)) throw new Error("The source link must start with http:// or https://");
  // The facts that must be stated for this criterion to be scored without a cap. Only known field names are allowed.
  const decisive = String(f.get("decisive_fields") ?? "").split(",").map((x) => x.trim()).filter(Boolean);
  const unknown = decisive.filter((x) => !(FIELDS as readonly string[]).includes(x));
  if (unknown.length) throw new Error(`Unknown field name(s): ${unknown.join(", ")}. Use: ${FIELDS.join(", ")}.`);
  return { name, definition, source: source || null, decisive };
}

export async function saveCriterion(f: FormData) {
  const { name, definition, source, decisive } = read(f);
  await db()`update criteria set name = ${name}, definition = ${definition}, source_url = ${source}, decisive_fields = ${decisive}::text[]
             where id = ${Number(f.get("id"))}`;
  revalidatePath("/settings");
}

export async function addCriterion(f: FormData) {
  const { name, definition, source, decisive } = read(f);
  await db()`insert into criteria (name, definition, source_url, decisive_fields) values (${name}, ${definition}, ${source}, ${decisive}::text[])`;
  revalidatePath("/settings");
}

export async function saveRate(f: FormData) {
  const rate = Number(f.get("usd_inr"));
  if (!Number.isFinite(rate) || rate <= 0) throw new Error("The rate must be a number above 0.");
  await db()`insert into settings (key, value) values ('usd_inr', ${String(rate)})
             on conflict (key) do update set value = excluded.value`;
  revalidatePath("/settings");
}

export async function saveRules(f: FormData) {
  const cap = Number(f.get("missing_evidence_cap"));
  if (!Number.isInteger(cap) || cap < 0 || cap > 5) throw new Error("The cap must be a whole number from 0 to 5. Use 0 for no cap.");
  const out = String(f.get("out_of_scope_sectors") ?? "").trim();
  const deep = String(f.get("deeptech_keywords") ?? "").trim();
  const rate = Number(f.get("learning_kill_rate"));
  const min = Number(f.get("learning_kill_min"));
  if (!Number.isFinite(rate) || rate < 0 || rate > 100) throw new Error("The kill rate must be a number from 0 to 100.");
  if (!Number.isInteger(min) || min < 1) throw new Error("The minimum number of scores must be a whole number, 1 or more.");
  const days = Number(f.get("followup_days"));
  if (!Number.isInteger(days) || days < 0) throw new Error("The follow-up wait must be a whole number of days, 0 or more.");
  const conc = Number(f.get("queue_concurrency"));
  if (!Number.isInteger(conc) || conc < 1 || conc > 10) throw new Error("The queue concurrency must be a whole number from 1 to 10.");
  const limit = Number(f.get("daily_limit_inr"));
  if (!Number.isFinite(limit) || limit <= 0) throw new Error("The daily limit must be a number above 0 (in rupees).");
  const ceiling = Number(f.get("app_cost_ceiling_inr"));
  if (!Number.isFinite(ceiling) || ceiling <= 0) throw new Error("The per-application ceiling must be a number above 0 (in rupees).");
  const learning = f.get("learning_enabled") === "on" ? "on" : "off";
  const sql = db();
  for (const [k, v] of [["missing_evidence_cap", String(cap)], ["out_of_scope_sectors", out], ["deeptech_keywords", deep], ["learning_kill_rate", String(rate)], ["learning_kill_min", String(min)], ["learning_enabled", learning], ["followup_days", String(days)], ["queue_concurrency", String(conc)], ["daily_limit_inr", String(limit)], ["app_cost_ceiling_inr", String(ceiling)]])
    await sql`insert into settings (key, value) values (${k}, ${v}) on conflict (key) do update set value = excluded.value`;
  revalidatePath("/settings");
}
