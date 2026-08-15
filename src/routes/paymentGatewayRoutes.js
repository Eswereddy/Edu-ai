// /api/payments/* — Demo Payment Gateway (UPI/Card). New prefix, does
// not touch or overlap with the existing /api/fees routes in
// dataRoutes.js. A parent may pay on behalf of any child resolved via
// parentChildren.resolveChildrenIds(); a student may only pay their own
// fee (feeId's student must match req.user.id).
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const { db } = require('../db');
const gateway = require('../paymentGateway');
const parentChildren = require('../parentChildren');
const notify = require('../notify');
const audit = require('../audit');

const router = express.Router();

router.post('/pay', requireAuth, requireRole('student', 'parent'), (req, res) => {
  try {
    const feeId = req.body?.feeId;
    const fee = db.prepare('SELECT student_id FROM fees WHERE id = ?').get(feeId);
    if (!fee) return res.status(404).json({ ok: false, error: 'Fee record not found' });

    if (req.user.role === 'parent') {
      const childIds = parentChildren.resolveChildrenIds(req.user);
      if (!childIds.includes(fee.student_id)) {
        return res.status(403).json({ ok: false, error: 'Not authorized for this student' });
      }
    } else if (fee.student_id !== req.user.id) {
      return res.status(403).json({ ok: false, error: 'Not authorized for this fee record' });
    }

    const tx = gateway.payFee({ ...req.body, paidBy: req.user.id });
    audit.record(req.user.id, 'pay', 'fee', tx.fee_id, { method: tx.method, status: tx.status, ref: tx.transaction_ref });
    if (tx.status === 'success') {
      notify.send(tx.student_id, {
        title: 'Fee payment successful',
        body: `Rs. ${Number(tx.amount).toFixed(2)} paid via ${tx.method.toUpperCase()} (ref ${tx.transaction_ref}).`,
        type: 'fee_paid',
        meta: { feeId: tx.fee_id, transactionId: tx.id },
      });
    }
    res.status(tx.status === 'success' ? 201 : 402).json({ ok: tx.status === 'success', transaction: tx });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/mine/:studentId', requireAuth, (req, res) => {
  if (req.params.studentId !== req.user.id) {
    if (req.user.role === 'parent') {
      const childIds = parentChildren.resolveChildrenIds(req.user);
      if (!childIds.includes(req.params.studentId)) return res.status(403).json({ ok: false, error: 'Not authorized' });
    } else if (!['admin', 'ai-admin'].includes(req.user.role)) {
      return res.status(403).json({ ok: false, error: 'Not authorized' });
    }
  }
  res.json({ ok: true, transactions: gateway.listForStudent(req.params.studentId) });
});

module.exports = router;
