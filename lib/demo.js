// The demo shop: one trader's real-format GTBank alerts and five customers to try.
// Its book lives in a separate database, so trying the demo never touches a real book.
import { FORMATS } from './formats.js';

export const SHOP = { biz: 'Ngozi Eze Provisions', account: '0123454821', bank: 'GTBank' };
const A = SHOP.account;
const at = hm => new Date(`2026-10-17T${hm}:00`);

// Morning at the shop: opening balance ₦52,310.50, then six genuine alerts. Chain intact.
const day = [
  { amount: 450000, direction: 'CR', name: 'Aisha Bello', t: '08:14', ref: '100171083344' },
  { amount: 120000, direction: 'CR', name: 'Tunde Adeyemi', t: '08:52', ref: '100171091207' },
  { amount: 1250000, direction: 'DR', name: 'Dangote Sugar Depot', t: '09:30', ref: '100171099861' },
  { amount: 870000, direction: 'CR', name: 'Halima Yusuf', t: '10:05', ref: '100171105522' },
  { amount: 2300000, direction: 'CR', name: 'Emeka Nwosu', t: '10:41', ref: '100171117703' },
  { amount: 5000, direction: 'DR', name: 'Electronic Money Transfer Levy', t: '10:41', ref: '100171117704' },
];
let bal = 5231050;
export const HISTORY = day.map(d => {
  bal += d.direction === 'CR' ? d.amount : -d.amount;
  return FORMATS.gtbank_sms({ account: A, amount: d.amount, balance: bal, direction: d.direction, name: d.name, time: at(d.t), ref: d.ref });
});
export const OPENING = 5231050;
const CLOSING = bal; // ₦87,895.50 after the morning

const pay = (amount, name, t, ref, balance = CLOSING + amount, account = A) =>
  FORMATS.gtbank_sms({ account, amount, balance, direction: 'CR', name, time: at(t), ref });

export const SCENARIOS = {
  real: { label: 'Real transfer', text: pay(1500000, 'Chidi Okafor', '11:20', '100171126618'),
    story: 'Chidi pays ₦15,000 for a carton of Indomie and a bag of rice.' },
  fake: { label: 'Fake alert', text: pay(2500000, 'Ibrahim Musa', '11:22', '100171127730', 26487020),
    story: 'A man buys ₦25,000 of provisions and an alert lands. It looks exactly like GTBank.' },
  replay: { label: 'Old alert sent again', text: HISTORY[4],
    story: 'A customer forwards an alert for ₦23,000 that already came in this morning.' },
  wrongacct: { label: "Someone else's account", text: pay(1800000, 'Segun Bakare', '11:25', '100171128841', CLOSING + 1800000, '0198765432'),
    story: 'An alert for ₦18,000, but it was sent to another account.' },
  shot: { label: 'Customer screenshot', amount: 1500000, sender: 'Chidi Okafor', ref: '250117112907',
    shown: '₦15,000.00', time: '17 Oct 2026, 11:29:07', session: '100004261017102907384920175531',
    story: 'Chidi shows a "Transfer Successful" screenshot from his OPay app and says "I don send am". Then try "Real transfer" to see his alert land.' },
  fakeshot: { label: 'Fake screenshot', amount: 15000000, sender: 'Musa Danjuma', ref: '250117112907',
    shown: '₦150,000.00', time: '17 Oct 2026, 13:05:44', session: '100004261017102907384920175531',
    story: 'A man buying a ₦150,000 phone shows a "Transfer Successful" screenshot. It looks perfect. He edited an old receipt.' },
};

// A customer's screenshot, drawn on a canvas so the demo has a real image for Gemma to read.
export function drawReceipt(s = SCENARIOS.shot) {
  const c = document.createElement('canvas');
  c.width = 540; c.height = 960;
  const g = c.getContext('2d');
  g.fillStyle = '#f3f6f5'; g.fillRect(0, 0, 540, 960);
  g.fillStyle = '#1dcf9f'; g.beginPath(); g.arc(270, 170, 56, 0, Math.PI * 2); g.fill();
  g.strokeStyle = '#fff'; g.lineWidth = 10; g.beginPath(); g.moveTo(244, 172); g.lineTo(264, 192); g.lineTo(300, 150); g.stroke();
  g.fillStyle = '#111'; g.textAlign = 'center';
  g.font = 'bold 34px sans-serif'; g.fillText('Transfer Successful', 270, 280);
  g.font = 'bold 52px sans-serif'; g.fillText(s.shown, 270, 360);
  g.font = '22px sans-serif'; g.fillStyle = '#666'; g.fillText(s.time, 270, 400);
  g.fillStyle = '#fff'; g.fillRect(30, 440, 480, 400);
  const rows = [['Recipient', 'NGOZI EZE PROVISIONS'], ['Bank', 'Guaranty Trust Bank'], ['Account', '0123454821'], ['Sender', s.sender.toUpperCase()], ['Transaction No.', s.ref], ['Session ID', s.session], ['Status', 'Successful']];
  g.textAlign = 'left';
  rows.forEach(([k, v], i) => {
    g.fillStyle = '#777'; g.font = '20px sans-serif'; g.fillText(k, 50, 490 + i * 56);
    g.fillStyle = '#111'; g.font = k === 'Session ID' ? 'bold 15px sans-serif' : 'bold 20px sans-serif'; g.textAlign = 'right'; g.fillText(v, 490, 490 + i * 56); g.textAlign = 'left';
  });
  g.fillStyle = '#1dcf9f'; g.font = 'bold 26px sans-serif'; g.textAlign = 'center'; g.fillText('OPay', 270, 900);
  return c.toDataURL('image/jpeg', 0.9).split(',')[1];
}
