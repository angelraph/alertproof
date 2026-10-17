// NIP session IDs: the fingerprint every Nigerian interbank transfer carries.
// A NIBSS Instant Payment session ID is 30 digits:
//   6 digits   the sending institution's code   (090645 = Nombank MFB, 000013 = GTBank, 100004 = OPay)
//   12 digits  when the transfer happened       (yyMMddHHmmss)
//   12 digits  a unique number
// Receipt generators and edited screenshots rarely keep all three consistent with the rest of the
// receipt. This file reads the ID and checks it against the time and bank printed beside it.
// Pure code: nothing here depends on a model.

// Institution codes we're sure of. An unknown code is never held against a receipt.
export const BANKS = {
  '000001': 'Sterling', '000002': 'Keystone', '000003': 'FCMB', '000004': 'UBA', '000005': 'Access',
  '000006': 'Jaiz', '000007': 'Fidelity', '000008': 'Polaris', '000010': 'Ecobank', '000011': 'Unity',
  '000012': 'Stanbic IBTC', '000013': 'GTBank', '000014': 'Access', '000015': 'Zenith', '000016': 'First Bank',
  '000017': 'Wema', '000018': 'Union', '000020': 'Heritage', '000023': 'Providus', '000025': 'Titan Trust',
  '000027': 'Globus', '100004': 'OPay', '100033': 'PalmPay', '090267': 'Kuda', '090405': 'Moniepoint',
  '100002': 'Paga', '090645': 'Nombank',
};
const ALIASES = { GTBank: /gtb|guaranty/i, 'First Bank': /first\s?bank|fbn/i, UBA: /\buba\b|united bank/i, 'Stanbic IBTC': /stanbic/i, Nombank: /nombank|nomba/i, OPay: /opay|paycom/i, PalmPay: /palm\s?pay/i };
const named = (bank, text) => (ALIASES[bank] || new RegExp(bank.replace(/\s+/g, '\\s?'), 'i')).test(text);

const MONTHS = { jan: 0, feb: 1, mar: 2, apr: 3, may: 4, jun: 5, jul: 6, aug: 7, sep: 8, sept: 8, oct: 9, nov: 10, dec: 11 };

// Every 30-digit run (spaces allowed inside, as some apps group the digits).
export function findSessions(text) {
  return [...String(text).matchAll(/(?<!\d)(\d[\d ]{28,40}\d)(?!\d)/g)]
    .map(m => m[1].replace(/ /g, '')).filter(d => d.length === 30);
}

export function decode(id) {
  const code = id.slice(0, 6), t = id.slice(6, 18);
  const [yy, MM, dd, HH, mm, ss] = [0, 2, 4, 6, 8, 10].map(i => +t.slice(i, i + 2));
  const valid = MM >= 1 && MM <= 12 && dd >= 1 && dd <= 31 && HH < 24 && mm < 60 && ss < 60;
  const at = valid ? new Date(Date.UTC(2000 + yy, MM - 1, dd, HH, mm, ss)) : null;
  if (at && at.getUTCDate() !== dd) return { id, code, bank: BANKS[code] || null, at: null, valid: false };
  return { id, code, bank: BANKS[code] || null, at, valid };
}

