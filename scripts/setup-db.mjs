// Creates the tables in Neon. Run: npm run db:setup
import { readFileSync } from "node:fs";
import { neon } from "@neondatabase/serverless";
import { config } from "dotenv";

config({ path: ".env.local" });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL is empty. Paste your Neon link into .env.local, then run this again.");
  process.exit(1);
}

const sql = neon(process.env.DATABASE_URL);
// Split on ';' at line end; the schema has no semicolons inside statements.
const statements = ["db/schema.sql", "db/seed.sql"]
  .flatMap((f) => readFileSync(f, "utf8").split(/;\s*$/m))
  .map((s) => s.trim())
  .filter(Boolean);

try {
  for (const s of statements) await sql.query(s);
  console.log("Done: tables, the criteria, the portfolio list and the settings are ready.");
} catch (e) {
  console.error("Could not set up the database:", e.message);
  process.exit(1);
}
