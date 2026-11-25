"use server";

import { revalidatePath } from "next/cache";
import { db } from "@/lib/db";

export async function addCompany(f: FormData) {
  const name = String(f.get("name") ?? "").trim();
  const description = String(f.get("description") ?? "").trim();
  if (!name) throw new Error("Enter the company name.");
  await db()`insert into portfolio_companies (name, description, source_url) values (${name}, ${description || null}, 'added by hand')
             on conflict (lower(name)) do update set description = coalesce(excluded.description, portfolio_companies.description)`;
  revalidatePath("/portfolio");
}

export async function removeCompany(f: FormData) {
  await db()`delete from portfolio_companies where id = ${Number(f.get("id"))}`;
  revalidatePath("/portfolio");
}
