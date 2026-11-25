"use client";

import { logBookingLink } from "@/app/actions";

export function BookButtons({ id, url }: { id: number; url: string }) {
  return (
    <div className="mt-3 flex items-center gap-3">
      <a href={url} target="_blank" rel="noreferrer" onClick={() => void logBookingLink(id, "opened")} className="rounded bg-black px-3 py-1 text-sm text-white">Book intro call</a>
      <button type="button" onClick={() => { void navigator.clipboard.writeText(url); void logBookingLink(id, "copied"); }} className="rounded border px-3 py-1 text-sm">Copy link</button>
    </div>
  );
}
