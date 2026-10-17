// Alertproof at the counter: paste or share an alert, Gemma reads it, the balance chain decides.
import { toKobo, naira } from './lib/money.js';
import { check, expectAlert, audit, lastKnown, sameAccount, PAID, NO_RELEASE, CANT_TELL } from './lib/chain.js';
import { learn, differences } from './lib/fingerprint.js';
import { reader, localHealth, onlineHealth } from './lib/model.js';
import { ground } from './lib/ground.js';
import { normalise } from './lib/read.js';
import * as store from './lib/store.js';
import { SHOP, HISTORY, OPENING, SCENARIOS, drawReceipt } from './lib/demo.js';
import { RECORDED } from './lib/recorded.js';

const $ = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];
const esc = s => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const params = new URLSearchParams(location.search);
const DEMO = params.has('demo');
if (DEMO) store.useDb('alertproof-demo');

let engine = null; // { kind, base?, model?, label }
let busy = false;

// ---------- where Gemma runs ----------

async function withTimeout(p, ms) {
  return Promise.race([p, new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), ms))]);
}

async function pickEngine() {
  const pref = await store.getMeta('engine', 'auto');
  const base = await store.getMeta('ollamaBase', 'http://localhost:11434');
  const model = await store.getMeta('ollamaModel', 'gemma3:4b');
  engine = null;
  if (pref !== 'online') {
    const here = await withTimeout(localHealth(base, model), 2000).catch(() => false);
    if (here) engine = { kind: 'local', base, model, label: `${model} on this computer` };
  }
  if (!engine && pref !== 'local') {
    const on = await withTimeout(onlineHealth(), 4000).catch(() => null);
    if (on) engine = { kind: 'online', label: `Online Gemma (${on.model.replace(/-it$/, '')})` };
  }
  const pill = $('#engine');
  pill.textContent = engine ? engine.label : DEMO ? 'Demo: recorded Gemma readings' : 'No Gemma found. See Setup';
  pill.className = 'pill ' + (engine ? 'on' : 'off');
}

// ---------- the book ----------

const GENUINE = ['mine', 'paid', 'confirmed'];

async function book() {
  const alerts = await store.listAlerts();
  const account = await store.getMeta('account', null);
  const anchor = await store.getMeta('anchor', null);
  const ledger = alerts.filter(a => GENUINE.includes(a.status) && (!account || !a.reading.account_tail || sameAccount(account.number, a.reading.account_tail)));
  return { alerts, account, anchor, ledger: ledger.map(a => ({ ...a, ...pick(a.reading) })) };
}

const pick = r => ({ amount: r.amount, balance: r.balance, direction: r.direction, reference: r.reference, time: r.time });

// ---------- reading ----------

async function readText(text) {
  if (RECORDED[text] && (DEMO || !engine)) {
    const rec = RECORDED[text];
    return { ...ground(normalise(rec.json), text), tries: rec.tries || 1, source: `recorded from ${rec.model} (${(rec.ms / 1000).toFixed(0)}s)` };
  }
  if (!engine) throw new Error('No Gemma to read with. Start Ollama with a Gemma model, or turn on online Gemma in Setup.');
  const t = Date.now();
  const out = await reader(engine).alert(text);
  return { ...out, source: `${engine.label}, ${((Date.now() - t) / 1000).toFixed(1)}s` };
}

// ---------- check an alert ----------

async function checkAlert(text) {
  text = text.trim();
  if (!text || busy) return;
  busy = true;
  $('#check-btn').disabled = true;
  const out = $('#result');
  out.innerHTML = `<p class="working">Gemma is reading the alert${engine?.kind === 'local' ? ' on this computer' : ''}…</p>`;
  try {
    const read = await readText(text);
    const { account, anchor, ledger } = await book();
    const reading = { ...read.reading, raw: text };
    const result = check(reading, { account: account?.number, ledger, anchor, now: DEMO ? Date.parse('2026-10-17T11:30:00') : Date.now() });
    const looks = differences(text, learn(ledger.map(a => a.raw)));
    const status = result.verdict === PAID ? 'paid' : result.verdict === NO_RELEASE ? 'blocked' : 'unsure';
    const record = { id: crypto.randomUUID(), raw: text, reading: read.reading, rejected: read.rejected, checks: result.checks, verdict: result.verdict, status, addedAt: Date.now(), source: read.source };
    // A replay is never stored again: it would poison the chain with a balance we already have.
    if (!result.checks.some(c => c.id === 'replay' && c.ok === false)) await store.saveAlert(record);
    let landed = null;
    if (result.verdict === PAID && reading.direction === 'CR') landed = await settleWaiting(reading.amount);
    renderVerdict(record, { looks, landed, expected: result.expected });
    speak(record, landed);
    renderWaiting();
  } catch (e) {
    out.innerHTML = `<div class="card"><h3>Couldn't read that</h3><p>${esc(e.message)}</p></div>`;
  } finally {
    busy = false;
    $('#check-btn').disabled = false;
  }
}

