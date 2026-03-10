const express = require('express');
const axios   = require('axios');
const { protect } = require('../middleware/auth');
const { Payment } = require('../models/index');
const User = require('../models/User');
const router = express.Router();

const IMOJO  = () => process.env.INSTAMOJO_BASE_URL || 'https://test.instamojo.com/api/1.1';
const iHdrs  = () => ({
  'X-Api-Key':    process.env.INSTAMOJO_API_KEY,
  'X-Auth-Token': process.env.INSTAMOJO_AUTH_TOKEN,
  'Content-Type': 'application/x-www-form-urlencoded'
});

// Credit packs
const CREDIT_PACKS = [
  { id: 'pack_50',  credits: 50,  price: 149,  name: '50 Credits',  bonus: 0  },
  { id: 'pack_150', credits: 150, price: 399,  name: '150 Credits', bonus: 10 },
  { id: 'pack_500', credits: 500, price: 999,  name: '500 Credits', bonus: 50, popular: true },
];

// Subscription plans
const SUB_PLANS = [
  { id: 'basic', name: 'Basic',  price: 299,  dailyLimit: 20, validityDays: 30 },
  { id: 'pro',   name: 'Pro',    price: 599,  dailyLimit: 50, validityDays: 30 },
  { id: 'elite', name: 'Elite',  price: 999,  dailyLimit: 0,  validityDays: 30 },
];

router.get('/packs', (req, res) => res.json({ credits: CREDIT_PACKS, subscriptions: SUB_PLANS }));

// POST /api/payment/create
router.post('/create', protect, async (req, res) => {
  try {
    const { type, itemId } = req.body; // type: 'credits' | 'subscription'
    const user = req.user;

    let amount, purpose, meta = {};

    if (type === 'credits') {
      const pack = CREDIT_PACKS.find(p => p.id === itemId);
      if (!pack) return res.status(400).json({ message: 'Invalid credit pack.' });
      amount  = pack.price;
      purpose = `IntelGrid — ${pack.name}`;
      meta    = { credits: pack.credits + pack.bonus };
    } else if (type === 'subscription') {
      const plan = SUB_PLANS.find(p => p.id === itemId);
      if (!plan) return res.status(400).json({ message: 'Invalid plan.' });
      amount  = plan.price;
      purpose = `IntelGrid — ${plan.name} Plan`;
      meta    = { plan: plan.id, validityDays: plan.validityDays };
    } else {
      return res.status(400).json({ message: 'Invalid payment type.' });
    }

    const params = new URLSearchParams({
      purpose,
      amount:       String(amount),
      buyer_name:   user.name,
      email:        user.email,
      redirect_url: `${process.env.BASE_URL}/payment-success.html`,
      send_email:   'false',
      send_sms:     'false',
      allow_repeated_payments: 'false'
    });

    const r = await axios.post(`${IMOJO()}/payment-requests/`, params.toString(), { headers: iHdrs() });
    const pr = r.data.payment_request;
    if (!pr?.longurl) return res.status(502).json({ message: 'Payment gateway error.' });

    await Payment.create({
      userId: user._id, userEmail: user.email, type, amount,
      requestId: pr.id, status: 'pending', ...meta
    });

    res.json({ paymentUrl: pr.longurl, requestId: pr.id });
  } catch (err) {
    console.error('[Payment Create]', err?.response?.data || err.message);
    res.status(500).json({ message: 'Could not create payment.' });
  }
});

// POST /api/payment/verify
router.post('/verify', protect, async (req, res) => {
  try {
    const { payment_id, payment_request_id } = req.body;

    const r   = await axios.get(`${IMOJO()}/payment-requests/${payment_request_id}/`, { headers: iHdrs() });
    const pr  = r.data.payment_request;
    const pay = (pr?.payments || []).find(p => p.payment_id === payment_id);

    if (!pay || pay.status !== 'Credit') {
      await Payment.findOneAndUpdate({ requestId: payment_request_id }, { status: 'failed', paymentId: payment_id });
      return res.status(400).json({ message: 'Payment not successful.' });
    }

    const rec = await Payment.findOneAndUpdate(
      { requestId: payment_request_id },
      { status: 'paid', paymentId: payment_id },
      { new: true }
    );

    if (rec.type === 'credits') {
      await User.findByIdAndUpdate(req.user._id, { $inc: { credits: rec.credits } });
    } else if (rec.type === 'subscription') {
      const expiry = new Date();
      expiry.setDate(expiry.getDate() + (rec.validityDays || 30));
      await User.findByIdAndUpdate(req.user._id, { plan: rec.plan, planExpiresAt: expiry });
    }

    res.json({ message: 'Payment verified. Account updated.' });
  } catch (err) {
    console.error('[Payment Verify]', err.message);
    res.status(500).json({ message: 'Verification failed.' });
  }
});

module.exports = router;
