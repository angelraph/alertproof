// The real-alert test. Put genuine alerts from real phones and inboxes in eval/private/real/
// (that folder is never committed): one .txt file per bank account, alerts oldest first,
// separated by a line with --- on it. Then:
//   node eval/real.mjs [model]
// Every alert is read the way the app reads it (learned format first, Gemma otherwise). The real
// chain proves the readings: if every balance follows from the one before, every number was read
// right. Then fakes are made from the real alerts themselves (an invented balance, an old alert
// sent again, another account's digits) and each one must be stopped.
// Only counts are written to eval/EVAL-REAL.md. No alert text, name, account or balance leaves the folder.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { ollamaChat } from '../lib/model.js';
import { ALERT_SCHEMA, alertPrompt } from '../lib/prompts.js';
import { readAlert } from '../lib/read.js';
import { ground } from '../lib/ground.js';
import { learn as learnFormat, apply as applyFormat } from '../lib/template.js';
import { check, audit, PAID, NO_RELEASE } from '../lib/chain.js';
import { toKobo } from '../lib/money.js';

const model = process.argv[2] || 'gemma3:4b';
const dir = new URL('./private/real/', import.meta.url);
const files = (await readdir(dir).catch(() => [])).filter(f => f.endsWith('.txt'));
if (!files.length) {
  console.log('No real alerts yet. Put .txt files in eval/private/real/ (alerts oldest first, separated by ---).');
  process.exit(0);
}

const split = t => (/^\s*-{3,}\s*$/m.test(t) ? t.split(/^\s*-{3,}\s*$/m) : t.split(/\n\s*\n/)).map(s => s.trim()).filter(Boolean);
const T = {};
async function read(text) {
  const t0 = performance.now();
  const fast = applyFormat(T, text);
  if (fast) { const g = ground(fast, text); if (!g.rejected.length) return { ...g, how: 'learned', ms: performance.now() - t0 }; }
  const r = await readAlert(text, suffix => ollamaChat('http://localhost:11434', model, alertPrompt(text) + suffix, ALERT_SCHEMA));
  if (!r.rejected.length) learnFormat(T, text, r.reading);
  return { ...r, how: 'gemma', ms: performance.now() - t0 };
}

const s = { accounts: 0, alerts: 0, gemma: 0, learned: 0, gemmaMs: [], learnedMs: [], read: [0, 0], links: 0, linksOk: 0, gaps: 0, smallGaps: 0, noBalance: 0,
  genuineChain: { [PAID]: 0, [NO_RELEASE]: 0, "CAN'T TELL": 0 }, genuineAnchored: [0, 0],
  attacks: { fake: [0, 0], replay: [0, 0], account: [0, 0] } };