const SAY = {
  [PAID]: r => `Money don land. ${naira(r.reading.amount)} is in your account.`,
  [NO_RELEASE]: r => `Don't release the goods. ${WHY[failedOn(r)] || 'This alert doesn’t add up.'}`,
  [CANT_TELL]: () => `Can't prove it yet. Check your bank app before you release.`,
};
const SAY_PIDGIN = {
  [PAID]: r => `Money don land. ${spoken(r.reading.amount)} don enter your account.`,
  [NO_RELEASE]: r => `No release am. ${WHY_PIDGIN[failedOn(r)] || 'This alert no follow your balance.'}`,
  [CANT_TELL]: () => `I no fit confirm am. Check your bank app first.`,
};
const failedOn = r => ['replay', 'account', 'direction', 'balance'].find(id => r.checks.some(c => c.id === id && c.ok === false));
const WHY = { replay: 'This alert has been used before.', account: 'This money went to another account.', direction: 'This is money going out, not coming in.', balance: 'The balance does not follow from your last alert.' };
const WHY_PIDGIN = { replay: 'Dem don use this alert before.', account: 'This money no enter your account.', direction: 'Na debit be this, no be credit.', balance: 'This alert no follow your balance.' };
const spoken = k => `${Math.round(k / 100).toLocaleString('en-NG')} naira`;

function renderVerdict(rec, { looks = [], landed, expected }) {
  const node = $('#tpl-result').content.firstElementChild.cloneNode(true);
  const cls = { [PAID]: 'paid', [NO_RELEASE]: 'stop', [CANT_TELL]: 'wait' }[rec.verdict];
  node.classList.add(cls);
  node.querySelector('.stamp').textContent = rec.verdict;
  node.querySelector('.amount').textContent = rec.reading.amount != null ? `${rec.reading.direction === 'DR' ? '−' : ''}${naira(rec.reading.amount)}` : '';
  node.querySelector('.say').textContent = SAY[rec.verdict](rec) + (landed ? ` That's the payment you were waiting for from ${landed.name.toLowerCase().replace(/\b\w/g, c => c.toUpperCase())}.` : '');
  // The reason that decided it goes first: failures, then unknowns, then what passed.
  const order = c => (c.ok === false ? 0 : c.ok == null ? 1 : 2);
  node.querySelector('.checks').innerHTML = [...rec.checks].sort((a, b) => order(a) - order(b)).map(c => `<li class="${c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'unk'}">${esc(c.text)}</li>`).join('');
  if (looks.length) node.querySelector('.looks').innerHTML = `Also, compared with your real alerts, this one:<ul>${looks.map(l => `<li>${esc(l)}</li>`).join('')}</ul>`;
  const rej = Object.fromEntries((rec.rejected || []).map(r => [r.field, r.value]));
  const r = rec.reading;
  const rows = [
    ['Bank', r.bank], ['Type', r.direction === 'CR' ? 'Credit' : r.direction === 'DR' ? 'Debit' : '?'],
    ['Amount', r.amount != null ? naira(r.amount) : rej.amount != null ? naira(rej.amount) : '', rej.amount != null],
    ['Balance', r.balance != null ? naira(r.balance) : rej.balance != null ? naira(rej.balance) : '', rej.balance != null],
    ['Account', r.account_tail ? `…${r.account_tail}` : rej.account_tail ? `…${rej.account_tail}` : '', rej.account_tail != null],
    ['From/to', r.counterparty], ['Reference', r.reference || rej.reference || '', rej.reference != null], ['Time', r.time],
  ];
  node.querySelector('.read dl').innerHTML = rows.filter(x => x[1]).map(([k, v, bad]) => `<dt>${k}</dt><dd class="${bad ? 'rej' : ''}">${esc(v)}</dd>`).join('');
  node.querySelector('.read .meta').textContent = `${rec.source}. ${rec.rejected?.length ? `Crossed out: Gemma gave a value that isn't written in the alert, so it was thrown away.` : 'Every number above is written in the alert.'}`;
  const actions = node.querySelector('.actions');
  if (rec.verdict === CANT_TELL && rec.status === 'unsure') {
    const b = document.createElement('button');
    b.className = 'secondary'; b.textContent = 'I checked my app. It’s real';
    b.onclick = async () => { rec.status = 'confirmed'; await store.saveAlert(rec); b.replaceWith(Object.assign(document.createElement('p'), { textContent: 'Added to your book. The chain continues from this balance.' })); renderToday(); };
    actions.append(b);
  }
  $('#result').replaceChildren(node);
  node.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
}

