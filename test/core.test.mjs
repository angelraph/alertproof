import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toKobo, naira, amountsIn } from '../lib/money.js';
import { ground } from '../lib/ground.js';
import { check, audit, expectAlert, PAID, NO_RELEASE, CANT_TELL } from '../lib/chain.js';
import { learn, differences } from '../lib/fingerprint.js';
import { FORMATS, day } from '../lib/formats.js';

const ACCT = '0123454821';
const NOW = Date.parse('2026-10-17T18:00:00');

test('money parses Nigerian amount spellings to kobo', () => {
  assert.equal(toKobo('NGN15,000.00'), 1500000);
  assert.equal(toKobo('₦2,700.5'), 270050);
  assert.equal(toKobo('N 900'), 90000);
  assert.equal(toKobo('abc'), null);
  assert.equal(naira(8745020), '₦87,450.20');
  assert.ok(amountsIn('Amt: NGN15,000.00 CR Bal: 87,450.20').has(8745020));
});

test('ground drops numbers the alert never wrote', () => {
  const text = FORMATS.gtbank_sms({ account: ACCT, amount: 1500000, balance: 8745020, direction: 'CR', name: 'Chidi Okafor', time: new Date(NOW), ref: '123456789012' });
  const { reading, rejected } = ground({ amount: 1500000, balance: 9999900, account_tail: '821', reference: '123456789012', direction: 'CR' }, text);
  assert.equal(reading.amount, 1500000);
  assert.equal(reading.balance, null);
  assert.equal(reading.account_tail, '821');
  assert.deepEqual(rejected.map(r => r.field), ['balance']);
});

test('ground rejects an account tail that is not in the alert', () => {
  const { reading } = ground({ account_tail: '777' }, 'Acct: 0******821 Amt: NGN100.00');
  assert.equal(reading.account_tail, null);
});

function ledgerOf(alerts) {
  return alerts.map((f, i) => ({ id: i, raw: FORMATS.gtbank_sms(f), amount: f.amount, balance: f.balance, direction: f.direction, reference: f.ref, time: f.time.toISOString(), addedAt: i }));
}

test('a genuine next credit is PAID', () => {
  const alerts = day(ACCT, '2026-10-17T08:00:00', 5000000, 7);
  const ledger = ledgerOf(alerts.slice(0, 5));
  const next = alerts.slice(5).find(a => a.direction === 'CR') || alerts[5];
  const prev = ledger.at(-1).balance;
  const f = { ...next, direction: 'CR', balance: prev + next.amount };
  const r = check({ raw: FORMATS.gtbank_sms(f), amount: f.amount, balance: f.balance, direction: 'CR', account_tail: '821', reference: f.ref, time: f.time.toISOString() }, { account: ACCT, ledger, now: NOW });
  assert.equal(r.verdict, PAID, JSON.stringify(r.checks));
});

test('a fake with a made-up balance is NO RELEASE and says which numbers disagree', () => {
  const ledger = ledgerOf(day(ACCT, '2026-10-17T08:00:00', 5000000, 3));
  const r = check({ raw: 'fake', amount: 1500000, balance: 25000000, direction: 'CR', account_tail: '821', reference: '999', time: new Date(NOW).toISOString() }, { account: ACCT, ledger, now: NOW });
  assert.equal(r.verdict, NO_RELEASE);
  assert.match(r.checks.find(c => c.id === 'balance').text, /This alert says ₦250,000/);
});

test('a replayed alert is NO RELEASE even though its balance once matched', () => {
  const ledger = ledgerOf(day(ACCT, '2026-10-17T08:00:00', 5000000, 4));
  const old = ledger[3];
  const r = check({ raw: old.raw, amount: old.amount, balance: old.balance, direction: old.direction, account_tail: '821', reference: old.reference, time: old.time }, { account: ACCT, ledger, now: NOW });
  assert.equal(r.verdict, NO_RELEASE);
  assert.equal(r.checks.find(c => c.id === 'replay').ok, false);
});

test('wrong account is NO RELEASE', () => {
  const r = check({ raw: 'x', amount: 100, balance: 200, direction: 'CR', account_tail: '555' }, { account: ACCT, ledger: [], now: NOW });
  assert.equal(r.verdict, NO_RELEASE);
});

test('no history and no balance means CAN\'T TELL, never PAID', () => {
  assert.equal(check({ raw: 'x', amount: 100, balance: 200, direction: 'CR', account_tail: '821' }, { account: ACCT, now: NOW }).verdict, CANT_TELL);
  assert.equal(check({ raw: 'x', amount: 100, balance: null, direction: 'CR', account_tail: '821' }, { account: ACCT, anchor: { balance: 100, at: 1 }, now: NOW }).verdict, CANT_TELL);
});

test('an anchor typed from the bank app starts the chain', () => {
  const r = check({ raw: 'x', amount: 1500000, balance: 6500000, direction: 'CR', account_tail: '821' }, { account: ACCT, anchor: { balance: 5000000, at: 1 }, now: NOW });
  assert.equal(r.verdict, PAID);
});

test('a small shortfall is treated as a likely bank charge, not fraud', () => {
  const r = check({ raw: 'x', amount: 1500000, balance: 6500000 - 5000, direction: 'CR', account_tail: '821' }, { account: ACCT, anchor: { balance: 5000000, at: 1 }, now: NOW });
  assert.equal(r.verdict, CANT_TELL);
});

test('audit finds the gap in a broken chain', () => {
  const ledger = ledgerOf(day(ACCT, '2026-10-17T08:00:00', 5000000, 9));
  assert.equal(audit(ledger).length, 0);
  ledger.splice(3, 1);
  assert.equal(audit(ledger).length, 1);
});

test('expectAlert predicts the balance the real alert must show', () => {
  assert.deepEqual(expectAlert(1500000, [], { balance: 7245020, at: 1 }), { amount: 1500000, balance: 8745020 });
});

test('fingerprint notices a fake written in another bank\'s style', () => {
  const genuine = day(ACCT, '2026-10-17T08:00:00', 5000000, 5).map(FORMATS.gtbank_sms);
  const profile = learn(genuine);
  assert.deepEqual(differences(genuine[0], profile), []);
  const fake = 'GTBank Alert\nCredit Amt: N15,000\nAcct No: 0***4821\nBalance: N250,000\n17/10/2026';
  assert.ok(differences(fake, profile).length >= 2);
});
