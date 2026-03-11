const express = require('express');
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');
const { OTP } = require('../models/index');
const { generateOTP, sendOTPEmail, sendWelcomeEmail } = require('../utils/email');
const { protect } = require('../middleware/auth');
const router  = express.Router();

const signToken = id => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

// POST /api/auth/register — instant signup, no email verification
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, referralCode } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: 'Name, email and password are required.' });
    if (password.length < 6)
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });

    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists)
      return res.status(409).json({ message: 'Email already registered. Please login.' });

    // Create user as instantly verified
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      referredBy: referralCode || null,
      isVerified: true,
    });

    // Referral bonus
    if (referralCode) {
      await User.findOneAndUpdate(
        { referralCode },
        { $inc: { credits: 3 } }
      );
    }

    const token = signToken(user._id);
    res.status(201).json({
      message: 'Account created successfully. Welcome to IntelGrid!',
      token,
      user: formatUser(user),
    });
  } catch (err) {
    console.error('[Register]', err.message);
    res.status(500).json({ message: 'Registration failed. Please try again.' });
  }
});

// POST /api/auth/verify-otp
router.post('/verify-otp', async (req, res) => {
  try {
    const { email, otp } = req.body;
    if (!email || !otp) return res.status(400).json({ message: 'Email and OTP required.' });

    const record = await OTP.findOne({ email: email.toLowerCase(), type: 'register' });
    if (!record)
      return res.status(400).json({ message: 'OTP not found. Please register again.' });

    if (new Date() > record.expiresAt) {
      await OTP.deleteOne({ _id: record._id });
      return res.status(400).json({ message: 'OTP expired. Please register again.' });
    }

    if (record.otp !== otp.toString()) {
      await OTP.updateOne({ _id: record._id }, { $inc: { attempts: 1 } });
      if (record.attempts >= 4) {
        await OTP.deleteOne({ _id: record._id });
        return res.status(400).json({ message: 'Too many wrong attempts. Please register again.' });
      }
      return res.status(400).json({ message: 'Incorrect OTP. Try again.' });
    }

    // Activate user
    const user = await User.findOneAndUpdate(
      { email: email.toLowerCase() },
      { $set: { isVerified: true } },
      { new: true }
    );
    await OTP.deleteOne({ _id: record._id });

    // Referral bonus
    if (user.referredBy) {
      await User.findOneAndUpdate(
        { referralCode: user.referredBy },
        { $inc: { credits: 3 } }
      );
    }

    // Send welcome email
    try { await sendWelcomeEmail(email, user.name); } catch(e) {}

    const token = signToken(user._id);
    res.json({
      message: 'Email verified. Welcome to IntelGrid!',
      token,
      user: formatUser(user),
    });
  } catch (err) {
    console.error('[VerifyOTP]', err.message);
    res.status(500).json({ message: 'Verification failed.' });
  }
});

// POST /api/auth/resend-otp
router.post('/resend-otp', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase() });
    if (!user) return res.status(404).json({ message: 'Email not found.' });
    if (user.isVerified) return res.status(400).json({ message: 'Email already verified.' });

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await OTP.deleteMany({ email: email.toLowerCase() });
    await OTP.create({ email: email.toLowerCase(), otp, type: 'register', expiresAt });

    try {
      await sendOTPEmail(email, otp, user.name);
    } catch (emailErr) {
      console.error('[ResendOTP] Email send failed:', emailErr.message);
      return res.status(500).json({ message: 'Could not send email. Please try again shortly.' });
    }

    res.json({ message: 'New OTP sent to your email.' });
  } catch (err) {
    console.error('[ResendOTP]', err.message);
    res.status(500).json({ message: 'Could not resend OTP. Please try again.' });
  }
});

// POST /api/auth/login
router.post('/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password)
      return res.status(400).json({ message: 'Email and password required.' });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) return res.status(401).json({ message: 'Invalid email or password.' });
    if (!user.isVerified) return res.status(401).json({ message: 'Please verify your email first.', needsVerification: true, email });
    if (user.isBanned) return res.status(403).json({ message: `Account banned: ${user.banReason || 'Policy violation'}` });
    if (!user.isActive) return res.status(403).json({ message: 'Account deactivated. Contact support.' });

    const match = await user.comparePassword(password);
    if (!match) return res.status(401).json({ message: 'Invalid email or password.' });

    // Update login meta
    await User.findByIdAndUpdate(user._id, {
      $set:  { lastLogin: new Date() },
      $inc:  { loginCount: 1 }
    });

    const token = signToken(user._id);
    res.json({ token, user: formatUser(user) });
  } catch (err) {
    console.error('[Login]', err.message);
    res.status(500).json({ message: 'Login failed.' });
  }
});

