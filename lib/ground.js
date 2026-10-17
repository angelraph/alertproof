// Gemma reads the alert; this file checks every number it read is really in the alert.
// A field that fails is dropped, never trusted. The model can misread, it can't invent.
import { amountsIn } from './money.js';

const digits = s => String(s ?? '').replace(/\D/g, '');
const CREDIT = /\bCR\b|credit|received|money in|credited|deposit|inflow/i;
const DEBIT = /\bDR\b|debit|you paid|money out|debited|withdraw|purchase|outflow/i;

// reading: { amount, balance, account_tail, reference } as returned by the model (amounts in kobo).
// Returns { reading, rejected: [{ field, value, why }] } where rejected fields are set to null.
export function ground(reading, text) {
  const out = { ...reading };
  const rejected = [];
  const amounts = amountsIn(text);
  const runs = String(text).match(/\d+/g) || [];

  for (const field of ['amount', 'balance']) {
    const v = out[field];
    if (v == null) continue;
    if (!amounts.has(v)) {
      rejected.push({ field, value: v, why: 'not written in the alert' });
      out[field] = null;
    }
  }

  if (out.account_tail) {
    const tail = digits(out.account_tail);
    // Masked accounts ("0******821", "1XX..XX821") keep their last digits; those must be in the text.
    // The tail must end one of the alert's own digit runs ("0******821" has runs "0" and "821").
    // Some banks show only two digits after the mask ("01**765**32"); those count when a mask comes first.
    const masked = [...String(text).matchAll(/[*xX.]{2,}(\d{2,})\b/g)].map(m => m[1]);
    const long = tail.length >= 3 && runs.some(r => r.length >= 3 && r.endsWith(tail));
    // Keep only the digits the alert actually shows, never extra ones the model added.
    const short = !long && masked.find(r => r.endsWith(tail) || tail.endsWith(r));
    if (!long && !short) {
      rejected.push({ field: 'account_tail', value: out.account_tail, why: 'not written in the alert' });
      out.account_tail = null;
    } else out.account_tail = long ? tail.slice(-4) : (tail.length < short.length ? tail : short).slice(-4);
  }

  if (out.reference) {
    const ref = String(out.reference).replace(/\s/g, '');
    if (!String(text).replace(/\s/g, '').includes(ref)) {
      rejected.push({ field: 'reference', value: out.reference, why: 'not written in the alert' });
      out.reference = null;
    }
  }

  // The bank name too: SMS from a bank's sender ID often never names the bank, and the model guesses.
  if (out.bank && !String(text).toLowerCase().includes(String(out.bank).toLowerCase().replace(/\s*bank$/, ''))) out.bank = '';

  if (out.direction && !['CR', 'DR'].includes(out.direction)) out.direction = null;
  // Credit or debit must be backed by the alert's own words. If the words point the other way,
  // the model misread; if they point both ways or nowhere, it stays unknown.
  if (out.direction) {
    const cr = CREDIT.test(text), dr = DEBIT.test(text);
    if (cr !== dr && (out.direction === 'CR') !== cr) {
      rejected.push({ field: 'direction', value: out.direction, why: `the alert says ${cr ? 'credit' : 'debit'}` });
      out.direction = cr ? 'CR' : 'DR';
    } else if (!cr && !dr) {
      rejected.push({ field: 'direction', value: out.direction, why: 'the alert never says credit or debit' });
      out.direction = null;
    }
  }
  return { reading: out, rejected };
}
