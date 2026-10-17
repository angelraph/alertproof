// Records real Gemma readings of the demo shop's alerts, so the live demo works for visitors
// who have no Gemma of their own. Every reading in lib/recorded.js came from this script.
//   node eval/record-demo.mjs [model]      (needs Ollama running)
import { writeFile, readFile } from 'node:fs/promises';
import { ollamaChat } from '../lib/model.js';
import { ALERT_SCHEMA, alertPrompt, retryNote } from '../lib/prompts.js';
import { ground } from '../lib/ground.js';
import { normalise } from '../lib/read.js';
import { HISTORY, SCENARIOS } from '../lib/demo.js';

const model = process.argv[2] || 'gemma3:4b';
const base = 'http://localhost:11434';
const file = new URL('../lib/recorded.js', import.meta.url);

let existing = {};
try { existing = (await import(file.href)).RECORDED; } catch {}
const out = { ...existing };

const texts = [...HISTORY, ...Object.values(SCENARIOS).map(s => s.text).filter(Boolean)];
for (const text of texts) {
  if (out[text]?.model === model) continue;
  const t = Date.now();
  let json = await ollamaChat(base, model, alertPrompt(text), ALERT_SCHEMA);
  let tries = 1;
  const { rejected } = ground(normalise(json), text);
  if (rejected.length) { json = await ollamaChat(base, model, alertPrompt(text) + retryNote(rejected), ALERT_SCHEMA); tries = 2; }
  out[text] = { model, json, tries, ms: Date.now() - t };
  console.log(`${((Date.now() - t) / 1000).toFixed(1)}s`, JSON.stringify(json));
  await save();
}
await save();

async function save() {
  await writeFile(file, `// Real Gemma readings of the demo shop's alerts, written by eval/record-demo.mjs. Do not edit by hand.\nexport const RECORDED = ${JSON.stringify(out, null, 1)};\n`);
}