async function speak(rec, landed) {
  if (!('speechSynthesis' in window) || !(await store.getMeta('speak', true))) return;
  const pidgin = await store.getMeta('pidgin', false);
  const u = new SpeechSynthesisUtterance((pidgin ? SAY_PIDGIN : SAY)[rec.verdict](rec) + (landed ? ` From ${landed.name}.` : ''));
  const voice = speechSynthesis.getVoices().find(v => /en-NG/i.test(v.lang)) || speechSynthesis.getVoices().find(v => /^en/i.test(v.lang));
  if (voice) u.voice = voice;
  u.rate = 0.95;
  speechSynthesis.cancel();
  speechSynthesis.speak(u);
}

// ---------- customer screenshot ----------

async function shrink(file) {
  const img = await createImageBitmap(file);
  const scale = Math.min(1, 1100 / Math.max(img.width, img.height));
  const c = Object.assign(document.createElement('canvas'), { width: Math.round(img.width * scale), height: Math.round(img.height * scale) });
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.85).split(',')[1];
}

async function checkScreenshot(b64, recordedKey) {
  if (busy) return;
  busy = true;
  const out = $('#result');
  out.innerHTML = `<p class="working">Gemma is reading the screenshot…</p>`;
  try {
    let r, source;
    if (recordedKey && RECORDED[recordedKey] && (DEMO || !engine)) {
      ({ json: r } = RECORDED[recordedKey]);
      source = `recorded from ${RECORDED[recordedKey].model}`;
    } else {
      if (!engine) throw new Error('No Gemma to read with. Start Ollama with a Gemma model, or turn on online Gemma in Setup.');
      const t = Date.now();
      r = await reader(engine).receipt(b64);
      source = `${engine.label}, ${((Date.now() - t) / 1000).toFixed(1)}s`;
    }
    const { account, anchor, ledger } = await book();
    const amount = toKobo(String(r.amount || ''));
    const acctDigits = String(r.recipient_account || '').replace(/\D/g, '');
    const checks = [];
    if (!account) checks.push({ ok: null, text: 'Add your account number in Setup to check who this was sent to.' });
    else if (!acctDigits) checks.push({ ok: null, text: 'The screenshot shows no account number.' });
    else if (sameAccount(account.number, acctDigits.slice(-3)) && (acctDigits.length < 10 || acctDigits === account.number)) checks.push({ ok: true, text: `Sent to your account (…${account.number.slice(-4)}).` });
    else checks.push({ ok: false, text: `Sent to account ${acctDigits}, not yours (…${account.number.slice(-4)}).` });
    const biz = (account?.biz || '').toLowerCase().split(/\s+/).filter(w => w.length > 2);
    const name = String(r.recipient_name || '').toLowerCase();
    if (biz.length && name) checks.push(biz.some(w => name.includes(w)) ? { ok: true, text: `Recipient name "${r.recipient_name}" matches your business.` } : { ok: false, text: `Recipient name "${r.recipient_name}" is not your business name.` });
    if (r.status && !/success|completed|sent/i.test(r.status)) checks.push({ ok: false, text: `The screenshot itself says "${r.status}".` });
    const exp = amount != null ? expectAlert(amount, ledger, anchor) : null;
    const wrongPlace = checks.some(c => c.ok === false);
    const node = document.createElement('article');
    node.className = 'verdict ' + (wrongPlace ? 'stop' : 'wait');
    node.innerHTML = `
      <header><span class="stamp">${wrongPlace ? NO_RELEASE : 'WAIT FOR ALERT'}</span><span class="amount">${amount != null ? naira(amount) : ''}</span></header>
      <p class="say">${wrongPlace ? 'This screenshot is not a payment to you.' : 'A screenshot is not money. Anyone can edit one. Wait for your own alert.'}</p>
      <img class="shot" alt="The customer's screenshot" src="data:image/jpeg;base64,${b64}">
      <ul class="checks">${checks.map(c => `<li class="${c.ok === true ? 'ok' : c.ok === false ? 'bad' : 'unk'}">${esc(c.text)}</li>`).join('')}</ul>
      ${!wrongPlace && exp ? `<div class="expect">If this is real, your next alert will say <strong>CR ${naira(exp.amount)}</strong>${exp.balance != null ? ` and <strong>Avail Bal ${naira(exp.balance)}</strong>` : ''}. Share or paste it here and Alertproof will turn it green.</div>` : ''}
      <details class="read"><summary>What Gemma read</summary><dl>${Object.entries(r).filter(([, v]) => v).map(([k, v]) => `<dt>${esc(k.replace(/_/g, ' '))}</dt><dd>${esc(v)}</dd>`).join('')}</dl><p class="meta">${esc(source)}. Numbers on a picture can't be checked against text, so Alertproof never trusts them: it only uses them to know which alert to wait for.</p></details>`;
    out.replaceChildren(node);
    if (!wrongPlace && amount != null) {
      const waiting = await store.getMeta('waiting', []);
      waiting.push({ id: crypto.randomUUID(), amount, name: r.sender_name || 'customer', expected: exp?.balance ?? null, at: Date.now() });
      await store.setMeta('waiting', waiting);
      renderWaiting();
    }
    if ('speechSynthesis' in window && await store.getMeta('speak', true)) {
      const pidgin = await store.getMeta('pidgin', false);
      speechSynthesis.cancel();
      speechSynthesis.speak(new SpeechSynthesisUtterance(wrongPlace ? (pidgin ? 'No release am. This money no come your account.' : 'Don’t release. This was not sent to you.') : (pidgin ? 'Screenshot no be money. Wait for your alert.' : 'A screenshot is not money. Wait for your alert.')));
    }
  } catch (e) {
    out.innerHTML = `<div class="card"><h3>Couldn't read that screenshot</h3><p>${esc(e.message)}</p></div>`;
  } finally {
    busy = false;
  }
}

