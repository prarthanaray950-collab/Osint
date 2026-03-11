/**
 * payment.js — IntelGrid billing (Instamojo)
 *
 * Users buy credits or subscription plans directly on IntelGrid.
 * All credit tracking is in IntelGrid's own MongoDB.
 * No Telegram or DarkBoxes account is involved.
 */

const express = require('express');
const axios   = require('axios');
const { protect } = require('../middleware/auth');
const { Payment, PlanConfig, CreditPack } = require('../models/index');
const User = require('../models/User');
const router = express.Router();

// ── Instamojo helpers ────────────────────────────────────────────────────────
const IMOJO_BASE = () => process.env.INSTAMOJO_BASE_URL || 'https://test.instamojo.com/api/1.1';
const imojoHeaders = () => ({
  'X-Api-Key':    process.env.INSTAMOJO_API_KEY,
  'X-Auth-Token': process.env.INSTAMOJO_AUTH_TOKEN,
  'Content-Type': 'application/x-www-form-urlencoded',
});

// GET /api/payment/packs  — public listing, reads from DB
router.get('/packs', async (req, res) => {
  try {
    const [packs, plans] = await Promise.all([
      CreditPack.find({ isActive: true }).sort('price').lean(),
      PlanConfig.find({ isActive: true }).sort('sortOrder').lean(),
    ]);
    // Normalise to frontend shape: packs get id field, plans get id field
    const credits = packs.map(p => ({ id: p._id.toString(), name: p.name, credits: p.credits, bonus: p.bonus||0, price: p.price, popular: p.popular||false }));
    const subscriptions = plans.map(p => ({ id: p._id.toString(), key: p.key, name: p.name, price: p.price, dailyLimit: p.dailyLimit||0, validityDays: p.validityDays||30, features: p.features||[] }));
    res.json({ credits, subscriptions });
  } catch(e) { res.status(500).json({ message: 'Could not load plans.' }); }
});

// ── POST /api/payment/create ─────────────────────────────────────────────────
// Creates an Instamojo payment request and returns the payment URL.
router.post('/create', protect, async (req, res) => {
  try {
    const { type, itemId } = req.body;
    if (!type || !itemId)
      return res.status(400).json({ message: 'type and itemId are required.' });

    const user = req.user;
    let amount, purpose, meta = {};

    if (type === 'credits') {
      const mongoose = require('mongoose');
      const packId = mongoose.Types.ObjectId.isValid(itemId) ? itemId : null;
      const pack = packId ? await CreditPack.findById(packId) : null;
      if (!pack || !pack.isActive) return res.status(400).json({ message: 'Invalid or inactive credit pack.' });
      amount  = pack.price;
      purpose = `IntelGrid — ${pack.name}`;
      meta    = { credits: pack.credits + (pack.bonus||0) };

    } else if (type === 'subscription') {
      const mongoose = require('mongoose');
      const planId = mongoose.Types.ObjectId.isValid(itemId) ? itemId : null;
      const plan = planId ? await PlanConfig.findById(planId) : await PlanConfig.findOne({ key: itemId });
      if (!plan || !plan.isActive) return res.status(400).json({ message: 'Invalid or inactive subscription plan.' });
      amount  = plan.price;
      purpose = `IntelGrid — ${plan.name} Plan`;
      meta    = { plan: plan.key, validityDays: plan.validityDays||30 };

    } else {
      return res.status(400).json({ message: 'type must be "credits" or "subscription".' });
    }

    const params = new URLSearchParams({
      purpose,
      amount:                  String(amount),
      buyer_name:              user.name,
      email:                   user.email,
      redirect_url:            `${process.env.BASE_URL}/payment-success.html`,
      send_email:              'false',
      send_sms:                'false',
      allow_repeated_payments: 'false',
    });

    const imojoRes = await axios.post(
      `${IMOJO_BASE()}/payment-requests/`,
      params.toString(),
      { headers: imojoHeaders() }
    );

    const pr = imojoRes.data.payment_request;
    if (!pr?.longurl) return res.status(502).json({ message: 'Payment gateway error. Try again.' });

    await Payment.create({
      userId:    user._id,
      userEmail: user.email,
      type,
      amount,
      requestId: pr.id,
      status:    'pending',
      ...meta,
    });

    res.json({ paymentUrl: pr.longurl, requestId: pr.id });

  } catch (err) {
    console.error('[Payment:create]', err?.response?.data || err.message);
    res.status(500).json({ message: 'Could not create payment. Please try again.' });
  }
});

// ── POST /api/payment/verify ─────────────────────────────────────────────────
// Called from the redirect page after Instamojo redirects back.
// Verifies payment status and credits the IntelGrid user accordingly.
router.post('/verify', protect, async (req, res) => {
  try {
    const { payment_id, payment_request_id } = req.body;
    if (!payment_id || !payment_request_id)
      return res.status(400).json({ message: 'payment_id and payment_request_id are required.' });

    // Fetch payment status from Instamojo
    const imojoRes = await axios.get(
      `${IMOJO_BASE()}/payment-requests/${payment_request_id}/`,
      { headers: imojoHeaders() }
    );

    const pr  = imojoRes.data.payment_request;
    const pay = (pr?.payments || []).find(p => p.payment_id === payment_id);

    if (!pay || pay.status !== 'Credit') {
      await Payment.findOneAndUpdate(
        { requestId: payment_request_id },
        { status: 'failed', paymentId: payment_id }
      );
      return res.status(400).json({ message: 'Payment was not successful.' });
    }

    // Guard against double-processing
    const existing = await Payment.findOne({ requestId: payment_request_id });
    if (existing?.status === 'paid')
      return res.json({ message: 'Payment already applied to your account.' });

    const record = await Payment.findOneAndUpdate(
      { requestId: payment_request_id },
      { status: 'paid', paymentId: payment_id },
      { new: true }
    );

    if (!record) return res.status(404).json({ message: 'Payment record not found.' });

    // ── Apply to IntelGrid user ──────────────────────────────────────────────
    if (record.type === 'credits') {
      await User.findByIdAndUpdate(req.user._id, { $inc: { credits: record.credits } });
      return res.json({
        message: `${record.credits} credits added to your account.`,
        credits: record.credits,
      });

    } else if (record.type === 'subscription') {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + (record.validityDays || 30));
      await User.findByIdAndUpdate(req.user._id, {
        plan:         record.plan,
        planExpiresAt: expiry,
        dailySearches: 0,
        dailyReset:   new Date().toISOString().split('T')[0],
      });
      return res.json({
        message:  `${record.plan.charAt(0).toUpperCase() + record.plan.slice(1)} plan activated until ${expiry.toDateString()}.`,
        plan:     record.plan,
        expiresAt: expiry,
      });
    }

    res.json({ message: 'Payment verified.' });

  } catch (err) {
    console.error('[Payment:verify]', err.message);
    res.status(500).json({ message: 'Verification failed. Contact support.' });
  }
});

// ── GET /api/payment/history ─────────────────────────────────────────────────
router.get('/history', protect, async (req, res) => {
  const payments = await Payment.find({ userId: req.user._id })
    .sort('-createdAt')
    .limit(50);
  res.json({ payments });
});

module.exports = router;
