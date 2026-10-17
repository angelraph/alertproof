// The evaluation: 70 alerts across 10 bank formats, real and fake, read by a Gemma model and judged
// by the balance chain. Writes eval/results/<model>.json and rebuilds eval/EVAL.md from every result.
//   node eval/run.mjs gemma3:4b                     (local, Ollama)
//   node eval/run.mjs --online https://site/api/read (hosted Gemma 4)
import { mkdir, readdir, readFile, writeFile } from 'node:fs/promises';
import { FORMATS, UNSEEN, day } from '../lib/formats.js';
import { ollamaChat } from '../lib/model.js';
import { ALERT_SCHEMA, alertPrompt } from '../lib/prompts.js';
import { readAlert } from '../lib/read.js';
import { check, sameAccount, PAID, NO_RELEASE, CANT_TELL } from '../lib/chain.js';
import { naira } from '../lib/money.js';

const ACCT = '0123454821';
const NOW = Date.parse('2026-10-17T20:00:00');
const args = process.argv.slice(2);
const online = args[0] === '--online' ? args[1] : null;
const model = online ? 'gemma-4 (hosted)' : args[0] || 'gemma3:4b';
const only = args.find(a => a.startsWith('--limit='))?.split('=')[1];
const dir = new URL('./results/', import.meta.url);

// ---------- the corpus ----------
// For each format: a morning of genuine alerts the trader already has (the ledger), then incoming alerts.
export function corpus() {
  const cases = [];
  Object.keys(FORMATS).forEach((fmt, i) => {
    const hist = day(ACCT, '2026-10-17T07:30:00', 4_000_000 + i * 731_45, 11 + i);
    const ledger = hist.map((f, k) => ({ id: k, raw: FORMATS[fmt](f), amount: f.amount, balance: f.balance, direction: f.direction, reference: f.ref, time: f.time.toISOString(), addedAt: k }));
    const last = hist.at(-1);
    const t = mins => new Date(last.time.getTime() + mins * 60e3);
    const ref = k => String(200000000000 + i * 1000 + k);
    const cr = (amount, extra = {}) => ({ account: ACCT, amount, balance: last.balance + amount, direction: 'CR', name: 'Kelechi Obi', time: t(15), ref: ref(1), ...extra });
    const add = (kind, truth, f, expect) => cases.push({ id: `${fmt}/${kind}`, fmt, kind, truth, expect, text: FORMATS[fmt](f), ledger });
    add('genuine', f0(cr(1_250_000)), cr(1_250_000), PAID);
    add('genuine-kobo', f0(cr(737_550, { ref: ref(2) })), cr(737_550, { ref: ref(2) }), PAID);
    add('debit', f0(cr(300_000, { direction: 'DR', balance: last.balance - 300_000, ref: ref(3) })), cr(300_000, { direction: 'DR', balance: last.balance - 300_000, ref: ref(3) }), NO_RELEASE);
    // Fakes. A fraudster copies the format but has to invent the balance.
    const fakeBal = last.balance + 2_500_000 + 13_742_000;
    add('fake-balance', f0(cr(2_500_000, { balance: fakeBal, ref: ref(4) })), cr(2_500_000, { balance: fakeBal, ref: ref(4) }), NO_RELEASE);
    add('fake-round', f0(cr(5_000_000, { balance: 25_000_000, ref: ref(5) })), cr(5_000_000, { balance: 25_000_000, ref: ref(5) }), NO_RELEASE);
    add('wrong-account', f0(cr(1_800_000, { account: '0198765432', ref: ref(6) })), cr(1_800_000, { account: '0198765432', ref: ref(6) }), NO_RELEASE);
    const old = hist.find(h => h.direction === 'CR');
    cases.push({ id: `${fmt}/replay`, fmt, kind: 'replay', truth: f0(old), expect: NO_RELEASE, text: ledger[hist.indexOf(old)].raw, ledger });
  });
  return cases;
}
const f0 = f => ({ ...f });

