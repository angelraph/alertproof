// Pasted bank emails are mostly packaging: logos, links, "Customer care line", "Copyright",
// security warnings. Only a few lines carry the transaction. This keeps those lines, word for
// word, so the model reads less and nothing it reads is invented: every kept line is from the alert.

const FOOTER = /copyright|all rights? reserved|customer care|disclaimer|unsubscribe|do not reply|never (call|ask|request)|remember:|for enquiries|download (the|our) app|follow us|this e-?mail|privacy policy|terms (and|&) conditions|contact (us|centre|center)|^\s*thank you for (banking|choosing)/i;
const JUNK = /^\s*(\[\]\([^)]*\)\s*)+$|^\s*https?:\/\/\S+\s*$|^\s*[|\s]*$/;
const USEFUL = /\d|amount|amt|balance|bal\b|credit|debit|\bcr\b|\bdr\b|acct|account|date|time|ref|session|from|to\b|desc|narration|transaction|status|success|received|sent|transfer|naira|ngn|₦/i;

export function focus(text, max = 1600) {
  const lines = String(text).replace(/\r\n?/g, '\n').split('\n').map(l => l.replace(/\s+$/, ''));
  // Cut the footer: the first footer line after the first line holding money, and everything below it.
  const firstMoney = lines.findIndex(l => /\d[\d,]*\.\d{2}|NGN|₦/.test(l));
  let end = lines.length;
  if (firstMoney >= 0) {
    const f = lines.findIndex((l, i) => i > firstMoney && FOOTER.test(l));
    if (f > 0) {
      // Keep going if a money line appears after the footer marker (some emails put it mid-body).
      const moneyAfter = lines.slice(f).some(l => /balance|\bbal\b/i.test(l) && /\d/.test(l));
      if (!moneyAfter) end = f;
    }
  }
  let kept = lines.slice(0, end).filter(l => !JUNK.test(l));
  let out = kept.join('\n').replace(/\n{3,}/g, '\n\n').trim();
  if (out.length <= max) return out;
  // Still long: keep lines that can hold a transaction field, with one line of context each side.
  const keep = new Set();
  kept.forEach((l, i) => { if (USEFUL.test(l) && !FOOTER.test(l)) [i - 1, i, i + 1].forEach(k => k >= 0 && k < kept.length && keep.add(k)); });
  out = kept.filter((_, i) => keep.has(i)).join('\n').replace(/\n{3,}/g, '\n\n').trim();
  return out.length > 3000 ? out.slice(0, 3000) : out;
}
