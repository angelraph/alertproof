// The online reader: the same prompts the shop's laptop sends to Ollama, sent to Gemma hosted by
// Google (Gemini API) for traders who only have a phone. The API key stays on the server.
// Alerts and screenshots pass straight through and are never stored or logged here.
import { alertPrompt, receiptPrompt } from '../lib/prompts.js';
import { focus } from '../lib/focus.js';

const API = 'https://generativelanguage.googleapis.com/v1beta/models';
const MODELS = (process.env.GEMMA_MODEL || 'gemma-4-26b-a4b-it,gemma-4-31b-it,gemma-3-27b-it,gemma-3-12b-it').split(',');
const MAX_IMAGE = 2_000_000; // base64 chars
const WINDOW_MS = 10 * 60 * 1000, PER_WINDOW = 40;
const hits = new Map(); // best-effort per-IP limit (per warm instance)

function limited(ip) {
  const now = Date.now();
  const list = (hits.get(ip) || []).filter(t => now - t < WINDOW_MS);
  list.push(now);
  hits.set(ip, list);
  return list.length > PER_WINDOW;
}

function firstJson(text) {
  const start = text.indexOf('{'), end = text.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON in reply');
  return JSON.parse(text.slice(start, end + 1));
}

// Google's hosted models sometimes answer "Internal error" or an empty reply. Each model gets
// three tries in different modes, then the next model takes over. If all fail, the error says why
// the best model failed, not just the last one.
async function gemma(parts) {
  const errors = [];
  let busy = 0;
  for (const model of MODELS) {
    const call = config => fetch(`${API}/${model.trim()}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': process.env.GEMMA_API_KEY },
      body: JSON.stringify({ contents: [{ role: 'user', parts }], generationConfig: config }),
    });
    // JSON only, temperature 0. Gemma 4 thinks before it answers; minimal thinking keeps it fast.
    const base = { temperature: 0, responseMimeType: 'application/json' };
    const modes = [
      { ...base, maxOutputTokens: 2400, thinkingConfig: { thinkingLevel: 'minimal' } },
      { ...base, maxOutputTokens: 8400 },
      { temperature: 0, maxOutputTokens: 8400 },
    ];
    for (const mode of modes) {
      let res;
      try { res = await call(mode); } catch (e) { errors.push(`${model}: ${e.message}`); continue; }
      if (res.status === 404) { errors.push(`${model}: not available`); break; }
      if (res.status === 429) { busy++; errors.push(`${model}: busy`); break; }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) { errors.push(`${model}: ${data.error?.message || res.status}`); continue; }
      const answer = (data.candidates?.[0]?.content?.parts || []).filter(p => !p.thought).map(p => p.text || '').join('');
      try { return { json: firstJson(answer), model: model.trim() }; } catch (e) { errors.push(`${model}: ${e.message}`); }
    }
  }
  const e = new Error(busy ? 'busy' : errors.find(x => !/not available/.test(x)) || errors[0] || 'no Gemma model available');
  if (busy) e.status = 429;
  e.detail = errors;
  throw e;
}

const ALERT_KEYS = 'bank, direction, amount, balance, account_tail, counterparty, reference, time';
const RECEIPT_KEYS = 'app, status, amount, recipient_name, recipient_account, recipient_bank, sender_name, sender_bank, direction, reference, session_id, time';

export default async function handler(req, res) {
  res.setHeader('Cache-Control', 'no-store');
  const configured = Boolean(process.env.GEMMA_API_KEY);
  if (req.method === 'GET' && configured && /[?&]list=1/.test(req.url || '')) {
    // Which Gemma models this key can reach (names only, never the key).
    const r = await fetch(`${API}?pageSize=1000`, { headers: { 'x-goog-api-key': process.env.GEMMA_API_KEY } });
    const data = await r.json().catch(() => ({}));
    return res.status(200).json({ models: (data.models || []).map(m => m.name.replace('models/', '')).filter(n => /gemma/i.test(n)), trying: MODELS });
  }
  if (req.method === 'GET') return res.status(200).json({ configured, model: MODELS[0] });
  if (req.method !== 'POST') return res.status(405).json({ error: 'method not allowed' });
  if (!configured) return res.status(503).json({ error: 'The online reader is not set up.' });

  const ip = (req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'unknown';
  if (limited(ip)) return res.status(429).json({ error: 'busy' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  try {
    if (body.task === 'alert') {
      const text = focus(String(body.text || '').slice(0, 20000));
      if (!text.trim()) return res.status(400).json({ error: 'empty alert' });
      const suffix = String(body.suffix || '').slice(0, 600);
      const t = Date.now();
      const out = await gemma([{ text: `${alertPrompt(text)}${suffix}\nReply with only a JSON object with the keys ${ALERT_KEYS}.` }]);
      return res.status(200).json({ ...out, ms: Date.now() - t });
    }
    if (body.task === 'receipt') {
      const image = String(body.image || '');
      if (!image || image.length > MAX_IMAGE || !/^[A-Za-z0-9+/=]+$/.test(image)) return res.status(400).json({ error: 'bad image' });
      const t = Date.now();
      const out = await gemma([{ text: `${receiptPrompt()}\nReply with only a JSON object with the keys ${RECEIPT_KEYS}.` }, { inline_data: { mime_type: 'image/jpeg', data: image } }]);
      return res.status(200).json({ ...out, ms: Date.now() - t });
    }
    return res.status(400).json({ error: 'unknown task' });
  } catch (e) {
    if (e.status === 429) return res.status(429).json({ error: 'busy' });
    return res.status(502).json({ error: e.message, detail: e.detail });
  }
}
