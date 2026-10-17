// What Gemma is asked. Shared by the local model (Ollama), the hosted one (api/read.js) and the eval,
// so every path reads alerts the same way.

export const ALERT_SCHEMA = {
  type: 'object',
  properties: {
    bank: { type: 'string' },
    direction: { type: 'string', enum: ['CR', 'DR', 'unknown'] },
    amount: { type: 'string' },
    balance: { type: 'string' },
    account_tail: { type: 'string' },
    counterparty: { type: 'string' },
    reference: { type: 'string' },
    time: { type: 'string' },
  },
  required: ['bank', 'direction', 'amount', 'balance', 'account_tail', 'counterparty', 'reference', 'time'],
};

export const alertPrompt = text => `You read Nigerian bank and fintech transaction alerts (SMS, app notifications, emails).
Copy values exactly as written in the alert. Never calculate, never guess. Use "" for anything the alert does not show.

- bank: the bank or app that sent it (GTBank, Access, Zenith, UBA, First Bank, OPay, Moniepoint, PalmPay, ...)
- direction: "CR" if money came IN (credit, received, money in), "DR" if money went OUT (debit, paid, money out)
- amount: the transaction amount, digits as written, e.g. "15,000.00"
- balance: the available balance after the transaction, digits as written. If there are several balances, use "Available". "" if none.
- account_tail: the last visible digits of the account number, e.g. "0******821" -> "821"
- counterparty: who sent or received the money, if named
- reference: the transaction reference or session ID, if shown
- time: date and time as written

Alert:
"""
${text.slice(0, 3000)}
"""`;

export const retryNote = rejected => `\nYour last answer gave values that are not in the alert: ${rejected.map(r => `${r.field} "${r.value}"`).join(', ')}. Copy only what is written; use "" if it is not there.`;

export const RECEIPT_SCHEMA = {
  type: 'object',
  properties: {
    app: { type: 'string' },
    status: { type: 'string' },
    amount: { type: 'string' },
    recipient_name: { type: 'string' },
    recipient_account: { type: 'string' },
    recipient_bank: { type: 'string' },
    sender_name: { type: 'string' },
    sender_bank: { type: 'string' },
    direction: { type: 'string', enum: ['sent', 'received', 'unknown'] },
    reference: { type: 'string' },
    session_id: { type: 'string' },
    time: { type: 'string' },
  },
  required: ['app', 'status', 'amount', 'recipient_name', 'recipient_account', 'recipient_bank', 'sender_name', 'sender_bank', 'direction', 'reference', 'session_id', 'time'],
};

export const receiptPrompt = () => `This is a screenshot of a bank transfer: either a sender's "Transfer Successful" receipt, or a "received" transaction record.
Read what is written on it. Copy values exactly; use "" for anything not shown. Never guess.
- app: the bank or app the screenshot is from
- status: the status words shown (e.g. "Successful", "Pending", "Transfer Successful")
- amount: the amount sent, digits as written
- recipient_name, recipient_account, recipient_bank: who the money was sent TO
- sender_name, sender_bank: who sent it, and their bank or app
- direction: "sent" if it is the sender's receipt, "received" if it records money coming in
- reference: the transaction ID or reference
- session_id: the long Session ID, usually 30 digits. Copy every digit exactly, in order. "" if none.
- time: date and time exactly as written`;