const truth = text => {
  // The bank's own numbers, read straight from the alert's table, to grade what was read.
  const row = k => (text.match(new RegExp(String.raw`\|\s*${k}\s*\|\s*(-?[\d,]+\.\d{2})`)) || [])[1];
  return { amount: row('Amount') && toKobo(row('Amount')), balance: row('Available Balance') && toKobo(row('Available Balance')), direction: /\|\s*Transaction Type\s*\|\s*CREDIT/.test(text) ? 'CR' : /\|\s*Transaction Type\s*\|\s*DEBIT/.test(text) ? 'DR' : null };
};
for (const f of files) {
  s.accounts++;
  const alerts = split(await readFile(new URL(f, dir), 'utf8'));
  const ledger = [];
  for (const [i, text] of alerts.entries()) {
    const r = await read(text);
    s.alerts++; s[r.how]++; s[r.how + 'Ms'].push(r.ms);
    const tr = truth(text);
    if (tr.amount != null) { s.read[1]++; if (r.reading.amount === tr.amount && r.reading.balance === tr.balance && r.reading.direction === tr.direction) s.read[0]++; }
    if (r.reading.balance == null) s.noBalance++;
    if (ledger.length && r.reading.direction === 'CR' && r.reading.balance != null && r.reading.amount != null) {
      // Against the chain as the bank emailed it (gaps included)...
      s.genuineChain[check({ ...r.reading, raw: text }, { ledger, now: 1e15 }).verdict]++;
      // ...and after the trader sets their balance from the app once, as Alertproof asks after a gap.
      s.genuineAnchored[1]++;
      const anchor = { balance: r.reading.balance - r.reading.amount, at: Infinity };
      if (check({ ...r.reading, raw: text }, { ledger, anchor, now: 1e15 }).verdict === PAID) s.genuineAnchored[0]++;
    }
    ledger.push({ id: i, raw: text, ...r.reading, addedAt: i });
  }
  const withBal = ledger.filter(a => a.balance != null && a.amount != null);
  s.links += Math.max(0, withBal.length - 1);
  const gaps = audit(ledger);
  s.gaps += gaps.length; s.smallGaps += gaps.filter(g => Math.abs(g.gap) <= 100_00).length;
  s.linksOk += Math.max(0, withBal.length - 1) - gaps.length;

  // Fakes made from each real credit. Each is checked against the true balance just before it,
  // so a fake has to be caught by the rule it breaks, not by an unrelated gap.
  const account = f.match(/(\d{3})\.txt$/)?.[1];
  for (let i = 1; i < ledger.length; i++) {
    const a = ledger[i];
    if (a.direction !== 'CR' || a.balance == null) continue;
    const before = ledger.slice(0, i);
    const anchor = { balance: a.balance - a.amount, at: Infinity };
    const attack = async (kind, text) => {
      const r = await read(text);
      s.attacks[kind][1]++;
      if (check({ ...r.reading, raw: text }, { account: account ? '2290000' + account : undefined, ledger: before, anchor, now: 1e15 }).verdict === NO_RELEASE) s.attacks[kind][0]++;
    };
    const balStr = [...a.raw.matchAll(/-?\d[\d,]*\.\d{2}/g)].map(m => m[0]).filter(x => toKobo(x) === a.balance);
    if (balStr.length) {
      const forged = balStr[0].replace(/^(-?)(\d)/, (_, sg, d) => sg + String((+d % 9) + 1));
      await attack('fake', a.raw.split(balStr[0]).join(forged));
    }
    await attack('replay', before.filter(x => x.direction === 'CR').at(-1)?.raw || a.raw);
    const mask = a.raw.match(/\*{2,}(\d{2,})\b/);
    if (mask) await attack('account', a.raw.replace(mask[0], mask[0].replace(/\d+$/, d => d.split('').map(x => String((+x + 3) % 10)).join(''))));
  }
}

const med = a => a.length ? a.sort((x, y) => x - y)[Math.floor(a.length / 2)] : 0;
const pair = ([a, b]) => `${a} of ${b}`;
const g = s.genuineChain;
const md = `# Alertproof on real alerts

Generated by \`node eval/real.mjs ${model}\` from ${s.alerts} genuine bank alert emails on ${s.accounts} real account${s.accounts === 1 ? '' : 's'}. Only counts are published; the alerts never leave the machine that ran the test.

| | |
|---|---|
| Real alerts read | ${s.alerts} |
| Amount, balance and credit/debit all read right | ${pair(s.read)} |
| Read by Gemma (first alert of a layout, or one that didn't fit) | ${s.gemma}, median ${(med(s.gemmaMs) / 1000).toFixed(1)} s |
| Read instantly from a learned layout | ${s.learned}, median ${med(s.learnedMs).toFixed(2)} ms |
| Balance links that add up exactly | ${s.linksOk} of ${s.links} |
| Links with a gap (the bank changed the balance without an alert) | ${s.gaps}, of which ${s.smallGaps} within ₦100 (interest, small charges) |
| Real credits, against the chain as emailed | ${g[PAID]} PAID, ${g["CAN'T TELL"]} CAN'T TELL, ${g[NO_RELEASE]} NO RELEASE |
| Real credits, after setting the balance from the app once | ${pair(s.genuineAnchored)} PAID |
| Fakes with an invented balance stopped | ${pair(s.attacks.fake)} |
| Old alerts sent again stopped | ${pair(s.attacks.replay)} |
| Alerts with another account's digits stopped | ${pair(s.attacks.account)} |
`;
await writeFile(new URL('./EVAL-REAL.md', import.meta.url), md);
console.log(md);
