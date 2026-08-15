// /api/fees/:id/receipt.pdf — real downloadable PDF receipt for a paid fee.
// Mounted separately from the existing /api/fees routes in dataRoutes.js
// so that file is never touched.
const express = require('express');
const { requireAuth } = require('../auth');
const { db } = require('../db');
const feeReceipt = require('../feeReceipt');

const router = express.Router();

function canSeeStudent(user, studentId) {
  if (['admin', 'ai-admin', 'faculty'].includes(user.role)) return true;
  if (user.role === 'student') return user.id === studentId;
  if (user.role === 'parent') return user.linkedStudentId === studentId;
  return false;
}

router.get('/:id/receipt.pdf', requireAuth, async (req, res) => {
  try {
    const fee = db.prepare('SELECT * FROM fees WHERE id = ?').get(req.params.id);
    if (!fee) return res.status(404).json({ ok: false, error: 'Fee record not found' });
    if (!canSeeStudent(req.user, fee.student_id)) return res.status(403).json({ ok: false, error: 'Not authorized' });

    const { buffer, receiptNumber } = await feeReceipt.generateReceiptForFee(req.params.id);
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${receiptNumber}.pdf"`);
    res.send(buffer);
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message || 'Failed to generate receipt' });
  }
});

module.exports = router;
