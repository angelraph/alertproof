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

test('ground accepts a two-digit tail only right after a mask, and only the digits shown', () => {
  const text = 'Acct:01**876**32\nDT:17/10/2026 11:00:00\nCR Amt:1,000.00\nBal:5,000.00';
  assert.equal(ground({ account_tail: '32' }, text).reading.account_tail, '32');
  assert.equal(ground({ account_tail: '5432' }, text).reading.account_tail, '32');
  assert.equal(ground({ account_tail: '21' }, text).reading.account_tail, null);
  assert.equal(ground({ account_tail: '00' }, 'Amt: NGN1,000.00 Bal: NGN5,000.00').reading.account_tail, null);
});

import { learn as learnFormat, apply as applyFormat } from '../lib/template.js';

test('a learned format reads the next alert of every bank instantly and exactly', () => {
  for (const fmt of Object.keys(FORMATS)) {
    const alerts = day(ACCT, '2026-10-17T07:30:00', 4000000, 3);
    const T = {};
    assert.ok(learnFormat(T, FORMATS[fmt](alerts[0]), { amount: alerts[0].amount, balance: alerts[0].balance, direction: alerts[0].direction }), fmt);
    for (const f of alerts.slice(1)) {
      const r = applyFormat(T, FORMATS[fmt](f));
      assert.ok(r, `${fmt} fell back`);
      assert.deepEqual([r.amount, r.balance, r.direction], [f.amount, f.balance, f.direction], fmt);
    }
  }
});

test('a learned format never reads another bank\'s alert', () => {
  const a = day(ACCT, '2026-10-17T07:30:00', 4000000, 3);
  const T = {};
  learnFormat(T, FORMATS.gtbank_sms(a[0]), { amount: a[0].amount, balance: a[0].balance, direction: a[0].direction });
  assert.equal(applyFormat(T, FORMATS.access_sms(a[1])), null);
  assert.equal(applyFormat(T, 'GTBank Alert\nCredit Amt: N15,000\nBalance: N250,000'), null);
});

test('a learned format refuses to learn when amount and balance are the same number', () => {
  const T = {};
  assert.equal(learnFormat(T, 'Amt: NGN500.00 CR\nAvail Bal: NGN500.00', { amount: 50000, balance: 50000, direction: 'CR' }), null);
});

test('real alerts: an overdrawn balance with a minus sign is grounded', () => {
  const text = '| Amount | 53.75 |\n| Transaction Type | DEBIT |\n| Available Balance | -276.75 |';
  const { reading } = ground({ amount: 5375, balance: -27675, direction: 'DR' }, text);
  assert.equal(reading.balance, -27675);
});

test('real alerts: a few naira of unalerted interest is CAN\'T TELL, never NO RELEASE or PAID', () => {
  const r = check({ raw: 'x', amount: 2000000, balance: 3996381, direction: 'CR', account_tail: '503' }, { account: '2290000503', anchor: { balance: 1995000, at: 1 }, now: NOW });
  assert.equal(r.verdict, CANT_TELL);
});

import { sessionChecks, decode } from '../lib/session.js';

const REAL_RECEIPT = 'Received from ALIYU AISHAT HUB\n+₦21,907.00\nSuccessful\nSender ALIYU AISHAT HUB Nombank MFB 520****2779\nCompletion Time 20:10, Oct 16, 2026\nTransaction ID 603cfmoxf07\nSession ID 090645261016191057403015967666';
const NOW16 = Date.parse('2026-10-17T06:00:00Z');

test('session ID: a real Moniepoint receipt is consistent', () => {
  const d = decode('090645261016191057403015967666');
  assert.equal(d.bank, 'Nombank');
  assert.equal(d.at.toISOString(), '2026-10-16T19:10:57.000Z');
  const r = sessionChecks(REAL_RECEIPT, NOW16);
  assert.ok(r.checks.every(c => c.ok === true), JSON.stringify(r.checks));
});

test('session ID: an edited time on the same receipt is caught', () => {
  const r = sessionChecks(REAL_RECEIPT.replace('20:10, Oct 16', '14:35, Oct 16'), NOW16);
  assert.equal(r.checks.find(c => c.id === 'session').ok, false);
});

test('session ID: a made-up ID with an impossible date is caught', () => {
  const r = sessionChecks(REAL_RECEIPT.replace('090645261016191057403015967666', '090645261345991057403015967666'), NOW16);
  assert.equal(r.checks[0].ok, false);
});

test('session ID: a receipt copied onto another day is caught', () => {
  const r = sessionChecks(REAL_RECEIPT.replace('Oct 16, 2026', 'Oct 17, 2026').replace('20:10', '09:42'), NOW16);
  assert.equal(r.checks.find(c => c.id === 'session').ok, false);
});
