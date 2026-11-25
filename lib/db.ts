import { neon } from "@neondatabase/serverless";

// Throws a plain-words error if the Neon link is missing; pages catch it and show it.
export function db() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is empty. Paste your Neon link into .env.local and restart.");
  return neon(url);
}
