// Deletes one application and everything kept about it: scores, research, drafts, replies, jobs, log rows and its Langfuse trace.
// Usage: npm run delete-founder -- <application id>        (run it within 30 days of a founder's request)
import { db } from "../lib/db";
import { traceIdFor } from "../lib/trace";

const id = Number(process.argv[2]);
if (!Number.isInteger(id)) throw new Error("Give the application id, for example: npm run delete-founder -- 7");
const sql = db();
const [a] = (await sql`select company_name from applications where id = ${id}`) as { company_name: string }[];
if (!a) throw new Error(`Application ${id} was not found.`);

await sql`delete from decision_log where application_id = ${id}`; // would otherwise stay, detached, with its reasons
await sql`delete from applications where id = ${id}`; // scores, research, drafts, replies, follow-ups, jobs and corrections go with it
console.log(`Deleted ${a.company_name} (application ${id}) from the database.`);

const { LANGFUSE_BASE_URL: base, LANGFUSE_PUBLIC_KEY: pk, LANGFUSE_SECRET_KEY: sk } = process.env;
if (base && pk && sk) {
  const r = await fetch(`${base.replace(/\/$/, "")}/api/public/traces/${traceIdFor(id)}`, { method: "DELETE", headers: { authorization: `Basic ${Buffer.from(`${pk}:${sk}`).toString("base64")}` } });
  console.log(r.ok ? "Deleted its Langfuse trace." : `Langfuse trace not deleted (HTTP ${r.status}); delete it in the Langfuse dashboard.`);
} else console.log("Langfuse is not set up here, so there is no trace to delete.");
