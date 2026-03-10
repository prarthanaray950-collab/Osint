const express = require('express');
const { protect } = require('../middleware/auth');
const { Banner } = require('../models/index');
const User = require('../models/User');
const router = express.Router();
router.use(protect);

router.get('/profile', (req, res) => {
  const u = req.user;
  res.json({
    id: u._id, name: u.name, email: u.email, role: u.role,
    credits: u.credits, plan: u.plan, planExpiresAt: u.planExpiresAt,
    referralCode: u.referralCode, totalSearches: u.totalSearches,
    dailySearches: u.dailySearches, createdAt: u.createdAt, lastLogin: u.lastLogin,
  });
});

router.get('/banners', async (req, res) => {
  const user = req.user;
  const filter = {
    isActive: true,
    $or: [{ targetPlan: 'all' }, { targetPlan: user.plan }]
  };
  const banners = await Banner.find(filter).sort('-createdAt').limit(5);
  res.json(banners);
});

module.exports = router;