// Times written on the receipt, as minutes since midnight plus the calendar day.
export function shownTimes(text) {
  const s = String(text), out = [];
  const hm = (h, m, ap) => { h = +h; if (ap) { ap = ap.toLowerCase(); if (ap === 'pm' && h < 12) h += 12; if (ap === 'am' && h === 12) h = 0; } return h * 60 + +m; };
  // A date, then within a few words a time: "16/10/2026 20:10:57", "Oct 16, 2026 08:10 PM", "2026-10-16 20:10"
  const dates = [];
  for (const m of s.matchAll(/(\d{1,2})[\/\-.](\d{1,2})[\/\-.](\d{4})/g)) dates.push({ i: m.index, end: m.index + m[0].length, y: +m[3], M: +m[2] - 1, d: +m[1] });
  for (const m of s.matchAll(/(\d{4})-(\d{2})-(\d{2})/g)) dates.push({ i: m.index, end: m.index + m[0].length, y: +m[1], M: +m[2] - 1, d: +m[3] });
  for (const m of s.matchAll(/\b([A-Za-z]{3,9})\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/g)) { const M = MONTHS[m[1].slice(0, 4).toLowerCase()] ?? MONTHS[m[1].slice(0, 3).toLowerCase()]; if (M != null) dates.push({ i: m.index, end: m.index + m[0].length, y: +m[3], M, d: +m[2] }); }
  for (const m of s.matchAll(/\b(\d{1,2})(?:st|nd|rd|th)?\s+([A-Za-z]{3,9})\.?,?\s+(\d{4})/g)) { const M = MONTHS[m[2].slice(0, 4).toLowerCase()] ?? MONTHS[m[2].slice(0, 3).toLowerCase()]; if (M != null) dates.push({ i: m.index, end: m.index + m[0].length, y: +m[3], M, d: +m[1] }); }
  for (const m of s.matchAll(/\b(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?/g)) {
    // The nearest date within 40 characters, before or after the time.
    const near = dates.map(d => ({ d, gap: m.index >= d.end ? m.index - d.end : d.i - (m.index + m[0].length) })).filter(x => x.gap >= 0 && x.gap <= 40).sort((a, b) => a.gap - b.gap)[0];
    if (!near) continue;
    out.push({ y: near.d.y, M: near.d.M, d: near.d.d, minutes: hm(m[1], m[2], m[4]), seconds: m[3] != null ? +m[3] : null, raw: m[0] });
  }
  return out;
}

const fmt = d => d.toLocaleString('en-NG', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false });

// checks: [{ ok: true|false|null, text }]. A false means the receipt contradicts itself.
export function sessionChecks(text, now = Date.now()) {
  const ids = findSessions(text);
  if (!ids.length) return { found: false, checks: [] };
  const s = decode(ids[0]);
  const checks = [];
  if (!s.valid) {
    checks.push({ id: 'session', ok: false, text: `The session ID ${s.id.slice(0, 6)} ${s.id.slice(6, 18)} … holds an impossible date and time. Real transfers can't have one: this receipt was made up.` });
    return { found: true, session: s, checks };
  }
  if (s.at.getTime() - now > 36 * 3600e3) checks.push({ id: 'session', ok: false, text: `The session ID says this transfer happens on ${fmt(s.at)}, in the future. This receipt was made up.` });
  const shown = shownTimes(text);
  if (shown.length) {
    // Apps show local time (UTC+1); some sending banks stamp the ID in UTC. Allow exactly those two.
    const sessMin = s.at.getUTCHours() * 60 + s.at.getUTCMinutes();
    const match = shown.find(t => {
      const sameDay = t.y === s.at.getUTCFullYear() && t.M === s.at.getUTCMonth() && Math.abs(t.d - s.at.getUTCDate()) <= 1;
      if (!sameDay) return false;
      const dayShift = (t.d - s.at.getUTCDate()) * 1440;
      const diff = t.minutes + dayShift - sessMin;
      return [0, 60].some(off => Math.abs(diff - off) <= 2);
    });
    if (match) checks.push({ id: 'session', ok: true, text: `Session ID time (${fmt(s.at)}) matches the time on the receipt (${match.raw}).` });
    else checks.push({ id: 'session', ok: false, text: `The session ID says the transfer happened ${fmt(s.at)}, but the receipt shows ${shown[0].raw} on ${shown[0].d}/${shown[0].M + 1}/${shown[0].y}. An edited or generated receipt.` });
  } else checks.push({ id: 'session', ok: null, text: `Session ID says ${fmt(s.at)}. The receipt shows no date and time to compare it with.` });
  if (s.bank) {
    if (named(s.bank, text)) checks.push({ id: 'session-bank', ok: true, text: `Session ID bank code ${s.code} is ${s.bank}, and the receipt names ${s.bank}.` });
    else checks.push({ id: 'session-bank', ok: null, text: `Session ID bank code ${s.code} is ${s.bank}, which the receipt doesn't name. Check who sent it.` });
  }
  return { found: true, session: s, checks };
}
