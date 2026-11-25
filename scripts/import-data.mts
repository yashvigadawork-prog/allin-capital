// Loads the case PDFs in data/ into the database. Run: npm run import   (needs DATABASE_URL in .env.local)
import { db } from "../lib/db";
import { importData } from "../lib/importData";

const r = await importData("data", db());
console.log("Rows now in the database:");
for (const [k, v] of Object.entries(r.counts)) console.log(`  ${k}: ${v}`);
for (const n of r.notes) console.log(`Note: ${n}`);
if (r.problems.length) {
  console.log(`\n${r.problems.length} problem(s), these were NOT loaded or need a look:`);
  for (const p of r.problems) console.log(`  - ${p}`);
  process.exit(1);
}
console.log("\nEvery file was read and loaded.");
