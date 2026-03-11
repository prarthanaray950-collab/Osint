const express = require('express');
const { protect } = require('../middleware/auth');
const { SEARCH_TYPES, relaySearch } = require('../utils/relay');
const { SearchLog } = require('../models/index');
const User = require('../models/User');
const router = express.Router();

router.use(protect);

// POST /api/search  — unified search endpoint
// Credits are managed entirely within IntelGrid. No Telegram/DarkBoxes account needed.
router.post('/', async (req, res) => {
  const { type, query } = req.body;

  if (!type || !query)
    return res.status(400).json({ message: 'Search type and query are required.' });

  const config = SEARCH_TYPES[type];
  if (!config)
    return res.status(400).json({
      message: `Invalid search type: "${type}". Valid: ${Object.keys(SEARCH_TYPES).join(', ')}`
    });

  const user    = req.user;
  const cost    = config.credits;
  const hasPlan = user.hasActivePlan();

  // ── Credit / plan check ──────────────────────────────────────────────────
  if (!hasPlan && user.credits < cost)
    return res.status(402).json({
      message: `Not enough credits. Need ${cost}, you have ${user.credits}.`,
      code: 'NO_CREDITS'
    });

  if (hasPlan) {
    const today = new Date().toISOString().split('T')[0];
    if (user.dailyReset !== today) {
      await User.findByIdAndUpdate(user._id, { dailySearches: 0, dailyReset: today });
      user.dailySearches = 0;
    }
    const limits = { basic: 20, pro: 50, elite: 0 }; // 0 = unlimited
    const limit  = limits[user.plan] ?? 999;
    if (limit > 0 && user.dailySearches >= limit)
      return res.status(429).json({
        message: `Daily search limit (${limit}) reached. Resets at midnight UTC.`
      });
  }

  // ── Perform search via shared relay service account ──────────────────────
  let success = false, result = null, error = null;
  try {
    result  = await relaySearch(type, query.trim());
    success = true;
  } catch (err) {
    error = err.response?.data?.message || err.message || 'Search failed';
    console.error(`[Search:${type}]`, error);
  }

  // ── Deduct credits / increment counters ─────────────────────────────────
  if (!hasPlan) {
    await User.findByIdAndUpdate(user._id, { $inc: { credits: -cost, totalSearches: 1 } });
  } else {
    await User.findByIdAndUpdate(user._id, { $inc: { dailySearches: 1, totalSearches: 1 } });
  }

  // ── Log the search ───────────────────────────────────────────────────────
  await SearchLog.create({
    userId:       user._id,
    userEmail:    user.email,
    searchType:   type,
    query:        query.trim(),
    creditsUsed:  hasPlan ? 0 : cost,
    success,
    resultLength: result ? JSON.stringify(result).length : 0,
    ipAddress:    req.ip,
  });

  if (!success)
    return res.status(502).json({ message: error || 'Search failed. Please try again.' });

  res.json({
    success:     true,
    type,
    query,
    data:        result,
    creditsUsed: hasPlan ? 0 : cost,
    creditsLeft: hasPlan ? null : (user.credits - cost),
  });
});

// GET /api/search/history
router.get('/history', async (req, res) => {
  const page   = parseInt(req.query.page)  || 1;
  const limit  = parseInt(req.query.limit) || 20;
  const skip   = (page - 1) * limit;
  const filter = { userId: req.user._id, isHidden: { $ne: true } };
  if (req.query.type) filter.searchType = req.query.type;

  const [logs, total] = await Promise.all([
    SearchLog.find(filter).sort('-createdAt').skip(skip).limit(limit),
    SearchLog.countDocuments(filter)
  ]);
  res.json({ logs, total, page, pages: Math.ceil(total / limit) });
});

// GET /api/search/types
router.get('/types', (req, res) => res.json(SEARCH_TYPES));

module.exports = router;
