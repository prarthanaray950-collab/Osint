const mongoose = require('mongoose');
const bcrypt   = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name:          { type: String, required: true, trim: true },
  email:         { type: String, required: true, unique: true, lowercase: true, trim: true },
  password:      { type: String, required: true, minlength: 6 },
  isVerified:    { type: Boolean, default: false },
  isActive:      { type: Boolean, default: true },
  isBanned:      { type: Boolean, default: false },
  banReason:     { type: String, default: '' },
  role:          { type: String, enum: ['user', 'admin'], default: 'user' },

  // Credits
  credits:       { type: Number, default: 5 },  // 5 free credits on signup

  // Subscription
  plan:          { type: String, enum: ['free', 'basic', 'pro', 'elite'], default: 'free' },
  planExpiresAt: { type: Date, default: null },
  dailySearches: { type: Number, default: 0 },
  dailyReset:    { type: String, default: '' }, // YYYY-MM-DD

  // Referral
  referralCode:  { type: String, unique: true },
  referredBy:    { type: String, default: null },

  // Meta
  lastLogin:     { type: Date },
  loginCount:    { type: Number, default: 0 },
  totalSearches: { type: Number, default: 0 },
}, { timestamps: true });

// Hash password before save
userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

// Generate referral code
userSchema.pre('save', function(next) {
  if (!this.referralCode) {
    this.referralCode = Math.random().toString(36).substring(2, 8).toUpperCase();
  }
  next();
});

userSchema.methods.comparePassword = function(candidate) {
  return bcrypt.compare(candidate, this.password);
};

userSchema.methods.hasActivePlan = function() {
  if (this.plan === 'free') return false;
  if (!this.planExpiresAt) return false;
  return new Date() < this.planExpiresAt;
};

module.exports = mongoose.model('User', userSchema);
