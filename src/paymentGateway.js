// Demo Payment Gateway (UPI/Card) — a fully simulated payment flow for
// the existing `fees` table. No real money moves and no real payment
// processor is called; this generates a realistic transaction record
// (masked card/UPI detail, a transaction reference, success/failure)
// and, on success, marks the fee row 'paid' the same way the existing
// POST /api/fees/:id/pay endpoint does. That existing route in
// dataRoutes.js is untouched — this is a separate, additive path for a
// richer checkout experience with method selection and receipts.

const crypto = require('crypto');
const { db } = require('./db');

db.exec(`
CREATE TABLE IF NOT EXISTS payment_transactions (
  id TEXT PRIMARY KEY,
  fee_id TEXT NOT NULL,
  student_id TEXT NOT NULL,
  paid_by TEXT NOT NULL,
  amount REAL NOT NULL,
  method TEXT NOT NULL CHECK(method IN ('upi','card')),
  masked_detail TEXT,
  status TEXT NOT NULL DEFAULT 'success' CHECK(status IN ('success','failed')),
  failure_reason TEXT,
  transaction_ref TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_payment_tx_student ON payment_transactions(student_id);
CREATE INDEX IF NOT EXISTS idx_payment_tx_fee ON payment_transactions(fee_id);
`);

function uid() {
  return crypto.randomUUID();
}

function maskCard(number) {
  const digits = String(number || '').replace(/\D/g, '');
  if (digits.length < 4) return 'Card ****';
  return `Card **** ${digits.slice(-4)}`;
}

function maskUpi(upiId) {
  const s = String(upiId || '');
  const at = s.indexOf('@');
  if (at <= 1) return 'UPI ***';
  return `${s[0]}***${s.slice(at)}`;
}

// Well-known "test card" decline numbers (same idea real sandboxes like
// Stripe/Razorpay use) so the demo has a realistic failure path anyone
// can trigger on purpose, without random real-looking cards failing.
const TEST_DECLINE_CARDS = {
  '4000000000000002': 'Card declined by issuing bank (test card)',
  '4000000000009995': 'Insufficient funds (test card)',
};

function payFee({ feeId, paidBy, method, upiId, cardNumber, cardExpiry, cardCvv }) {
  const fee = db.prepare('SELECT * FROM fees WHERE id = ?').get(feeId);
  if (!fee) throw Object.assign(new Error('Fee record not found'), { status: 404 });
  if (fee.status === 'paid') throw Object.assign(new Error('This fee is already marked paid'), { status: 409 });
  if (!['upi', 'card'].includes(method)) {
    throw Object.assign(new Error("method must be 'upi' or 'card'"), { status: 400 });
  }

  let maskedDetail;
  let success = true;
  let failureReason = null;

  if (method === 'upi') {
    if (!upiId || !upiId.includes('@')) {
      throw Object.assign(new Error('A valid UPI ID (name@bank) is required'), { status: 400 });
    }
    maskedDetail = maskUpi(upiId);
  } else {
    if (!cardNumber || !cardExpiry || !cardCvv) {
      throw Object.assign(new Error('Card number, expiry and CVV are required'), { status: 400 });
    }
    const digits = String(cardNumber).replace(/\D/g, '');
    if (TEST_DECLINE_CARDS[digits]) {
      success = false;
      failureReason = TEST_DECLINE_CARDS[digits];
    }
    maskedDetail = maskCard(cardNumber);
  }

  const id = uid();
  const ref = `TXN${Date.now().toString(36).toUpperCase()}${crypto.randomBytes(2).toString('hex').toUpperCase()}`;
  db.prepare(
    `INSERT INTO payment_transactions (id, fee_id, student_id, paid_by, amount, method, masked_detail, status, failure_reason, transaction_ref)
     VALUES (?,?,?,?,?,?,?,?,?,?)`
  ).run(id, feeId, fee.student_id, paidBy, fee.amount, method, maskedDetail, success ? 'success' : 'failed', failureReason, ref);

  if (success) {
    db.prepare(`UPDATE fees SET status = 'paid', paid_at = datetime('now') WHERE id = ?`).run(feeId);
  }

  return getTransaction(id);
}

function getTransaction(id) {
  return db.prepare('SELECT * FROM payment_transactions WHERE id = ?').get(id) || null;
}

function listForStudent(studentId) {
  return db.prepare('SELECT * FROM payment_transactions WHERE student_id = ? ORDER BY created_at DESC').all(studentId);
}

module.exports = { payFee, getTransaction, listForStudent, TEST_DECLINE_CARDS };