async function settleWaiting(amount) {
  const waiting = await store.getMeta('waiting', []);
  const hit = waiting.find(w => w.amount === amount);
  if (!hit) return null;
  await store.setMeta('waiting', waiting.filter(w => w !== hit));
  return hit;
}

async function renderWaiting() {
  const waiting = await store.getMeta('waiting', []);
  $('#waiting').innerHTML = waiting.length ? `<div class="card"><h3>Waiting for alerts</h3>${waiting.map(w => `
    <div class="wait-item"><span>${esc(w.name)}<br><small class="hint">${new Date(w.at).toLocaleTimeString('en-NG', { hour: '2-digit', minute: '2-digit' })}${w.expected != null ? ` · alert should say Avail Bal ${naira(w.expected)}` : ''}</small></span>
    <span><b>${naira(w.amount)}</b><br><button class="link" data-drop="${w.id}">Remove</button></span></div>`).join('')}</div>` : '';
  $$('[data-drop]').forEach(b => b.onclick = async () => {
    await store.setMeta('waiting', (await store.getMeta('waiting', [])).filter(w => w.id !== b.dataset.drop));
    renderWaiting();
  });
}

// ---------- today ----------

async function renderToday() {
  const { alerts, ledger, anchor } = await book();
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const today = DEMO ? alerts : alerts.filter(a => a.addedAt >= start.getTime());
  const inflow = today.filter(a => GENUINE.includes(a.status) && a.reading.direction === 'CR');
  const blocked = today.filter(a => a.status === 'blocked');
  const sum = inflow.reduce((s, a) => s + (a.reading.amount || 0), 0);
  const gaps = audit(ledger);
  const known = lastKnown(ledger, anchor);
  const label = { mine: ['mine', 'your alert'], paid: ['paid', 'PAID'], confirmed: ['paid', 'checked in app'], blocked: ['stop', 'NO RELEASE'], unsure: ['wait', "CAN'T TELL"] };
  $('#today').innerHTML = `
    <div class="stats">
      <div class="stat good"><b>${naira(sum)}</b><span>proven in by transfer</span></div>
      <div class="stat"><b>${inflow.length}</b><span>payments</span></div>
      <div class="stat bad"><b>${blocked.length}</b><span>fake or wrong alerts stopped</span></div>
    </div>
    ${gaps.length ? `<p class="chainline gap">The chain has ${gaps.length} gap${gaps.length > 1 ? 's' : ''}: ${gaps.map(g => `${naira(Math.abs(g.gap))} ${g.gap > 0 ? 'more' : 'less'} than expected before ${esc(g.after.reading.counterparty || 'an alert')}`).join('; ')}. Set your balance from the bank app to restart it.</p>`
      : ledger.length ? `<p class="chainline ok">Chain unbroken across ${ledger.length} alerts.${known ? ` Balance now ${naira(known.balance)}.` : ''}</p>` : ''}
    <ul class="book">${[...today].reverse().map(a => {
      const [cls, tag] = label[a.status] || ['mine', a.status];
      const r = a.reading;
      return `<li><span class="who">${esc(r.counterparty || r.bank || 'Alert')}<span class="tag ${cls}">${tag}</span></span>
        <span class="amt ${a.status === 'blocked' ? 'blocked' : r.direction === 'CR' ? 'cr' : ''}">${r.direction === 'DR' ? '−' : '+'}${naira(r.amount)}</span>
        <span class="sub">${esc(r.time || new Date(a.addedAt).toLocaleTimeString('en-NG'))}${r.balance != null ? ` · bal ${naira(r.balance)}` : ''}</span></li>`;
    }).join('') || '<li class="hint">Nothing yet today.</li>'}</ul>`;
}

