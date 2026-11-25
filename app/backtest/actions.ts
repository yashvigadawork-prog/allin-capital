"use server";

import { revalidatePath } from "next/cache";
import { runBacktest } from "@/lib/backtest";

export async function run() {
  await runBacktest();
  revalidatePath("/backtest");
}

export async function runFacts() {
  await runBacktest({}, 3, "facts");
  revalidatePath("/backtest");
}
