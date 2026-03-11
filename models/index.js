const mongoose = require('mongoose');

// OTP for email verification
const otpSchema = new mongoose.Schema({
  email:     { type: String, required: true, lowercase: true },
  otp:       { type: String, required: true },
  type:      { type: String, enum: ['register', 'reset'], default: 'register' },
  attempts:  { type: Number, default: 0 },
  expiresAt: { type: Date, required: true }
}, { timestamps: true });
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Search logs
const searchLogSchema = new mongoose.Schema({
  userId:       { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  userEmail:    { type: String, required: true },
  searchType:   { type: String, required: true },
  query:        { type: String, required: true },
  creditsUsed:  { type: Number, default: 1 },
  success:      { type: Boolean, default: true },
  resultLength: { type: Number, default: 0 },
  ipAddress:    { type: String },
  isHidden:     { type: Boolean, default: false }, // admin can hide
  adminNote:    { type: String, default: '' },
}, { timestamps: true });

// Payments
const paymentSchema = new mongoose.Schema({
  userId:     { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  userEmail:  { type: String, required: true },
  type:       { type: String, enum: ['credits', 'subscription'], required: true },
  plan:       { type: String }, // for subscription
  credits:    { type: Number }, // for credit purchase
  amount:     { type: Number, required: true },
  requestId:  { type: String },
  paymentId:  { type: String },
  status:     { type: String, enum: ['pending', 'paid', 'failed'], default: 'pending' },
}, { timestamps: true });

// Broadcast banners
const bannerSchema = new mongoose.Schema({
  title:     { type: String, required: true },
  message:   { type: String, required: true },
  type:      { type: String, enum: ['info', 'warning', 'success', 'danger'], default: 'info' },
  isActive:  { type: Boolean, default: true },
  targetPlan:{ type: String, enum: ['all', 'free', 'basic', 'pro', 'elite'], default: 'all' },
  dismissible: { type: Boolean, default: true },
  createdBy: { type: String },
}, { timestamps: true });

// Plans config
const planConfigSchema = new mongoose.Schema({
  name:        { type: String, required: true },
  key:         { type: String, required: true, unique: true },
  price:       { type: Number, required: true },
  credits:     { type: Number, default: 0 }, // 0 = unlimited for sub plans
  dailyLimit:  { type: Number, default: 0 }, // 0 = unlimited
  validityDays:{ type: Number, default: 30 },
  features:    [String],
  isActive:    { type: Boolean, default: true },
  sortOrder:   { type: Number, default: 0 },
});

// Credit packs
const creditPackSchema = new mongoose.Schema({
  name:     { type: String, required: true },
  credits:  { type: Number, required: true },
  price:    { type: Number, required: true },
  bonus:    { type: Number, default: 0 },
  isActive: { type: Boolean, default: true },
  popular:  { type: Boolean, default: false },
});


// Site-wide config (key-value store, single document)
const siteConfigSchema = new mongoose.Schema({
  key:   { type: String, required: true, unique: true },
  value: { type: mongoose.Schema.Types.Mixed, required: true },
}, { timestamps: true });

// Search command toggles
const commandConfigSchema = new mongoose.Schema({
  key:       { type: String, required: true, unique: true }, // e.g. "phone"
  name:      { type: String, required: true },
  enabled:   { type: Boolean, default: true },
  credits:   { type: Number, default: 2 },
}, { timestamps: true });

module.exports = {
  OTP:        mongoose.model('OTP', otpSchema),
  SearchLog:  mongoose.model('SearchLog', searchLogSchema),
  Payment:    mongoose.model('Payment', paymentSchema),
  Banner:     mongoose.model('Banner', bannerSchema),
  PlanConfig: mongoose.model('PlanConfig', planConfigSchema),
  CreditPack:    mongoose.model('CreditPack', creditPackSchema),
  SiteConfig:    mongoose.model('SiteConfig', siteConfigSchema),
  CommandConfig: mongoose.model('CommandConfig', commandConfigSchema),
};
