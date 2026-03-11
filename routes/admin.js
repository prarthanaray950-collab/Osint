const express = require('express');
const { protect, adminOnly } = require('../middleware/auth');
const { SearchLog, Payment, Banner, PlanConfig, CreditPack, SiteConfig, CommandConfig } = require('../models/index');
const User = require('../models/User');
const router = express.Router();
router.use(protect, adminOnly);

// ── DASHBOARD STATS ──────────────────────────────────────────────────────────
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

// ── USERS ────────────────────────────────────────────────────────────────────
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

router.post('/users/:id/credits', async (req, res) => {
  const { amount } = req.body;
  if (!amount || isNaN(amount)) return res.status(400).json({ message: 'Valid amount required.' });
  const user = await User.findByIdAndUpdate(req.params.id, { $inc: { credits: parseInt(amount) } }, { new: true });
  if (!user) return res.status(404).json({ message: 'User not found.' });
  res.json({ message: `${amount > 0 ? 'Added' : 'Deducted'} ${Math.abs(amount)} credits.`, credits: user.credits });
});

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

router.post('/users/:id/activate', async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { isActive: true }, { new: true });
  res.json({ message: 'User activated.', user });
});

router.post('/users/:id/deactivate', async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { isActive: false }, { new: true });
  res.json({ message: 'User deactivated.', user });
});

router.post('/users/:id/plan', async (req, res) => {
  const { plan, days } = req.body;
  const expiry = plan === 'free' ? null : (() => { const d = new Date(); d.setDate(d.getDate() + (days || 30)); return d; })();
  const user = await User.findByIdAndUpdate(req.params.id, { plan, planExpiresAt: expiry }, { new: true });
  res.json({ message: `Plan changed to ${plan}.`, user });
});

router.post('/users/:id/make-admin', async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { role: 'admin' }, { new: true });
  res.json({ message: 'User promoted to admin.', user });
});

// ── SEARCHES ─────────────────────────────────────────────────────────────────
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
  res.json({ message: 'Search hidden.' });
});

router.delete('/searches/:id', async (req, res) => {
  await SearchLog.findByIdAndDelete(req.params.id);
  res.json({ message: 'Search log deleted.' });
});

// ── PAYMENTS ──────────────────────────────────────────────────────────────────
router.get('/payments', async (req, res) => {
  const payments = await Payment.find().sort('-createdAt').limit(100);
  res.json(payments);
});

// ── BANNERS ───────────────────────────────────────────────────────────────────
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

// ── SUBSCRIPTION PLANS ────────────────────────────────────────────────────────

async function seedPlansIfEmpty() {
  if (await PlanConfig.countDocuments() === 0) {
    await PlanConfig.insertMany([
      { key: 'basic', name: 'Basic',  price: 299, dailyLimit: 20, validityDays: 30, sortOrder: 1, features: ['20 searches/day','All 14 modules','Priority support'], isActive: true },
      { key: 'pro',   name: 'Pro',    price: 599, dailyLimit: 50, validityDays: 30, sortOrder: 2, features: ['50 searches/day','All 14 modules','Export results','Priority support'], isActive: true },
      { key: 'elite', name: 'Elite',  price: 999, dailyLimit: 0,  validityDays: 30, sortOrder: 3, features: ['Unlimited searches','All 14 modules','Export results','24/7 support','API access'], isActive: true },
    ]);
  }
}

async function seedPacksIfEmpty() {
  if (await CreditPack.countDocuments() === 0) {
    await CreditPack.insertMany([
      { name: '50 Credits',  credits: 50,  bonus: 0,  price: 149, popular: false, isActive: true },
      { name: '150 Credits', credits: 150, bonus: 10, price: 399, popular: false, isActive: true },
      { name: '500 Credits', credits: 500, bonus: 50, price: 999, popular: true,  isActive: true },
    ]);
  }
}

