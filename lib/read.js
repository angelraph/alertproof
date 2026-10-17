// Turning the model's raw answer into a checked reading. Runs the same in the browser and in Node.
import { toKobo } from './money.js';
import { ground } from './ground.js';
import { retryNote } from './prompts.js';

// "TRF FROM CHIDI OKAFOR/100171126618" -> "Chidi Okafor". Labels the model mistook for a name are dropped.
function who(name) {
  const n = name.replace(/^(NIP|TRF|TRANSFER|POS PURCHASE|FROM|TO)[\s/:]+/gi, '').replace(/^(NIP|TRF|TRANSFER|FROM|TO)[\s/:]+/gi, '')
    .replace(/[\s/]*\d{6,}.*$/, '').trim();
  if (!n || /^(acct?|amt|desc|date|bal|ref)$/i.test(n)) return '';
  return n.toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}

// Gemma answers with strings as written; convert to kobo and a normalised direction.
export function normalise(raw = {}) {
  const s = v => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v));
  const dir = s(raw.direction).toUpperCase();
  return {
    bank: s(raw.bank),
    direction: dir === 'CR' || dir === 'DR' ? dir : null,
    amount: s(raw.amount) ? toKobo(s(raw.amount)) : null,
    balance: s(raw.balance) ? toKobo(s(raw.balance)) : null,
    account_tail: s(raw.account_tail).replace(/\D/g, '') || null,
    counterparty: who(s(raw.counterparty)),
    reference: s(raw.reference).replace(/\s/g, '') || null,
    time: s(raw.time),
  };
}

// ask(promptSuffix) -> raw model JSON. Reads once; if any number fails grounding, asks once more
// naming what was wrong, and keeps whichever answer has fewer rejected fields.
export async function readAlert(text, ask) {
  const first = ground(normalise(await ask('')), text);
  if (!first.rejected.length) return { ...first, tries: 1 };
  const second = ground(normalise(await ask(retryNote(first.rejected))), text);
  const best = second.rejected.length <= first.rejected.length ? second : first;
  return { ...best, tries: 2, firstRejected: first.rejected };
}
