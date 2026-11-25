// Removes personal contact details before application text reaches a model.
// shortcut: emails (incl. UPI ids), Indian phone numbers, PAN and Aadhaar numbers. Not names, addresses or bank accounts: names are needed to research founders.
// callModel applies this to every prompt, so no caller can forget it.
export function redact(text: string): string {
  return text
    .replace(/[\w.+-]+@[\w-]+(?:\.[\w-]+)*/g, "[email removed]") // a UPI id such as name@bank has no dot
    .replace(/\+\d{1,3}[ -]?\d[\d -]{7,}\d/g, "[phone removed]") // international, starts with +
    .replace(/(?<![\d.])(?:91[ -]?)?[6-9]\d{4}[ -]?\d{5}(?!\d|\.\d)/g, "[phone removed]") // Indian 10-digit mobile
    .replace(/\b[A-Z]{5}\d{4}[A-Z]\b/g, "[PAN removed]")
    .replace(/(?<![\d.,])(?!(?:19|20)\d\d[ -](?:19|20)\d\d)[2-9]\d{3}[ -]?\d{4}[ -]?\d{4}(?![\d,]|\.\d)/g, "[ID number removed]"); // 12-digit Aadhaar, spaced or not; a row of years is left alone
}
