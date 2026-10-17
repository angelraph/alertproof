// Learned formats: Gemma teaches, the template repeats.
// A shop's alerts come from one or two banks, in the same layout every time. After Gemma has read
// an alert and grounding has confirmed every value, we remember the words that sit right before
// each value ("Avail Bal: NGN"). The next alert in that layout is read by finding those words,
// in a few milliseconds. Anything that doesn't fit exactly goes back to Gemma.
import { toKobo } from './money.js';
import { features } from './fingerprint.js';

const KEEP = 6;            // prefixes remembered per field
const MAXP = 28;           // longest prefix kept
const CREDIT = /\bCR\b|credit|received|money in|credited|deposit|inflow/i;
const DEBIT = /\bDR\b|debit|you paid|money out|debited|withdraw|purchase|outflow/i;
const NUM = /^\s*(?:NGN|₦|N(?=\s?\d))?\s*(\d[\d,]*(?:\.\d{1,2})?)/;
const DATE = /^\s*(\d{1,4}[-\/.](?:\d{1,2}|[A-Za-z]{3})[-\/.]\d{2,4}(?:[ T]\d{1,2}:\d{2}(?::\d{2})?(?:\s?[AP]M)?)?)/i;

export const signature = text => {
  const f = features(text);
  // Only each label's last word ("avail bal" -> "bal"), so customer names before a label don't count.
  return [...new Set(f.labels.map(l => l.split(/\s+/).pop()))].sort().join('|') + '#' + f.currency;
};

// The text just before position i, cut at the last line break, full stop, or digit,
// so a learned prefix holds label words, not the previous value.
function prefixAt(text, i) {
  let p = text.slice(Math.max(0, i - MAXP), i);
  const cut = Math.max(p.lastIndexOf('\n'), p.search(/[.;|](?=[^.;|]*$)/), p.search(/\d(?=\D*$)/));
  if (cut >= 0) p = p.slice(cut + 1);
  // A run of capitals before a label is a name ("TRF FROM EMEKA NWOSU Bal:"): keep only the label.
  return p.replace(/^.*\b[A-Z]{2,}(?: [A-Z]{2,})+ (?=[A-Z][a-z])/, '');
}

// Longest common ending of several prefixes: what stays the same is the label.
function commonSuffix(list) {
  if (!list.length) return '';
  let s = list[0];
  for (const p of list.slice(1)) { let k = 0; while (k < s.length && k < p.length && s[s.length - 1 - k] === p[p.length - 1 - k]) k++; s = s.slice(s.length - k); }
  // Too short to be a label ("/", " "): no anchor, so this field is left to Gemma.
  return s.trim().length >= 2 ? s : '';
}

// Where each grounded value sits in the text it came from.
function locate(text, reading) {
  const at = {};
  for (const field of ['amount', 'balance']) {
    if (reading[field] == null) continue;
    const hits = [...text.matchAll(/\d[\d,]*(?:\.\d{1,2})?/g)].filter(m => toKobo(m[0]) === reading[field]);
    if (hits.length !== 1 && !(field === 'balance' && hits.length)) return null;
    // If amount and balance are the same number, they're ambiguous: don't learn from this one.
    const m = field === 'balance' ? hits.at(-1) : hits[0];
    let i = m.index;
    const cur = text.slice(Math.max(0, i - 4), i).match(/(NGN|₦|N)\s?$/);
    if (cur) i -= cur[0].length;
    at[field] = prefixAt(text, i) + (cur ? cur[0] : '');
  }
  if (at.amount != null && at.amount === at.balance) return null;
  if (reading.account_tail) {
    const m = [...text.matchAll(/[0-9*Xx.]*[*Xx.][0-9*Xx.]*\d|\b\d{3,}\b/g)].find(x => x[0].replace(/\D/g, '').endsWith(reading.account_tail) && /[*Xx.]/.test(x[0]));
    if (m) at.account_tail = prefixAt(text, m.index);
  }
  if (reading.reference) {
    const i = text.indexOf(reading.reference);
    if (i >= 0 && text.indexOf(reading.reference, i + 1) < 0) at.reference = text.slice(Math.max(0, i - MAXP), i).split('\n').pop();
  }
  const d = [...text.matchAll(/\d{1,4}[-\/.](?:\d{1,2}|[A-Za-z]{3})[-\/.]\d{2,4}/g)];
  if (d.length === 1) at.time = prefixAt(text, d[0].index);
  return at;
}

