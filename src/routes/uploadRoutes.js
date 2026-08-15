// /api/uploads/* — generic authenticated file upload/download used by
// assignments, forum posts, avatars, etc.
const express = require('express');
const { requireAuth } = require('../auth');
const uploads = require('../uploads');

const router = express.Router();

router.post('/', requireAuth, (req, res) => {
  uploads.multerUpload.single('file')(req, res, (err) => {
    if (err) return res.status(400).json({ ok: false, error: err.message });
    if (!req.file) return res.status(400).json({ ok: false, error: 'No file provided (field name must be "file")' });
    const record = uploads.recordUpload({
      userId: req.user.id,
      filename: req.file.filename,
      originalName: req.file.originalname,
      mimeType: req.file.mimetype,
      size: req.file.size,
      purpose: req.body?.purpose || 'general',
    });
    res.status(201).json({ ok: true, upload: record });
  });
});

router.get('/mine', requireAuth, (req, res) => {
  res.json({ ok: true, uploads: uploads.listForUser(req.user.id) });
});

router.get('/:id/download', requireAuth, (req, res) => {
  const upload = uploads.getUpload(req.params.id);
  if (!upload) return res.status(404).json({ ok: false, error: 'Not found' });
  res.download(uploads.absolutePath(upload), upload.original_name);
});

router.delete('/:id', requireAuth, (req, res) => {
  try {
    const removed = uploads.deleteUpload(req.params.id, req.user.id, ['admin', 'ai-admin'].includes(req.user.role));
    if (!removed) return res.status(404).json({ ok: false, error: 'Not found' });
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

module.exports = router;
