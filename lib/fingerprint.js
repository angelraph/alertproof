// How an alert is written, learned from the trader's own genuine alerts for each bank.
// Supporting evidence only: banks do change formats, so a different look never blocks a payment
// by itself. It just tells the trader what looks off.

const LABEL = /([A-Za-z][A-Za-z .\/]{0,18}?)\s?:/g;

export function features(text) {
  const t = String(text);
  const labels = [...t.matchAll(LABEL)].map(m => m[1].trim().toLowerCase()).filter(l => l.length > 1 && !/^https?$/.test(l));
  const currency = /NGN/.test(t) ? 'NGN' : /₦/.test(t) ? '₦' : /\bN\d/.test(t) ? 'N' : 'none';
  const dateShape = (t.match(/\d{1,4}[-\/.](?:\d{1,2}|[A-Za-z]{3})[-\/.]\d{2,4}/) || [''])[0]
    .replace(/\d/g, '9').replace(/[A-Za-z]{3}/, 'Mon');
  const decimals = /\d\.\d{2}\b/.test(t);
  return { labels, currency, dateShape, decimals };
}

// profile: merged features of several genuine alerts from one bank.
export function learn(texts) {
  const labels = new Set(), currency = new Set(), dateShape = new Set(), decimals = new Set();
  for (const t of texts) {
    const f = features(t);
    f.labels.forEach(l => labels.add(l));
    currency.add(f.currency); dateShape.add(f.dateShape); decimals.add(f.decimals);
  }
  return { n: texts.length, labels: [...labels], currency: [...currency], dateShape: [...dateShape], decimals: [...decimals] };
}

// Plain-language differences between a new alert and the bank's usual format.
export function differences(text, profile) {
  if (!profile || profile.n < 2) return [];
  const f = features(text), out = [];
  const usual = new Set(profile.labels);
  const extra = f.labels.filter(l => !usual.has(l));
  const missing = profile.labels.filter(l => !f.labels.includes(l));
  if (extra.length) out.push(`uses labels your real alerts never use: ${extra.map(l => `"${l}:"`).join(', ')}`);
  if (missing.length && missing.length >= profile.labels.length / 2) out.push(`is missing labels your real alerts always have: ${missing.map(l => `"${l}:"`).join(', ')}`);
  if (!profile.currency.includes(f.currency)) out.push(`writes money as "${f.currency}", your real alerts use "${profile.currency.join('" or "')}"`);
  if (f.dateShape && !profile.dateShape.includes(f.dateShape)) out.push(`writes the date as ${f.dateShape}, your real alerts use ${profile.dateShape.filter(Boolean).join(' or ') || 'no date'}`);
  if (!profile.decimals.includes(f.decimals)) out.push(f.decimals ? 'shows kobo where your real alerts don’t' : 'leaves out the kobo your real alerts show');
  return out;
}