function find(text, anchor, grab) {
  if (!anchor || anchor.trim().length < 2) return undefined;
  let i = -1, out;
  while ((i = text.indexOf(anchor, i + 1)) >= 0) {
    const m = text.slice(i + anchor.length).match(grab);
    if (m) { if (out !== undefined) return undefined; out = m[1]; }
  }
  return out;
}

// templates: { [signature]: { sig, bank, samples: [{ text, reading }], prefixes: { field: [..] } } }
// Returns the updated template for this format, or null if this reading can't teach one safely.
export function learn(templates, text, reading) {
  if (reading.amount == null || reading.balance == null || !reading.direction) return null;
  const at = locate(text, reading);
  if (!at) return null;
  const sig = signature(text);
  const t = templates[sig] ? structuredClone(templates[sig]) : { sig, bank: reading.bank || '', samples: [], prefixes: {} };
  for (const [f, p] of Object.entries(at)) (t.prefixes[f] ||= []).push(p);
  for (const f of Object.keys(t.prefixes)) t.prefixes[f] = t.prefixes[f].slice(-KEEP);
  t.samples = [...t.samples, { text, reading: pickFields(reading) }].slice(-KEEP);
  if (reading.bank) t.bank = reading.bank;
  // Only keep it if it reads every alert it learned from exactly as Gemma did.
  for (const s of t.samples) {
    const r = apply({ [sig]: t }, s.text);
    if (!r || ['amount', 'balance', 'direction'].some(k => r[k] !== s.reading[k])) {
      // A newer sample can disagree with older ones (a bank changed its wording): start again from this one.
      if (t.samples.length > 1) return learn({}, text, reading);
      return null;
    }
  }
  templates[sig] = t;
  return t;
}

const pickFields = r => ({ amount: r.amount, balance: r.balance, direction: r.direction, account_tail: r.account_tail, reference: r.reference, counterparty: r.counterparty, time: r.time, bank: r.bank });

// Reads an alert with a learned format. Returns a reading, or null when Gemma should read it.
export function apply(templates, text) {
  const t = templates[signature(text)];
  if (!t) return null;
  const anchor = f => commonSuffix(t.prefixes[f] || []);
  const amount = find(text, anchor('amount'), NUM);
  const balance = find(text, anchor('balance'), NUM);
  if (amount === undefined || balance === undefined) return null;
  const cr = CREDIT.test(text), dr = DEBIT.test(text);
  let direction = cr !== dr ? (cr ? 'CR' : 'DR') : null;
  // Both words present (UBA ends every balance with "CR"): use the word that sits where the
  // learned samples' direction word sat, or give up and let Gemma read it.
  if (!direction) {
    const lead = text.slice(0, 40);
    const lc = CREDIT.test(lead), ld = DEBIT.test(lead);
    if (lc === ld) return null;
    direction = lc ? 'CR' : 'DR';
  }
  const acct = find(text, anchor('account_tail'), /^\s*([0-9*Xx.]*\d)/);
  const tail = acct ? (acct.match(/\d+$/) || [''])[0] : null;
  const reference = find(text, anchor('reference'), /^([A-Za-z0-9]{6,})/) || null;
  const time = find(text, anchor('time'), DATE) || '';
  const name = (text.match(/\b(?:FROM|from|to|TO)\s+([A-Za-z][A-Za-z '.-]{2,40}?)(?=[\/\n.]|\s+(?:to|from|Bal|Ref)\b|$)/) || [])[1] || '';
  return { bank: t.bank, direction, amount: toKobo(amount), balance: toKobo(balance), account_tail: tail && tail.length >= 2 ? tail : null, counterparty: name.trim(), reference, time };
}
