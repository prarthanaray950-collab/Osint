const express = require('express');
const jwt     = require('jsonwebtoken');
const User    = require('../models/User');
const { OTP } = require('../models/index');
const { generateOTP, sendOTPEmail, sendWelcomeEmail } = require('../utils/email');
const { protect } = require('../middleware/auth');
const router  = express.Router();

const signToken = id => jwt.sign({ id }, process.env.JWT_SECRET, { expiresIn: '30d' });

// POST /api/auth/register — send OTP
router.post('/register', async (req, res) => {
  try {
    const { name, email, password, referralCode } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: 'Name, email and password are required.' });
    if (password.length < 6)
      return res.status(400).json({ message: 'Password must be at least 6 characters.' });

    const exists = await User.findOne({ email: email.toLowerCase() });
    if (exists && exists.isVerified)
      return res.status(409).json({ message: 'Email already registered. Please login.' });

    // Delete old unverified account
    if (exists && !exists.isVerified) await User.deleteOne({ email: email.toLowerCase() });

    // Create unverified user
    const user = await User.create({
      name: name.trim(),
      email: email.toLowerCase().trim(),
      password,
      referredBy: referralCode || null,
      isVerified: false,
    });

    // Generate and send OTP
    const otp = generateOTP();
    const expiresAt = new Date(Date.now() + 10 * 60 * 1000); // 10 minutes
    await OTP.deleteMany({ email: email.toLowerCase() });
    await OTP.create({ email: email.toLowerCase(), otp, type: 'register', expiresAt });

    try {
      await sendOTPEmail(email, otp, name);
    } catch (emailErr) {
      console.error('[Register] Email send failed:', emailErr.message);
      // Clean up the OTP and unverified user so they can retry cleanly
      await OTP.deleteMany({ email: email.toLowerCase() });
      await User.deleteOne({ email: email.toLowerCase(), isVerified: false });
      return res.status(500).json({
        message: 'Could not send verification email. ' +
          (emailErr.message.includes('configured')
            ? 'Email service is not set up on this server.'
            : 'Please check your email address and try again.'),
      });
    }

    res.status(201).json({ message: 'OTP sent to your email. Please verify to continue.' });
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

module.exports = router;
