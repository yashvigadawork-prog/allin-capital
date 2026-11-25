import { db } from "./db";

type Sql = ReturnType<typeof db>;

/** One setting from the settings table, or the fallback when it is missing. */
export async function setting(sql: Sql, key: string, fallback: string): Promise<string> {
  const rows = (await sql`select value from settings where key = ${key}`) as { value: string }[];
  return rows[0]?.value ?? fallback;
}
