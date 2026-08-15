// /api/forum/* — discussion threads, replies, voting, moderation.
const express = require('express');
const { requireAuth, requireRole } = require('../auth');
const forum = require('../forum');
const gamification = require('../gamification');
const audit = require('../audit');
const notify = require('../notify'); // additive: notify thread owner on new reply
const { writeLimiter } = require('../rateLimiters'); // additive: throttle write-heavy forum posts

const router = express.Router();

router.post('/threads', requireAuth, writeLimiter, (req, res) => {
  try {
    const thread = forum.createThread({ ...req.body, userId: req.user.id, role: req.user.role });
    audit.record(req.user.id, 'create', 'forum_thread', thread.id, { title: thread.title });
    gamification.awardPoints(req.user.id, 2, 'Started a forum thread');
    res.status(201).json({ ok: true, thread });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.get('/threads', requireAuth, (req, res) => {
  res.json({ ok: true, threads: forum.listThreads({ tag: req.query.tag, limit: req.query.limit, sort: req.query.sort }) });
});

router.get('/threads/:id', requireAuth, (req, res) => {
  const thread = forum.getThread(req.params.id);
  if (!thread) return res.status(404).json({ ok: false, error: 'Not found' });
  res.json({ ok: true, thread, replies: forum.listReplies(req.params.id) });
});

router.delete('/threads/:id', requireAuth, (req, res) => {
  try {
    const isModerator = ['admin', 'ai-admin', 'faculty'].includes(req.user.role);
    const removed = forum.deleteThread(req.params.id, req.user.id, isModerator);
    if (!removed) return res.status(404).json({ ok: false, error: 'Not found' });
    audit.record(req.user.id, 'delete', 'forum_thread', req.params.id, null);
    res.json({ ok: true });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/threads/:id/lock', requireAuth, requireRole('faculty', 'admin', 'ai-admin'), (req, res) => {
  const thread = forum.lockThread(req.params.id, req.body?.locked !== false);
  res.json({ ok: true, thread });
});

router.post('/threads/:id/replies', requireAuth, writeLimiter, (req, res) => {
  try {
    const reply = forum.addReply(req.params.id, req.user.id, req.body?.body);
    gamification.awardPoints(req.user.id, 1, 'Replied on the forum');
    const thread = forum.getThread(req.params.id);
    if (thread && thread.user_id && thread.user_id !== req.user.id) {
      notify.send(thread.user_id, {
        title: 'New reply to your thread',
        body: `${req.user.name || 'Someone'} replied on "${thread.title}"`,
        type: 'forum_reply',
        meta: { threadId: req.params.id },
      });
    }
    res.status(201).json({ ok: true, reply });
  } catch (e) {
    res.status(e.status || 500).json({ ok: false, error: e.message });
  }
});

router.post('/threads/:id/vote', requireAuth, (req, res) => {
  const score = forum.vote(req.params.id, req.user.id, req.body?.value);
  res.json({ ok: true, score });
});

module.exports = router;