// GET /api/auth/me
router.get('/me', protect, (req, res) => {
  res.json({ user: formatUser(req.user) });
});

// POST /api/auth/forgot-password
router.post('/forgot-password', async (req, res) => {
  try {
    const { email } = req.body;
    const user = await User.findOne({ email: email?.toLowerCase() });
    if (!user) return res.status(404).json({ message: 'Email not found.' });

    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000);
    await OTP.deleteMany({ email: email.toLowerCase(), type: 'reset' });
    await OTP.create({ email: email.toLowerCase(), otp, type: 'reset', expiresAt });
    await sendOTPEmail(email, otp, user.name);

    res.json({ message: 'Password reset OTP sent.' });
  } catch (err) {
    res.status(500).json({ message: 'Could not send reset OTP.' });
  }
});

// POST /api/auth/reset-password
router.post('/reset-password', async (req, res) => {
  try {
    const { email, otp, newPassword } = req.body;
    if (!email || !otp || !newPassword)
      return res.status(400).json({ message: 'All fields required.' });

    const record = await OTP.findOne({ email: email.toLowerCase(), type: 'reset' });
    if (!record || record.otp !== otp || new Date() > record.expiresAt)
      return res.status(400).json({ message: 'Invalid or expired OTP.' });

    const user = await User.findOne({ email: email.toLowerCase() });
    user.password = newPassword;
    await user.save();
    await OTP.deleteOne({ _id: record._id });

    res.json({ message: 'Password reset successfully. Please login.' });
  } catch (err) {
    res.status(500).json({ message: 'Password reset failed.' });
  }
});

// GET /api/auth/test-email?to=you@gmail.com
// Hit this in a browser to diagnose if email works on your server
router.get("/test-email", async (req, res) => {
  const to = req.query.to;
  if (!to) return res.status(400).json({ message: "Add ?to=your@email.com to the URL" });
  try {
    const otp = generateOTP();
    console.log("[TestEmail] Sending test OTP", otp, "to", to);
    await sendOTPEmail(to, otp, "Test User");
    res.json({ success: true, message: "Test email sent to " + to + ". Check inbox & spam.", otp });
  } catch (err) {
    console.error("[TestEmail] Failed:", err.message);
    res.status(500).json({ success: false, error: err.message });
  }
});

function formatUser(u) {
  return {
    id: u._id, name: u.name, email: u.email, role: u.role,
    credits: u.credits, plan: u.plan, planExpiresAt: u.planExpiresAt,
    referralCode: u.referralCode, totalSearches: u.totalSearches,
    isVerified: u.isVerified, createdAt: u.createdAt, lastLogin: u.lastLogin,
  };
}

// POST /api/auth/google
// Frontend sends the Google ID token, we verify it with Google and sign in/up the user
router.post('/google', async (req, res) => {
  try {
    const { credential } = req.body;
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

    // Validate audience matches our client ID
    const clientId = process.env.GOOGLE_CLIENT_ID;
    if (clientId && googleData.aud !== clientId) {
      return res.status(401).json({ message: 'Token audience mismatch.' });
    }

    const { email, name, picture, sub: googleId } = googleData;
    if (!email) return res.status(400).json({ message: 'Could not get email from Google.' });

    // Find or create user
    let user = await User.findOne({ email: email.toLowerCase() });

    if (user) {
      // Existing user — update google info if not set
      if (!user.googleId) {
        user.googleId   = googleId;
        user.isVerified = true;
        if (picture && !user.avatar) user.avatar = picture;
        await user.save();
      }
      if (user.isBanned)  return res.status(403).json({ message: `Account banned: ${user.banReason || 'Policy violation'}` });
      if (!user.isActive) return res.status(403).json({ message: 'Account deactivated. Contact support.' });
    } else {
      // New user — create account instantly
      user = await User.create({
        name:       name || email.split('@')[0],
        email:      email.toLowerCase(),
        password:   googleId + process.env.JWT_SECRET, // random unguessable password
        googleId,
        avatar:     picture || null,
        isVerified: true,
      });
    }

    await User.findByIdAndUpdate(user._id, {
      $set: { lastLogin: new Date() },
      $inc: { loginCount: 1 },
    });

    const token = signToken(user._id);
    res.json({
      message: 'Signed in with Google.',
      token,
      user: formatUser(user),
    });
  } catch (err) {
    console.error('[GoogleAuth]', err.message);
    res.status(500).json({ message: 'Google sign-in failed: ' + err.message });
  }
});

module.exports = router;