router.get('/plans', async (req, res) => {
  try { await seedPlansIfEmpty(); res.json(await PlanConfig.find().sort('sortOrder')); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

router.post('/plans', async (req, res) => {
  try {
    const { key, name, price, dailyLimit, validityDays, features, isActive, sortOrder } = req.body;
    if (!key || !name || price == null) return res.status(400).json({ message: 'key, name and price are required.' });
    if (await PlanConfig.findOne({ key })) return res.status(409).json({ message: `Plan key "${key}" already exists.` });
    const plan = await PlanConfig.create({ key, name, price, dailyLimit: dailyLimit||0, validityDays: validityDays||30, features: features||[], isActive: isActive!==false, sortOrder: sortOrder||0 });
    res.status(201).json(plan);
  } catch (e) { res.status(400).json({ message: e.message }); }
});

router.put('/plans/:id', async (req, res) => {
  try {
    const plan = await PlanConfig.findByIdAndUpdate(req.params.id, req.body, { new: true, runValidators: true });
    if (!plan) return res.status(404).json({ message: 'Plan not found.' });
    res.json(plan);
  } catch (e) { res.status(400).json({ message: e.message }); }
});

router.delete('/plans/:id', async (req, res) => {
  try {
    const plan = await PlanConfig.findByIdAndDelete(req.params.id);
    if (!plan) return res.status(404).json({ message: 'Plan not found.' });
    res.json({ message: `Plan "${plan.name}" deleted.` });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── CREDIT PACKS ──────────────────────────────────────────────────────────────

router.get('/packs', async (req, res) => {
  try { await seedPacksIfEmpty(); res.json(await CreditPack.find().sort('price')); }
  catch (e) { res.status(500).json({ message: e.message }); }
});

router.post('/packs', async (req, res) => {
  try {
    const { name, credits, price, bonus, popular, isActive } = req.body;
    if (!name || !credits || !price) return res.status(400).json({ message: 'name, credits and price are required.' });
    const pack = await CreditPack.create({ name, credits, price, bonus: bonus||0, popular: popular||false, isActive: isActive!==false });
    res.status(201).json(pack);
  } catch (e) { res.status(400).json({ message: e.message }); }
});

router.put('/packs/:id', async (req, res) => {
  try {
    const pack = await CreditPack.findByIdAndUpdate(req.params.id, req.body, { new: true });
    if (!pack) return res.status(404).json({ message: 'Pack not found.' });
    res.json(pack);
  } catch (e) { res.status(400).json({ message: e.message }); }
});

router.delete('/packs/:id', async (req, res) => {
  try {
    const pack = await CreditPack.findByIdAndDelete(req.params.id);
    if (!pack) return res.status(404).json({ message: 'Pack not found.' });
    res.json({ message: `Pack "${pack.name}" deleted.` });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// ── RELAY STATUS ──────────────────────────────────────────────────────────────
router.get('/relay-status', async (req, res) => {
  const { relayStatus } = require('../utils/relay');
  res.json(await relayStatus());
});

// ── SETTINGS ──────────────────────────────────────────────────────────────────
router.post('/settings', async (req, res) => {
  const { intelgridSecret, relayApiUrl } = req.body;
  if (!intelgridSecret && !relayApiUrl)
    return res.status(400).json({ message: 'Provide intelgridSecret and/or relayApiUrl to update.' });
  if (intelgridSecret) process.env.INTELGRID_SECRET = intelgridSecret;
  if (relayApiUrl)     process.env.RELAY_API_URL     = relayApiUrl;
  res.json({ message: 'Settings updated. Update your .env to persist across restarts.' });
});


// ── SITE CONFIG ───────────────────────────────────────────────────────────────

async function getCfg(key, def) {
  const c = await SiteConfig.findOne({ key });
  return c ? c.value : def;
}
async function setCfg(key, value) {
  await SiteConfig.findOneAndUpdate({ key }, { key, value }, { upsert: true, new: true });
}

router.get('/config', async (req, res) => {
  try {
    const [signupCredits, referralCredits] = await Promise.all([
      getCfg('signupCredits', 1),
      getCfg('referralCredits', 3),
    ]);
    res.json({ signupCredits, referralCredits });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

router.post('/config', async (req, res) => {
  try {
    const { signupCredits, referralCredits } = req.body;
    if (signupCredits   != null) await setCfg('signupCredits',   Number(signupCredits));
    if (referralCredits != null) await setCfg('referralCredits', Number(referralCredits));
    res.json({ message: 'Config saved.', signupCredits, referralCredits });
  } catch (e) { res.status(400).json({ message: e.message }); }
});

// ── COMMANDS ──────────────────────────────────────────────────────────────────

const DEFAULT_COMMANDS = [
  { key:'phone',     name:'Phone',         credits:2 },
  { key:'family',    name:'Family',        credits:2 },
  { key:'aadhar',    name:'Aadhar',        credits:3 },
  { key:'vehicle',   name:'Vehicle',       credits:2 },
  { key:'telegram',  name:'Telegram',      credits:3 },
  { key:'imei',      name:'IMEI',          credits:2 },
  { key:'gst',       name:'GST',           credits:2 },
  { key:'instagram', name:'Instagram',     credits:3 },
  { key:'ip',        name:'IP Lookup',     credits:1 },
  { key:'ifsc',      name:'IFSC',          credits:1 },
  { key:'email',     name:'Email',         credits:2 },
  { key:'upi',       name:'UPI',           credits:2 },
  { key:'pakistan',  name:'Pakistan OSINT',credits:2 },
  { key:'leak',      name:'OSINT / Leak',  credits:3 },
];

async function seedCommandsIfEmpty() {
  if (await CommandConfig.countDocuments() === 0)
    await CommandConfig.insertMany(DEFAULT_COMMANDS.map(c => ({ ...c, enabled: true })));
}

// GET all commands
router.get('/commands', async (req, res) => {
  try {
    await seedCommandsIfEmpty();
    res.json(await CommandConfig.find().sort('key'));
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Toggle enable/disable
router.post('/commands/:key/toggle', async (req, res) => {
  try {
    await seedCommandsIfEmpty();
    const cmd = await CommandConfig.findOne({ key: req.params.key });
    if (!cmd) return res.status(404).json({ message: 'Command not found.' });
    cmd.enabled = !cmd.enabled;
    await cmd.save();
    res.json({ message: `${cmd.name} is now ${cmd.enabled ? 'enabled' : 'disabled'}.`, cmd });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

// Update credits per command
router.post('/commands/:key/credits', async (req, res) => {
  try {
    const { credits } = req.body;
    if (credits == null || isNaN(credits) || credits < 0)
      return res.status(400).json({ message: 'Valid credits value required.' });
    const cmd = await CommandConfig.findOneAndUpdate(
      { key: req.params.key }, { credits: Number(credits) }, { new: true }
    );
    if (!cmd) return res.status(404).json({ message: 'Command not found.' });
    res.json({ message: `${cmd.name} credit cost updated to ${credits}.`, cmd });
  } catch (e) { res.status(500).json({ message: e.message }); }
});

module.exports = router;
