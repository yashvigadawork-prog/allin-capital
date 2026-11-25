import { extractText, getDocumentProxy } from "unpdf";

/** Text of each page of a PDF, in page order. Used for the case files now and for uploads later. */
export async function pdfPages(bytes: Uint8Array): Promise<string[]> {
  const pdf = await getDocumentProxy(bytes);
  const { text } = await extractText(pdf, { mergePages: false });
  return text.map((t) => t.trim());
}
