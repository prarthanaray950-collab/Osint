const express = require('express');
const { protect } = require('../middleware/auth');
const { SEARCH_TYPES, relaySearch } = require('../utils/relay');
const { SearchLog, CommandConfig } = require('../models/index');
const User = require('../models/User');
const router = express.Router();

router.use(protect);

// Default command definitions (used for seeding if DB is empty)
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
  const count = await CommandConfig.countDocuments();
  if (count === 0) {
    await CommandConfig.insertMany(DEFAULT_COMMANDS.map(c => ({ ...c, enabled: true })));
  }
}

// Detect if result is actually empty / no data found
function isEmptyResult(result) {
  if (!result) return true;
  const inner = (result.status === 'success' && result.data) ? result.data : result;
  const raw = (inner.raw_text || inner.raw_content || '').trim();

  // No raw text at all
  if (!raw) return true;

  // Short response — likely just a header with no data
  if (raw.length < 50) return true;

  // Relay-level no-result phrases
  const noDataPhrases = [
    'no result', 'no data', 'not found', 'no record', 'no information',
    'nothing found', 'no match', '0 result', 'empty result',
    'could not find', 'unable to find', 'does not exist',
    '❌', 'not available', 'no details', 'koi data nahi',
  ];
  const lc = raw.toLowerCase();
  if (noDataPhrases.some(p => lc.includes(p))) return true;

  // parsed_data exists but has only meta keys (no real data)
  const pd = inner.parsed_data || {};
  const META = new Set(['query','type','name','source','timestamp','raw_text','parsed_data']);
  const realKeys = Object.keys(pd).filter(k => !META.has(k) && pd[k] && String(pd[k]).trim() && String(pd[k]).trim() !== 'null');

  // Try to extract JSON from raw text
  const jsonMatch = raw.match(/(\[[\s\S]*?\])/);
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[1]);
      if (Array.isArray(parsed) && parsed.length > 0) return false; // has real data
    } catch {}
  }

  // If parsed_data has real keys, there's data
  if (realKeys.length > 2) return false;

  // Heuristic: if raw text has at least 3 KEY: value lines, probably has data
  const kvLines = (raw.match(/^[A-Za-z][A-Za-z0-9 ]{0,30}\s*:\s*.+/gm) || []).length;
  if (kvLines >= 3) return false;

  return true;
}

// POST /api/search
router.post('/', async (req, res) => {
  const { type, query } = req.body;
  if (!type || !query)
    return res.status(400).json({ message: 'Search type and query are required.' });

  // ── Check command is enabled ──────────────────────────────────────────────
  await seedCommandsIfEmpty();
  const cmd = await CommandConfig.findOne({ key: type });
  if (cmd && !cmd.enabled)
    return res.status(403).json({ message: `The "${cmd.name}" search module is currently disabled by admin.`, code: 'COMMAND_DISABLED' });

  const config = SEARCH_TYPES[type];
  if (!config)
    return res.status(400).json({ message: `Invalid search type: "${type}".` });

  const user    = req.user;
  // Use credit cost from CommandConfig DB (admin can change it), fallback to relay config
  const cost    = cmd ? cmd.credits : config.credits;
  const hasPlan = user.hasActivePlan();

  // ── Credit check ─────────────────────────────────────────────────────────
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
    const limits = { basic: 20, pro: 50, elite: 0 };
    const limit  = limits[user.plan] ?? 999;
    if (limit > 0 && user.dailySearches >= limit)
      return res.status(429).json({ message: `Daily limit (${limit}) reached. Resets at midnight UTC.` });
  }

  // ── Perform search ───────────────────────────────────────────────────────
  let success = false, result = null, error = null;
  try {
    result  = await relaySearch(type, query.trim());
    success = true;
  } catch (err) {
    error = err.response?.data?.message || err.message || 'Search failed';
    console.error(`[Search:${type}]`, error);
  }

  // ── Detect empty result — skip credit deduction ───────────────────────────
  const empty = success && isEmptyResult(result);
  const actualCostUsed = (!success || empty) ? 0 : cost;

  // ── Deduct credits / increment counters ──────────────────────────────────
  if (!hasPlan) {
    const creditDelta = empty ? 0 : -cost;
    await User.findByIdAndUpdate(user._id, { $inc: { credits: creditDelta, totalSearches: 1 } });
  } else {
    await User.findByIdAndUpdate(user._id, { $inc: { dailySearches: 1, totalSearches: 1 } });
  }

  // ── Log the search ───────────────────────────────────────────────────────
  await SearchLog.create({
    userId:       user._id,
    userEmail:    user.email,
    searchType:   type,
    query:        query.trim(),
    creditsUsed:  hasPlan ? 0 : actualCostUsed,
    success,
    resultLength: result ? JSON.stringify(result).length : 0,
    ipAddress:    req.ip,
  });

  if (!success)
    return res.status(502).json({ message: error || 'Search failed. Please try again.' });

  // Unwrap relay envelope
  const innerData = (result && result.status === 'success' && result.data) ? result.data : result;

  res.json({
    success:     true,
    type,
    query,
    data:        innerData,
    empty,                                                    // frontend can show "no results" banner
    creditsUsed: hasPlan ? 0 : actualCostUsed,
    creditsLeft: hasPlan ? null : (user.credits - actualCostUsed),
    noDeduction: empty,                                       // explicit flag
  });
});

// GET /api/search/history
router.get('/history', async (req, res) => {
  const page  = parseInt(req.query.page)  || 1;
  const limit = parseInt(req.query.limit) || 20;
  const skip  = (page - 1) * limit;
  const filter = { userId: req.user._id, isHidden: { $ne: true } };
  if (req.query.type) filter.searchType = req.query.type;
  const [logs, total] = await Promise.all([
    SearchLog.find(filter).sort('-createdAt').skip(skip).limit(limit),
    SearchLog.countDocuments(filter)
  ]);
  res.json({ logs, total, page, pages: Math.ceil(total / limit) });
});

// GET /api/search/types  — only returns enabled commands
router.get('/types', async (req, res) => {
  await seedCommandsIfEmpty();
  const cmds = await CommandConfig.find({ enabled: true });
  const result = {};
  cmds.forEach(c => {
    if (SEARCH_TYPES[c.key]) result[c.key] = { ...SEARCH_TYPES[c.key], credits: c.credits };
  });
  res.json(result);
});

module.exports = router;