// ---------- setup ----------

async function loadSetup() {
  const account = await store.getMeta('account', null);
  if (account) { $('#biz').value = account.biz || ''; $('#acct').value = account.number || ''; $('#bank').value = account.bank || ''; }
  const anchor = await store.getMeta('anchor', null);
  $('#anchor-note').textContent = anchor ? `Balance set to ${naira(anchor.balance)} at ${new Date(anchor.at).toLocaleString('en-NG')}.` : '';
  const pref = await store.getMeta('engine', 'auto');
  $$('input[name=engine]').forEach(r => r.checked = r.value === pref);
  $('#ollama-base').value = await store.getMeta('ollamaBase', 'http://localhost:11434');
  $('#ollama-model').value = await store.getMeta('ollamaModel', 'gemma3:4b');
  $('#speak').checked = await store.getMeta('speak', true);
  $('#pidgin').checked = await store.getMeta('pidgin', false);
  $('#setup-nudge').hidden = Boolean(account && (anchor || (await book()).ledger.length));
}

async function teach(text) {
  const parts = (/^\s*-{3,}\s*$/m.test(text) ? text.split(/^\s*-{3,}\s*$/m) : text.split(/\n\s*\n/)).map(s => s.trim()).filter(Boolean);
  const out = $('#teach-out');
  let n = 0;
  for (const raw of parts) {
    out.innerHTML = `<p class="working">Reading alert ${n + 1} of ${parts.length}…</p>`;
    const read = await readText(raw);
    await store.saveAlert({ id: crypto.randomUUID(), raw, reading: read.reading, rejected: read.rejected, status: 'mine', verdict: null, checks: [], addedAt: Date.now() + n, source: read.source });
    n++;
  }
  const gaps = audit((await book()).ledger);
  out.innerHTML = `<p class="chainline ${gaps.length ? 'gap' : 'ok'}">Added ${n} alert${n === 1 ? '' : 's'}. ${gaps.length ? `${gaps.length} gap${gaps.length > 1 ? 's' : ''} in the chain: an alert is missing between them. Set your balance from the bank app to restart from now.` : 'Chain unbroken.'}</p>`;
  $('#teach-text').value = '';
  loadSetup(); renderToday();
}

// ---------- demo ----------

async function seedDemo() {
  if ((await store.listAlerts()).length) return;
  await store.setMeta('account', { biz: SHOP.biz, number: SHOP.account, bank: SHOP.bank });
  await store.setMeta('anchor', { balance: OPENING, at: 0 });
  let i = 0;
  for (const raw of HISTORY) {
    const rec = RECORDED[raw];
    const read = rec ? ground(normalise(rec.json), raw) : null;
    if (!read) continue;
    await store.saveAlert({ id: `demo-${i}`, raw, reading: read.reading, rejected: read.rejected, status: 'mine', verdict: null, checks: [], addedAt: 1 + i++, source: `recorded from ${rec.model}` });
  }
}

