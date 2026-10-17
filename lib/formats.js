// Alert formats modelled on the SMS, push and email alerts Nigerian banks and fintechs send.
// Each renders the same ground-truth fields, so the eval knows the right answer for every alert.
// f: { account: '0123454821', amount: kobo, balance: kobo, direction: 'CR'|'DR', name, time: Date, ref }

const n = k => (k / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const n0 = k => (k / 100).toLocaleString('en-US', { minimumFractionDigits: k % 100 ? 2 : 0, maximumFractionDigits: 2 });
const p2 = x => String(x).padStart(2, '0');
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const ymd = d => `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}`;
const dmy = (d, s = '/') => `${p2(d.getDate())}${s}${p2(d.getMonth() + 1)}${s}${d.getFullYear()}`;
const dMy = d => `${p2(d.getDate())}-${MON[d.getMonth()]}-${d.getFullYear()}`;
const hm = d => `${p2(d.getHours())}:${p2(d.getMinutes())}`;
const hms = d => `${hm(d)}:${p2(d.getSeconds())}`;
const mask = (a, keep = 3) => a[0] + '*'.repeat(6) + a.slice(-keep);
const desc = f => f.direction === 'CR' ? `TRF FROM ${f.name.toUpperCase()}` : `POS PURCHASE ${f.name.toUpperCase()}`;

export const FORMATS = {
  gtbank_sms: f => `Acct: ${mask(f.account)}\nAmt: NGN${n(f.amount)} ${f.direction}\nDesc: ${desc(f)}/${f.ref}\nAvail Bal: NGN${n(f.balance)}\nDate: ${ymd(f.time)} ${hms(f.time)}`,
  access_sms: f => `${f.direction === 'CR' ? 'Credit' : 'Debit'}\nAmt:NGN${n(f.amount)}\nAcc:${f.account.slice(0, 3)}**${f.account.slice(-3)}\nDesc:${desc(f)}\nDate:${dmy(f.time)}\nAvail Bal:NGN${n(f.balance)}\nTotal:NGN${n(f.balance)}`,
  zenith_sms: f => `Acct:${f.account.slice(0, 2)}**${f.account.slice(4, 7)}**${f.account.slice(-2)}\nDT:${dmy(f.time)} ${hms(f.time)}\nNIP/${f.name.toUpperCase()}/${f.ref}\n${f.direction} Amt:${n(f.amount)}\nBal:${n(f.balance)}`,
  uba_sms: f => `Txn: ${f.direction === 'CR' ? 'Credit' : 'Debit'}\nAc:${f.account[0]}XX..XX${f.account.slice(-3)}\nAmt:NGN ${n(f.amount)}\nDes:${desc(f)}\nDate:${dMy(f.time)} ${hm(f.time)}\nBal:NGN ${n(f.balance)} CR`,
  firstbank_sms: f => `${f.direction === 'CR' ? 'Credit' : 'Debit'} Alert! Acct: ${f.account.slice(0, 3)}XXXX${f.account.slice(-3)} Amt: NGN${n(f.amount)} Date: ${dMy(f.time).toUpperCase()} ${hms(f.time)} Desc: ${desc(f)} Bal: NGN${n(f.balance)}CR. Dial *894# for quick airtime/data purchase`,
  opay_push: f => f.direction === 'CR'
    ? `You have received ₦${n(f.amount)} from ${f.name.toUpperCase()}. Your OPay balance is ₦${n(f.balance)}. Ref: ${f.ref}`
    : `You paid ₦${n(f.amount)} to ${f.name.toUpperCase()}. Your OPay balance is ₦${n(f.balance)}. Ref: ${f.ref}`,
  moniepoint_sms: f => `${f.direction === 'CR' ? 'Credit' : 'Debit'}: NGN${n0(f.amount)} ${f.direction === 'CR' ? 'from' : 'to'} ${f.name} ${f.direction === 'CR' ? 'to' : 'from'} ${f.account.slice(0, 2)}****${f.account.slice(-4)}. Bal: NGN${n0(f.balance)}. Ref:${f.ref}. ${dmy(f.time, '-')} ${hm(f.time)}`,
  palmpay_push: f => `[PalmPay] ${f.direction === 'CR' ? 'Money In' : 'Money Out'}: N${n(f.amount)} ${f.direction === 'CR' ? 'from' : 'to'} ${f.name}. Available balance N${n(f.balance)}. ${ymd(f.time)} ${hm(f.time)}`,
  gtbank_email: f => `Guaranty Trust Bank Electronic Notification Service (GeNS)\n\nDear Customer,\n\nWe wish to inform you that a ${f.direction === 'CR' ? 'Credit' : 'Debit'} transaction occurred on your account with us.\n\nThe details of this transaction are shown below:\n\nTransaction Notification\nAccount Number : ${mask(f.account, 4)}\nTransaction Location : 205\nDescription : ${desc(f)} REF ${f.ref}\nAmount : NGN ${n(f.amount)}\nValue Date : ${dMy(f.time)}\nRemarks : ${f.direction === 'CR' ? 'Transfer' : 'Purchase'}\nTime of Transaction : ${hm(f.time)}\nDocument Number : ${f.ref.slice(-6)}\n\nThe balances on this account as at ${hm(f.time)} are as follows:\nCurrent Balance : NGN ${n(f.balance)}\nAvailable Balance : NGN ${n(f.balance)}\n\nThank you for choosing GTBank.`,
  access_email: f => `Access Bank Transaction Alert\n\nDear Customer,\n\nYour account has been ${f.direction === 'CR' ? 'credited' : 'debited'}.\n\nAccount Number: ${f.account.slice(0, 3)}*****${f.account.slice(-2)}\nTransaction Type: ${f.direction === 'CR' ? 'CREDIT' : 'DEBIT'}\nAmount: NGN${n(f.amount)}\nNarration: ${desc(f)}\nDate & Time: ${dmy(f.time)} ${hms(f.time)}\nAvailable Balance: NGN${n(f.balance)}\nReference: ${f.ref}\n\nMore Information? Call 01-2712005.`,
};

// Formats the eval holds back from any prompt example, to test reading a bank it has never seen.
export const UNSEEN = ['zenith_sms', 'palmpay_push', 'access_email'];

// A trader's day: a run of genuine credits and debits for one account, chain intact.
export function day(account, start, opening, seed = 1) {
  let s = seed, bal = opening;
  const rand = () => ((s = (s * 16807) % 2147483647) / 2147483647);
  const names = ['Chidi Okafor', 'Aisha Bello', 'Tunde Adeyemi', 'Ngozi Eze', 'Ibrahim Musa', 'Funke Akindele', 'Emeka Nwosu', 'Halima Yusuf', 'Segun Bakare', 'Blessing Udo'];
  const out = [];
  let t = new Date(start);
  for (let i = 0; i < 8; i++) {
    t = new Date(t.getTime() + (20 + Math.floor(rand() * 70)) * 60e3);
    const direction = rand() < 0.75 ? 'CR' : 'DR';
    const amount = (direction === 'CR' ? [1500, 2700, 4200, 8500, 15000, 23000, 50000] : [900, 3000, 12000])[Math.floor(rand() * (direction === 'CR' ? 7 : 3))] * 100
      + (rand() < 0.3 ? Math.floor(rand() * 99) : 0);
    bal += direction === 'CR' ? amount : -amount;
    const ref = String(100000000000 + Math.floor(rand() * 899999999999));
    out.push({ account, amount, balance: bal, direction, name: names[Math.floor(rand() * names.length)], time: t, ref });
  }
  return out;
}
