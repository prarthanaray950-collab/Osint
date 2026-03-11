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

// GET /api/auth/me
router.get('/me', protect, (req, res) => {
  res.json({ user: formatUser(req.user) });
});

// POST /api/auth/google
router.post('/google', async (req, res) => {
  try {
    const { credential, referralCode } = req.body;
    if (!credential) return res.status(400).json({ message: 'Google credential required.' });

    // Verify token with Google
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

    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (clientId && googleData.aud !== clientId)
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
      // New user
      user = await User.create({
        name:       name || email.split('@')[0],
        email:      email.toLowerCase(),
        password:   googleId + process.env.JWT_SECRET,
        googleId,
        avatar:     picture || null,
        isVerified: true,
        referredBy: referralCode || null,
      });
      // Referral bonus
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