async function runScenario(key) {
  const s = SCENARIOS[key];
  if (key === 'shot') { $('#alert-text').value = ''; return checkScreenshot(drawReceipt(s), 'demo-shot'); }
  $('#alert-text').value = s.text;
  await checkAlert(s.text);
  const say = document.createElement('p');
  say.className = 'hint';
  say.textContent = s.story;
  $('#result').prepend(say);
}

// ---------- wiring ----------

function showTab(name) {
  $$('[role=tab]').forEach(b => b.setAttribute('aria-selected', String(b.dataset.tab === name)));
  $$('.tab').forEach(t => t.hidden = t.id !== `tab-${name}`);
  if (name === 'today') renderToday();
  if (name === 'setup') loadSetup();
}

$$('[role=tab]').forEach(b => b.onclick = () => showTab(b.dataset.tab));
$$('[data-goto]').forEach(b => b.onclick = () => showTab(b.dataset.goto));
$('#engine').onclick = () => showTab('setup');
$('#check-btn').onclick = () => checkAlert($('#alert-text').value);
$('#shot-input').onchange = async e => { const f = e.target.files[0]; if (f) checkScreenshot(await shrink(f)); e.target.value = ''; };
$$('[data-demo]').forEach(b => b.onclick = () => runScenario(b.dataset.demo));

$('#save-acct').onclick = async () => {
  const number = $('#acct').value.replace(/\D/g, '');
  if (number.length !== 10) return alert('Nigerian account numbers have 10 digits.');
  await store.setMeta('account', { number, biz: $('#biz').value.trim(), bank: $('#bank').value.trim() });
  $('#save-acct').textContent = 'Saved'; setTimeout(() => $('#save-acct').textContent = 'Save account', 1500);
  loadSetup();
};
$('#save-anchor').onclick = async () => {
  const balance = toKobo($('#anchor').value);
  if (balance == null) return alert('Type the balance as it shows in your bank app, e.g. 72,450.20');
  await store.setMeta('anchor', { balance, at: Date.now() });
  $('#anchor').value = '';
  loadSetup();
};
$('#teach-btn').onclick = () => { const t = $('#teach-text').value.trim(); if (t) teach(t).catch(e => $('#teach-out').innerHTML = `<p>${esc(e.message)}</p>`); };
$$('input[name=engine]').forEach(r => r.onchange = async () => { await store.setMeta('engine', r.value); pickEngine(); });
$('#ollama-base').onchange = async e => { await store.setMeta('ollamaBase', e.target.value.trim()); pickEngine(); };
$('#ollama-model').onchange = async e => { await store.setMeta('ollamaModel', e.target.value.trim()); pickEngine(); };
$('#speak').onchange = e => store.setMeta('speak', e.target.checked);
$('#pidgin').onchange = e => store.setMeta('pidgin', e.target.checked);
$('#export').onclick = async () => {
  const data = { exportedAt: new Date().toISOString(), account: await store.getMeta('account', null), anchor: await store.getMeta('anchor', null), alerts: await store.listAlerts() };
  const a = Object.assign(document.createElement('a'), { href: URL.createObjectURL(new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })), download: `alertproof-book-${new Date().toISOString().slice(0, 10)}.json` });
  a.click();
};
$('#wipe').onclick = async () => {
  if (!confirm('Delete every alert, your account and your balance from this device?')) return;
  await store.clearAlerts();
  for (const k of ['account', 'anchor', 'waiting']) await store.setMeta(k, null);
  if (DEMO) await seedDemo();
  loadSetup(); renderToday(); renderWaiting(); $('#result').innerHTML = '';
};

(async () => {
  if (DEMO) { $('#demo-bar').hidden = false; await seedDemo(); }
  await loadSetup();
  renderWaiting();
  await pickEngine();
  // Android share target: an SMS shared to Alertproof arrives as ?text=
  const shared = params.get('text') || params.get('title');
  if (shared) { $('#alert-text').value = shared; history.replaceState(null, '', location.pathname + (DEMO ? '?demo' : '')); checkAlert(shared); }
  if (DEMO && params.get('demo')) runScenario(params.get('demo'));
  if ('serviceWorker' in navigator && location.hostname !== 'localhost') navigator.serviceWorker.register('sw.js');
})();
