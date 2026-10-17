// Naira amounts as integer kobo, so the chain arithmetic is exact.

// "NGN15,000.00", "₦15,000", "N 15,000.5", "15000" -> 1500000. Returns null if it isn't a number.
export function toKobo(value) {
  if (typeof value === 'number') return Number.isFinite(value) ? Math.round(value * 100) : null;
  if (typeof value !== 'string') return null;
  const s = value.replace(/NGN|₦|₩|\bN(?=\s?\d)|naira/gi, '').replace(/[\s,+]/g, '');
  const m = s.match(/^-?\d+(\.\d{1,2})?/);
  if (!m) return null;
  const [whole, frac = ''] = m[0].split('.');
  const sign = whole.startsWith('-') ? -1 : 1;
  return sign * (Math.abs(parseInt(whole, 10)) * 100 + parseInt((frac + '00').slice(0, 2), 10));
}

export function naira(kobo) {
  if (kobo == null) return '—';
  const sign = kobo < 0 ? '-' : '';
  const abs = Math.abs(kobo);
  const whole = Math.floor(abs / 100).toLocaleString('en-NG');
  const frac = String(abs % 100).padStart(2, '0');
  return `${sign}₦${whole}${frac === '00' ? '' : '.' + frac}`;
}

// Every money-looking number in a piece of text, as kobo. "15,000.00" and "15000" both count.
export function amountsIn(text) {
  const out = new Set();
  for (const m of String(text).matchAll(/(-?)(\d{1,3}(?:,\d{3})+(?:\.\d{1,2})?|\d+(?:\.\d{1,2})?)/g)) {
    const k = toKobo(m[2]);
    if (k == null) continue;
    out.add(k);
    // An overdrawn balance is written "-223.00": keep its sign too.
    if (m[1]) out.add(-k);
  }
  return out;
}
