// Two places Gemma can run, same prompts:
// local  = Ollama on the shop's own laptop (private, works with no internet; the default when present)
// online = Gemma 4 hosted by Google, through this site's api/read function, for phones without a laptop
import { ALERT_SCHEMA, RECEIPT_SCHEMA, alertPrompt, receiptPrompt } from './prompts.js';
import { readAlert } from './read.js';

export async function localHealth(base, model) {
  const res = await fetch(`${base}/api/tags`);
  if (!res.ok) throw new Error(`Ollama answered ${res.status}`);
  const { models = [] } = await res.json();
  return models.some(m => m.name === model || m.model === model);
}

export async function ollamaChat(base, model, content, schema, images) {
  const res = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      model, stream: false, format: schema,
      messages: [{ role: 'user', content, ...(images ? { images } : {}) }],
      keep_alive: '30m', options: { temperature: 0, num_predict: 300 },
    }),
  });
  if (!res.ok) throw new Error(`Ollama answered ${res.status}`);
  const { message } = await res.json();
  return JSON.parse(message.content);
}

export class Busy extends Error {}

// One call with a time limit; one automatic retry on a busy or failed answer.
async function online(body, timeout = 45000) {
  let last;
  for (let attempt = 0; attempt < 2; attempt++) {
    if (attempt) await new Promise(r => setTimeout(r, 1500));
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), timeout);
    try {
      const res = await fetch('api/read', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
      const data = await res.json().catch(() => ({}));
      if (res.ok && data.json) return data;
      last = res.status === 429 || data.error === 'busy' ? new Busy('The online reader is busy.') : new Error(data.error || `Online reader answered ${res.status}`);
    } catch (e) {
      last = e.name === 'AbortError' ? new Error('The online reader took too long.') : e;
    } finally { clearTimeout(timer); }
  }
  throw last;
}

export async function onlineHealth() {
  const res = await fetch('api/read', { cache: 'no-store' }).catch(() => null);
  if (!res?.ok) return null;
  const data = await res.json();
  return data.configured ? data : null;
}

// where: { kind: 'local', base, model } | { kind: 'online' }
export function reader(where) {
  const askAlert = text => suffix => where.kind === 'local'
    ? ollamaChat(where.base, where.model, alertPrompt(text) + suffix, ALERT_SCHEMA)
    : online({ task: 'alert', text, suffix }).then(d => d.json);
  return {
    alert: text => readAlert(text, askAlert(text)),
    receipt: imageB64 => where.kind === 'local'
      ? ollamaChat(where.base, where.model, receiptPrompt(), RECEIPT_SCHEMA, [imageB64])
      : online({ task: 'receipt', image: imageB64 }).then(d => d.json),
  };
}
