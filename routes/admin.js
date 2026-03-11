const express = require('express');
const { protect, adminOnly } = require('../middleware/auth');
const { SearchLog, Payment, Banner } = require('../models/index');
const User = require('../models/User');
const router = express.Router();
router.use(protect, adminOnly);

// ── DASHBOARD STATS ────────────────────────────────────────────────
router.get('/stats', async (req, res) => {
  const [users, searches, revenue, banned, recentUsers, recentSearches] = await Promise.all([
    User.countDocuments({ isVerified: true }),
    SearchLog.countDocuments(),
    Payment.aggregate([{ $match: { status: 'paid' } }, { $group: { _id: null, total: { $sum: '$amount' } } }]),
    User.countDocuments({ isBanned: true }),
    User.find({ isVerified: true }).sort('-createdAt').limit(8).select('name email plan credits createdAt isBanned isActive'),
    SearchLog.find().sort('-createdAt').limit(10),
  ]);
  res.json({ users, searches, revenue: revenue[0]?.total || 0, banned, recentUsers, recentSearches });
});

// ── USERS ────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  const { q, plan, status, page = 1 } = req.query;
  const limit = 20, skip = (page - 1) * limit;
  const filter = {};
  if (q) filter.$or = [{ name: { $regex: q, $options: 'i' } }, { email: { $regex: q, $options: 'i' } }];
  if (plan && plan !== 'all') filter.plan = plan;
  if (status === 'banned')   filter.isBanned = true;
  if (status === 'inactive') filter.isActive = false;
  const [users, total] = await Promise.all([
    User.find(filter).sort('-createdAt').skip(skip).limit(limit).select('-password'),
    User.countDocuments(filter)
  ]);
  res.json({ users, total, page: +page, pages: Math.ceil(total / limit) });
});

router.get('/users/:id', async (req, res) => {
  const user = await User.findById(req.params.id).select('-password');
  if (!user) return res.status(404).json({ message: 'User not found.' });
  const searches = await SearchLog.find({ userId: req.params.id }).sort('-createdAt').limit(30);
  const payments = await Payment.find({ userId: req.params.id }).sort('-createdAt');
  res.json({ user, searches, payments });
});

// Add credits
router.post('/users/:id/credits', async (req, res) => {
  const { amount, note } = req.body;
  if (!amount || isNaN(amount)) return res.status(400).json({ message: 'Valid amount required.' });
  const user = await User.findByIdAndUpdate(req.params.id, { $inc: { credits: parseInt(amount) } }, { new: true });
  if (!user) return res.status(404).json({ message: 'User not found.' });
  res.json({ message: `${amount > 0 ? 'Added' : 'Deducted'} ${Math.abs(amount)} credits.`, credits: user.credits });
});

// Ban / Unban
router.post('/users/:id/ban', async (req, res) => {
  const { reason } = req.body;
  const user = await User.findByIdAndUpdate(req.params.id, { isBanned: true, banReason: reason || 'Admin action' }, { new: true });
  if (!user) return res.status(404).json({ message: 'User not found.' });
  res.json({ message: 'User banned.', user });
});

router.post('/users/:id/unban', async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { isBanned: false, banReason: '' }, { new: true });
  if (!user) return res.status(404).json({ message: 'User not found.' });
  res.json({ message: 'User unbanned.', user });
});

// Activate / Deactivate
router.post('/users/:id/activate', async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { isActive: true }, { new: true });
  res.json({ message: 'User activated.', user });
});

router.post('/users/:id/deactivate', async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  res.json({ message: 'User deactivated.', user });
});

// Change plan
router.post('/users/:id/plan', async (req, res) => {
  const { plan, days } = req.body;
  const validPlans = ['free', 'basic', 'pro', 'elite'];
  if (!validPlans.includes(plan)) return res.status(400).json({ message: 'Invalid plan.' });
  const expiry = plan === 'free' ? null : (() => { const d = new Date(); d.setDate(d.getDate() + (days || 30)); return d; })();
  const user = await User.findByIdAndUpdate(req.params.id, { plan, planExpiresAt: expiry }, { new: true });
  res.json({ message: `Plan changed to ${plan}.`, user });
});

// Set admin role
router.post('/users/:id/make-admin', async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { role: 'admin' }, { new: true });
  res.json({ message: 'User promoted to admin.', user });
});

// ── SEARCHES ─────────────────────────────────────────────────────
router.get('/searches', async (req, res) => {
  const { q, type, userId, page = 1 } = req.query;
  const limit = 25, skip = (page - 1) * limit;
  const filter = {};
  if (q)      filter.query      = { $regex: q, $options: 'i' };
  if (type)   filter.searchType = type;
  if (userId) filter.userId     = userId;

  const [logs, total] = await Promise.all([
    SearchLog.find(filter).sort('-createdAt').skip(skip).limit(limit),
    SearchLog.countDocuments(filter)
  ]);
  res.json({ logs, total, page: +page, pages: Math.ceil(total / limit) });
});

router.post('/searches/:id/hide', async (req, res) => {
  await SearchLog.findByIdAndUpdate(req.params.id, { isHidden: true, adminNote: req.body.note || '' });
  res.json({ message: 'Search hidden from user.' });
});

router.delete('/searches/:id', async (req, res) => {
  await SearchLog.findByIdAndDelete(req.params.id);
  res.json({ message: 'Search log deleted.' });
});

// ── PAYMENTS ──────────────────────────────────────────────────────
router.get('/payments', async (req, res) => {
  const payments = await Payment.find().sort('-createdAt').limit(100);
  res.json(payments);
});

// ── BANNERS ───────────────────────────────────────────────────────
router.get('/banners', async (req, res) => {
  const banners = await Banner.find().sort('-createdAt');
  res.json(banners);
});

router.post('/banners', async (req, res) => {
  const { title, message, type, targetPlan, dismissible } = req.body;
  if (!title || !message) return res.status(400).json({ message: 'Title and message required.' });
  const banner = await Banner.create({ title, message, type: type || 'info', targetPlan: targetPlan || 'all', dismissible: dismissible !== false, createdBy: req.user.email });
  res.status(201).json(banner);
});

router.put('/banners/:id', async (req, res) => {
  const banner = await Banner.findByIdAndUpdate(req.params.id, req.body, { new: true });
  if (!banner) return res.status(404).json({ message: 'Banner not found.' });
  res.json(banner);
});

router.delete('/banners/:id', async (req, res) => {
  await Banner.findByIdAndDelete(req.params.id);
  res.json({ message: 'Banner deleted.' });
});

// ── ACTIVE BANNERS (for users) ────────────────────────────────────
module.exports = router;

// ── RELAY STATUS ──────────────────────────────────────────────────
router.get('/relay-status', async (req, res) => {
  const { relayStatus } = require('../utils/relay');
  const status = await relayStatus();
  res.json(status);
});

// ── SETTINGS (relay key update) ───────────────────────────────────
router.post('/settings', async (req, res) => {
  const { relayApiKey } = req.body;
  if (relayApiKey) {
    process.env.RELAY_API_KEY = relayApiKey;
    return res.json({ message: 'Relay API key updated for this session. Add it to your .env to persist.' });
  }
  res.status(400).json({ message: 'Nothing to update.' });
});