// What a perfect reader would get, given what each format actually shows.
function visibleTail(text, account) {
  const runs = (text.match(/\d+/g) || []).filter(r => r.length >= 3 && account.endsWith(r));
  return runs.length ? runs.sort((a, b) => b.length - a.length)[0] : null;
}

// ---------- run ----------
async function ask(text) {
  if (online) {
    const res = await fetch(online, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: 'alert', text, suffix: '' }) });
    if (res.status === 429) { await new Promise(r => setTimeout(r, 60e3)); return ask(text); }
    const d = await res.json();
    if (!res.ok) throw new Error(d.error);
    return d.json;
  }
  return ollamaChat('http://localhost:11434', model, alertPrompt(text), ALERT_SCHEMA);
}

async function run() {
  const cases = corpus().slice(0, only ? Number(only) : undefined);
  await mkdir(dir, { recursive: true });
  const file = new URL(`${model.replace(/[^\w.-]+/g, '_')}.json`, dir);
  let done = [];
  try { done = JSON.parse(await readFile(file, 'utf8')); } catch {}
  for (const c of cases) {
    if (done.some(d => d.id === c.id)) continue;
    const t = Date.now();
    let read, error = null;
    try {
      read = await readAlert(c.text, suffix => online
        ? fetch(online, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ task: 'alert', text: c.text, suffix }) }).then(async r => { const d = await r.json(); if (!r.ok) throw new Error(d.error); return d.json; })
        : ollamaChat('http://localhost:11434', model, alertPrompt(c.text) + suffix, ALERT_SCHEMA));
    } catch (e) { error = e.message; read = { reading: {}, rejected: [], tries: 0 }; }
    const ms = Date.now() - t;
    const verdict = error ? 'ERROR' : check({ ...read.reading, raw: c.text }, { account: ACCT, ledger: c.ledger, now: NOW }).verdict;
    done.push({ id: c.id, fmt: c.fmt, kind: c.kind, expect: c.expect, verdict, ms, tries: read.tries, rejected: read.rejected, firstRejected: read.firstRejected || [], reading: read.reading, truth: { amount: c.truth.amount, balance: c.truth.balance, direction: c.truth.direction, tail: visibleTail(c.text, c.truth.account), ref: c.text.includes(c.truth.ref) ? c.truth.ref : null }, error });
    console.log(`${c.id.padEnd(32)} ${String(verdict).padEnd(11)} expect ${c.expect.padEnd(11)} ${(ms / 1000).toFixed(1)}s${read.rejected?.length ? '  rejected ' + read.rejected.map(r => r.field).join(',') : ''}`);
    await writeFile(file, JSON.stringify(done, null, 1));
  }
  await report();
}

// ---------- report ----------
const pct = (a, b) => b ? `${Math.round((100 * a) / b)}%` : '–';

