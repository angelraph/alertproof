// The backup reader. Gemma reads every alert first; this only runs when Gemma can't answer
// (no network, the hosted model is down or slow). It reads the labels banks commonly print
// ("Amount", "Avail Bal", "Acct") with plain rules, and its reading goes through exactly the same
// grounding and balance chain. A trader at the counter never gets an error instead of an answer.

const MONEY = String.raw`(?:NGN|₦|₩|N(?=\s?-?\d))?\s*(-?[\d,]+(?:\.\d{1,2})?)`;
const SEP = String.raw`\s*[:|=]?\s*`;
const first = (text, patterns) => { for (const re of patterns) { const m = text.match(re); if (m) return m[m.length - 1]; } return ''; };

export function fallbackRead(text) {
  const t = String(text);
  const amount = first(t, [
    new RegExp(String.raw`\b(?:cr|dr)?\s*(?:amount|amt)\b${SEP}${MONEY}`, 'i'),
    new RegExp(String.raw`\b(?:you have received|you received|received|you paid|paid|credit|debit|money in|money out)\b${SEP}${MONEY}`, 'i'),
    new RegExp(String.raw`(?:^|\s)\+\s*${MONEY}`, 'm'),
  ]);
  const balance = first(t, [
    new RegExp(String.raw`\bavail(?:able)?\.?\s*bal(?:ance)?\b${SEP}${MONEY}`, 'i'),
    new RegExp(String.raw`\bbalance is${SEP}${MONEY}`, 'i'),
    new RegExp(String.raw`\b(?:current\s*)?bal(?:ance)?\b${SEP}${MONEY}`, 'i'),
  ]);
  const head = t.slice(0, 60);
  const words = s => ({ cr: /\bCR\b|credit|received|money in|credited|inflow/i.test(s), dr: /\bDR\b|debit|you paid|money out|debited|purchase|outflow/i.test(s) });
  const typeRow = t.match(/transaction type\s*[:|]?\s*(credit|debit)/i)?.[1];
  let direction = typeRow ? (/credit/i.test(typeRow) ? 'CR' : 'DR') : '';
  if (!direction) { const w = words(t); if (w.cr !== w.dr) direction = w.cr ? 'CR' : 'DR'; }
  if (!direction) { const w = words(head); if (w.cr !== w.dr) direction = w.cr ? 'CR' : 'DR'; }
  const acct = first(t, [
    /\b(?:acct|account(?:\s*(?:number|no\.?))?|acc|ac)\b\s*[:|]?\s*([0-9*Xx.]*[*Xx.][0-9*Xx.]*\d)/i,
    /\b(?:to|recipient account)\s*[:|]?\s*\d{0,3}[*Xx]{2,}(\d{2,})\b/i,
  ]);
  const reference = first(t, [/\b(?:session id|ref(?:erence)?(?:\s*code)?|transaction id|txn id)\b\s*[:|]?\s*([A-Za-z0-9]{6,})/i]);
  const time = first(t, [/(\d{1,4}[-\/.](?:\d{1,2}|[A-Za-z]{3})[-\/.]\d{2,4}(?:[ T,]+\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?)?)/i, /(\d{1,2}:\d{2},?\s+[A-Za-z]{3}\s+\d{1,2},?\s+\d{4})/]);
  const counterparty = first(t, [/\b(?:from|sender)\b\s*[:|]?\s*([A-Za-z][A-Za-z .'-]{2,40}?)(?=\s*(?:[\/\n.|]|to\b|bal|ref|$))/i]);
  return { bank: '', direction, amount, balance, account_tail: (acct.match(/\d+$/) || [''])[0], counterparty, reference, time };
}
