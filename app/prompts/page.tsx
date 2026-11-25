import Link from "next/link";
import { PROMPTS } from "@/lib/prompts";

export default function PromptsPage() {
  return (
    <main className="mx-auto max-w-4xl p-8">
      <Link href="/" className="text-sm text-zinc-500">← Applications</Link>
      <h1 className="mt-2 text-2xl font-semibold">Prompt register</h1>
      <p className="mt-1 text-sm text-zinc-600">Every prompt the app sends to a model. Read-only. Emails, phone numbers, PAN and Aadhaar numbers are removed from every prompt before it is sent.</p>
      <table className="mt-4 w-full text-sm">
        <thead className="text-left text-xs text-zinc-500"><tr><th className="py-1 pr-3">Step</th><th className="pr-3">What goes in</th><th className="pr-3">Personal data</th><th>Must never</th></tr></thead>
        <tbody className="divide-y align-top">
          {PROMPTS.map((p) => (
            <tr key={p.step}>
              <td className="py-2 pr-3"><span className="font-medium">{p.step}</span><br /><span className="text-xs text-zinc-500">{p.version}</span><br /><span className="text-xs text-zinc-500">{p.model}</span></td>
              <td className="pr-3">{p.goesIn}</td>
              <td className="pr-3">{p.personal}</td>
              <td>{p.never}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </main>
  );
}