async function report() {
  const files = (await readdir(dir).catch(() => [])).filter(f => f.endsWith('.json'));
  let md = `# Alertproof evaluation\n\nGenerated by \`node eval/run.mjs\`. ${corpus().length} alerts per model across ${Object.keys(FORMATS).length} formats (SMS, push notifications and emails from GTBank, Access, Zenith, UBA, First Bank, OPay, Moniepoint and PalmPay). For every format the trader already has a morning of genuine alerts in their book; each case is one new alert arriving.\n\nCases per format: two genuine credits (one with kobo), one debit, a fake with an invented balance, a fake with a round balance, an alert for someone else's account, and a replay of a real alert from earlier that day.\n\nThe model only reads. The verdict is arithmetic in \`lib/chain.js\`.\n`;
  for (const f of files) {
    const rows = JSON.parse(await readFile(new URL(f, dir), 'utf8'));
    const name = f.replace(/\.json$/, '');
    const fakes = rows.filter(r => r.expect === NO_RELEASE && r.kind !== 'debit');
    const genuine = rows.filter(r => r.kind.startsWith('genuine'));
    const unsafe = rows.filter(r => r.expect !== PAID && r.verdict === PAID);
    const falseAlarm = genuine.filter(r => r.verdict === NO_RELEASE);
    const cant = genuine.filter(r => r.verdict === CANT_TELL);
    const field = (key, eq = (a, b) => a === b) => {
      const n = rows.filter(r => r.truth[key] != null && !r.error);
      return `${n.filter(r => eq(r.reading[key === 'tail' ? 'account_tail' : key === 'ref' ? 'reference' : key], r.truth[key])).length}/${n.length}`;
    };
    const firstPass = rows.filter(r => r.tries === 1).length;
    const ms = rows.filter(r => !r.error).map(r => r.ms).sort((a, b) => a - b);
    md += `\n## ${name}\n\n| | |\n|---|---|\n| **Fakes released (fake → PAID)** | **${unsafe.length} of ${fakes.length + rows.filter(r => r.kind === 'debit').length}** |\n| Fakes stopped (NO RELEASE) | ${fakes.filter(r => r.verdict === NO_RELEASE).length} of ${fakes.length} |\n| Genuine payments proven (PAID) | ${genuine.filter(r => r.verdict === PAID).length} of ${genuine.length} |\n| Genuine payments wrongly blocked | ${falseAlarm.length} of ${genuine.length} |\n| Genuine payments left as CAN'T TELL | ${cant.length} of ${genuine.length} |\n| Read cleanly on the first try | ${firstPass} of ${rows.length} |\n| Errors | ${rows.filter(r => r.error).length} |\n| Seconds per alert (median / slowest) | ${(ms[Math.floor(ms.length / 2)] / 1000).toFixed(1)} / ${(ms.at(-1) / 1000).toFixed(1)} |\n`;
    md += `\nFields read correctly (after grounding): amount ${field('amount')}, balance ${field('balance')}, credit/debit ${field('direction')}, account digits ${field('tail', (a, b) => Boolean(a && b && (a.endsWith(b) || b.endsWith(a))))}, reference ${field('ref')}.\n`;
    const by = {};
    for (const r of rows) (by[r.fmt] ||= []).push(r);
    md += `\n| Format | ${['genuine', 'genuine-kobo', 'debit', 'fake-balance', 'fake-round', 'wrong-account', 'replay'].join(' | ')} |\n|---|${'---|'.repeat(7)}\n`;
    for (const [fmt, rs] of Object.entries(by)) {
      md += `| ${fmt}${UNSEEN.includes(fmt) ? ' *' : ''} | ${['genuine', 'genuine-kobo', 'debit', 'fake-balance', 'fake-round', 'wrong-account', 'replay'].map(k => { const r = rs.find(x => x.kind === k); return !r ? '' : r.verdict === r.expect ? '✓' : r.verdict === PAID ? '**✗ PAID**' : r.verdict === CANT_TELL ? '?' : `✗ ${r.verdict}`; }).join(' | ')} |\n`;
    }
    md += `\n✓ right verdict · ? CAN'T TELL (safe, asks the trader to check) · ✗ wrong. * a format no prompt example shows.\n`;
    const misses = rows.filter(r => r.verdict !== r.expect || r.firstRejected.length || r.rejected.length);
    if (misses.length) {
      md += `\n### Every miss and every grounding rejection\n\n`;
      for (const r of misses) {
        const rej = [...r.firstRejected, ...r.rejected].map(x => `${x.field} ${typeof x.value === 'number' ? naira(x.value) : `"${x.value}"`} (${x.why})`);
        md += `- \`${r.id}\` → ${r.verdict}${r.verdict !== r.expect ? ` (expected ${r.expect})` : ''}${rej.length ? `. Thrown away: ${[...new Set(rej)].join('; ')}` : ''}${r.error ? `. Error: ${r.error}` : ''}\n`;
      }
    }
  }
  await writeFile(new URL('./EVAL.md', import.meta.url), md);
  console.log('wrote eval/EVAL.md');
}

if (args[0] === '--report') report(); else run();
