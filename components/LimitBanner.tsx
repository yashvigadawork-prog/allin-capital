import Link from "next/link";
import { db } from "@/lib/db";
import { limitStatus } from "@/lib/limit";

/** Shown on every page: amber from 80% of the daily limit, red when it is reached and the queue and model calls stop. */
export async function LimitBanner() {
  let s;
  try {
    s = await limitStatus(db());
  } catch {
    return null;
  }
  if (s.pct < 80) return null;
  const hit = s.pct >= 100;
  return (
    <div className={`px-4 py-2 text-center text-sm ${hit ? "bg-red-100 text-red-900" : "bg-amber-100 text-amber-900"}`}>
      {hit ? "Daily spending limit reached: the queue and all model calls are paused. " : "80% of the daily spending limit is used. "}
      ₹{s.spent.toFixed(2)} of ₹{s.limit.toFixed(0)} today.{" "}
      <Link href="/cost" className="underline">Cost page</Link>
      {hit && <> · To resume, Riya raises the limit on the <Link href="/settings" className="underline">Criteria page</Link>, then presses Resume queue.</>}
    </div>
  );
}
