/**
 * auth.js — IntelGrid authentication
 * Fully self-contained: email/password + Google OAuth.
 * No Telegram or external account required.
 */

const express = require('express');
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');
const { protect } = require('../middleware/auth');
const router  = express.Router();

const signToken = id => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

function formatUser(u) {
  return {
    id:           u._id,
    name:         u.name,
    email:        u.email,
    role:         u.role,
    credits:      u.credits,
    plan:         u.plan,
    planExpiresAt: u.planExpiresAt,
    referralCode: u.referralCode,
    totalSearches: u.totalSearches,
    isVerified:   u.isVerified,
    createdAt:    u.createdAt,
    lastLogin:    u.lastLogin,
  };
}

// ── POST /api/auth/register ──────────────────────────────────────────────────

// Get signup credits from SiteConfig (fallback to 1)
async function getSignupCredits() {
  try {
    const cfg = await SiteConfig.findOne({ key: 'signupCredits' });
    return cfg ? Number(cfg.value) : 1;
  } catch { return 1; }
}
async function getReferralCredits() {
  try {
    const cfg = await SiteConfig.findOne({ key: 'referralCredits' });
    return cfg ? Number(cfg.value) : 3;
  } catch { return 3; }
}

router.post('/register', async (req, res) => {
  try {
    const { name, email, password, referralCode } = req.body;

    if (!name || !email || !password)
      return res.status(400).json({ message: 'Name, email and password are required.' });
    if (password.length < 6)
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing)
      return res.status(409).json({ message: 'An account with this email already exists.' });

    const signupCr = await getSignupCredits();
    const referralCr = await getReferralCredits();
    const user = await User.create({
      name:      name.trim(),
      email:     email.toLowerCase().trim(),
      password,
      credits:   signupCr,
      referredBy: referralCode || null,
    });

    if (referralCode) {
      await User.findOneAndUpdate({ referralCode }, { $inc: { credits: referralCr } });
    }

    const token = signToken(user._id);
    res.status(201).json({
      message: `Account created! You have ${signupCr} free credit${signupCr !== 1 ? 's' : ''} to get started.`,
      token,
      user: formatUser(user),
    });
  } catch (err) {
    console.error('[Register]', err.message);
    res.status(500).json({ message: 'Registration failed. Please try again.' });
  }
});

// ── POST /api/auth/login ─────────────────────────────────────────────────────
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required.' });

    // +password because the field has select: false in some schemas — safe either way
    const user = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user || !(await user.comparePassword(password)))
      return res.status(401).json({ message: 'Invalid email or password.' });

    if (user.isBanned)
      return res.status(403).json({ message: `Account banned: ${user.banReason || 'Policy violation'}` });
    if (!user.isActive)
      return res.status(403).json({ message: 'Account deactivated. Contact support.' });

    await User.findByIdAndUpdate(user._id, {
      $set: { lastLogin: new Date() },
      $inc: { loginCount: 1 },
    });

    const token = signToken(user._id);
    res.json({ message: 'Login successful.', token, user: formatUser(user) });
  } catch (err) {
    console.error('[Login]', err.message);
    res.status(500).json({ message: 'Login failed. Please try again.' });
  }
});

// ── GET /api/auth/me ─────────────────────────────────────────────────────────
router.get('/me', protect, (req, res) => {
  res.json({ user: formatUser(req.user) });
});

// ── POST /api/auth/google ─────────────────────────────────────────────────────
router.post('/google', async (req, res) => {
  try {
    const { credential, referralCode } = req.body;
    if (!credential) return res.status(400).json({ message: 'Google credential required.' });

    if (!process.env.GOOGLE_CLIENT_ID)
      return res.status(503).json({ message: 'Google sign-in is not enabled on this server.' });

    const https = require('https');
    const googleData = await new Promise((resolve, reject) => {
      const r = https.get(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`,
        (res) => {
          let d = '';
          res.on('data', c => d += c);
          res.on('end', () => {
            try {
              const parsed = JSON.parse(d);
              if (res.statusCode !== 200) reject(new Error(parsed.error_description || 'Invalid token'));
              else resolve(parsed);
            } catch { reject(new Error('Failed to parse Google response')); }
          });
        }
      );
      r.on('error', reject);
      r.setTimeout(10000, () => { r.destroy(); reject(new Error('Google verification timed out')); });
    });

    if (googleData.aud !== process.env.GOOGLE_CLIENT_ID)
      return res.status(401).json({ message: 'Token audience mismatch.' });

    const { email, name, picture, sub: googleId } = googleData;
    if (!email) return res.status(400).json({ message: 'Could not retrieve email from Google.' });

    let user = await User.findOne({ email: email.toLowerCase() });

    if (user) {
      if (!user.googleId) {
        user.googleId   = googleId;
        user.isVerified = true;
        if (picture && !user.avatar) user.avatar = picture;
        await user.save();
      }
      if (user.isBanned)  return res.status(403).json({ message: `Account banned: ${user.banReason || 'Policy violation'}` });
      if (!user.isActive) return res.status(403).json({ message: 'Account deactivated. Contact support.' });
    } else {
      const signupCrG = await getSignupCredits();
      const referralCrG = await getReferralCredits();
      user = await User.create({
        name:       name || email.split('@')[0],
        email:      email.toLowerCase(),
        password:   googleId + process.env.JWT_SECRET,
        googleId,
        avatar:     picture || null,
        isVerified: true,
        credits:    signupCrG,
        referredBy: referralCode || null,
      });
      if (referralCode) {
        await User.findOneAndUpdate({ referralCode }, { $inc: { credits: referralCrG } });
      }
    }

    await User.findByIdAndUpdate(user._id, {
      $set: { lastLogin: new Date() },
      $inc: { loginCount: 1 },
    });

    const token = signToken(user._id);
    res.json({ message: 'Signed in with Google.', token, user: formatUser(user) });
  } catch (err) {
    console.error('[GoogleAuth]', err.message);
    res.status(500).json({ message: 'Google sign-in failed: ' + err.message });
  }
});

// GET /api/auth/config  — tells the frontend which Google Client ID to use
router.get('/config', (req, res) => {
  res.json({
    googleClientId: process.env.GOOGLE_CLIENT_ID || '',
    googleEnabled:  !!process.env.GOOGLE_CLIENT_ID,
  });
});

module.exports = router;
