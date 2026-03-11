const express = require('express');
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');
const { protect } = require('../middleware/auth');
const router  = express.Router();

const signToken = id => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

function formatUser(u) {
  return {
    id: u._id, name: u.name, email: u.email, role: u.role,
    credits: u.credits, plan: u.plan, planExpiresAt: u.planExpiresAt,
    referralCode: u.referralCode, totalSearches: u.totalSearches,
    isVerified: u.isVerified, createdAt: u.createdAt, lastLogin: u.lastLogin,
  };
}

// POST /api/auth/register  — FIX #3: email + password registration
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

    const user = await User.create({
      name:      name.trim(),
      email:     email.toLowerCase().trim(),
      password,
      referredBy: referralCode || null,
    });

    // Referral bonus for the referrer
    if (referralCode) {
      await User.findOneAndUpdate({ referralCode }, { $inc: { credits: 3 } });
    }

    const token = signToken(user._id);
    res.status(201).json({ message: 'Account created successfully.', token, user: formatUser(user) });
  } catch (err) {
    console.error('[Register]', err.message);
    res.status(500).json({ message: 'Registration failed. Please try again.' });
  }
});

// POST /api/auth/login  — FIX #3: email + password login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password are required.' });

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

// GET /api/auth/me
router.get('/me', protect, (req, res) => {
  res.json({ user: formatUser(req.user) });
});

// POST /api/auth/google  — FIX #4: GOOGLE_CLIENT_ID is now required
router.post('/google', async (req, res) => {
  try {
    const { credential, referralCode } = req.body;
    if (!credential) return res.status(400).json({ message: 'Google credential required.' });

    // FIX #4: Fail clearly if GOOGLE_CLIENT_ID is not set
    if (!process.env.GOOGLE_CLIENT_ID)
      return res.status(500).json({ message: 'Google sign-in is not configured on this server.' });

    const https = require('https');
    const googleData = await new Promise((resolve, reject) => {
      const reqG = https.get(
        `https://oauth2.googleapis.com/tokeninfo?id_token=${credential}`,
        (r) => {
          let d = '';
          r.on('data', c => d += c);
          r.on('end', () => {
            try {
              const parsed = JSON.parse(d);
              if (r.statusCode !== 200) reject(new Error(parsed.error_description || 'Invalid token'));
              else resolve(parsed);
            } catch { reject(new Error('Failed to parse Google response')); }
          });
        }
      );
      reqG.on('error', reject);
      reqG.setTimeout(10000, () => { reqG.destroy(); reject(new Error('Google verification timed out')); });
    });

    if (googleData.aud !== process.env.GOOGLE_CLIENT_ID)
      return res.status(401).json({ message: 'Token audience mismatch.' });

    const { email, name, picture, sub: googleId } = googleData;
    if (!email) return res.status(400).json({ message: 'Could not get email from Google.' });

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
      user = await User.create({
        name:       name || email.split('@')[0],
        email:      email.toLowerCase(),
        password:   googleId + process.env.JWT_SECRET,
        googleId,
        avatar:     picture || null,
        isVerified: true,
        referredBy: referralCode || null,
      });
      if (referralCode) {
        await User.findOneAndUpdate({ referralCode }, { $inc: { credits: 3 } });
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

module.exports = router;
