// The balance chain. A fraudster can fake the sender, the amount and the wording of an alert,
// but not the trader's balance. Each genuine alert's balance follows from the one before:
//   new balance = last balance + amount (credit)   or   last balance - amount (debit).
// Every verdict here is plain arithmetic on numbers the grounding check has already confirmed.
import { naira } from './money.js';

export const PAID = 'PAID', NO_RELEASE = 'NO RELEASE', CANT_TELL = "CAN'T TELL";

const REPLAY_HOURS = 24;
// Small debits banks take without much notice (SMS fees, the ₦50 transfer levy, card fees).
const SMALL_CHARGE = 100_00;

export const sameAccount = (account, tail) => Boolean(account && tail && String(account).endsWith(String(tail)));

const norm = s => String(s || '').toLowerCase().replace(/\s+/g, ' ').trim();

// ledger: genuine alerts for one account, oldest first: [{ id, raw, amount, balance, direction, reference, time }]
// anchor: optional { balance, at } the trader typed from their bank app; it overrides older alerts.
export function lastKnown(ledger, anchor) {
  const last = [...ledger].reverse().find(a => a.balance != null);
  if (anchor && (!last || anchor.at >= last.addedAt)) return { balance: anchor.balance, from: 'your bank app balance' };
  return last ? { balance: last.balance, from: 'your last alert', alert: last } : null;
}

// Checks one incoming alert reading against the trader's account and ledger.
// Returns { verdict, checks: [{ id, ok: true|false|null, text }], expected }.
export function check(reading, { account, ledger = [], anchor = null, now = Date.now() } = {}) {
  const checks = [];
  const add = (id, ok, text) => checks.push({ id, ok, text });

  // 1. Is it a credit at all?
  if (reading.direction === 'DR') add('direction', false, 'This is a debit alert: money went out, not in.');
  else if (reading.direction === 'CR') add('direction', true, 'It is a credit alert.');
  else add('direction', null, "Couldn't tell if this is a credit or a debit.");

  // 2. Is it for this account?
  if (!account) add('account', null, 'Add your account number in Settings so the account can be checked.');
  else if (!reading.account_tail) add('account', null, 'The alert shows no account number.');
  else if (sameAccount(account, reading.account_tail)) add('account', true, `For your account (ends ${String(account).slice(-4)}).`);
  else add('account', false, `This alert is for an account ending ${reading.account_tail}. Yours ends ${String(account).slice(-4)}.`);

  // 3. Have we seen it before?
  const dupe = ledger.find(a => (reading.reference && a.reference === reading.reference) || norm(a.raw) === norm(reading.raw));
  if (dupe) add('replay', false, 'You already received this exact alert. Someone is sending an old one again.');
  else if (reading.time && now - Date.parse(reading.time) > REPLAY_HOURS * 3600e3) {
    add('replay', false, `This alert is dated ${new Date(reading.time).toLocaleString('en-NG')}, more than a day ago.`);
  } else add('replay', true, 'Not an alert you have seen before.');

  // 4. The balance chain: the check a fraudster can't pass.
  const known = lastKnown(ledger, anchor);
  let expected = null;
  if (reading.amount == null) add('balance', null, "Couldn't read the amount.");
  else if (reading.balance == null) add('balance', null, 'The alert shows no balance, so it can’t be checked against your account.');
  else if (!known) add('balance', null, 'First alert for this account. Add your current balance from your bank app once, and every alert after this can be checked.');
  else {
    expected = known.balance + (reading.direction === 'DR' ? -reading.amount : reading.amount);
    const diff = reading.balance - expected;
    if (diff === 0) add('balance', true, `Balance follows from ${known.from}: ${naira(known.balance)} + ${naira(reading.amount)} = ${naira(expected)}.`);
    else if (diff < 0 && -diff <= SMALL_CHARGE) {
      add('balance', null, `Balance is ${naira(-diff)} less than expected. That looks like a bank charge you haven't added. Check your app.`);
    } else {
      add('balance', false, `After ${known.from} your balance was ${naira(known.balance)}. ${naira(reading.amount)} in should make it ${naira(expected)}. This alert says ${naira(reading.balance)}.`);
    }
  }

  const failed = checks.some(c => c.ok === false);
  const proven = checks.find(c => c.id === 'balance')?.ok && checks.find(c => c.id === 'direction')?.ok && checks.find(c => c.id === 'replay')?.ok
    && checks.find(c => c.id === 'account')?.ok !== false;
  const verdict = failed ? NO_RELEASE : proven ? PAID : CANT_TELL;
  return { verdict, checks, expected };
}

// What the trader's next real alert should say if a customer's screenshot is genuine.
export function expectAlert(amount, ledger, anchor) {
  const known = lastKnown(ledger, anchor);
  return { amount, balance: known ? known.balance + amount : null };
}

// Walks a batch of alerts (the trader's own history) and reports where the chain breaks.
export function audit(ledger) {
  const breaks = [];
  let prev = null;
  for (const a of ledger) {
    if (a.balance == null || a.amount == null) continue;
    if (prev) {
      const expected = prev.balance + (a.direction === 'DR' ? -a.amount : a.amount);
      if (expected !== a.balance) breaks.push({ before: prev, after: a, gap: a.balance - expected });
    }
    prev = a;
  }
  return breaks;
}
