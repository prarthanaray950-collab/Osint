require('dotenv').config();
const express   = require('express');
const cors      = require('cors');
const mongoose  = require('mongoose');
const path      = require('path');

const authRoutes    = require('./routes/auth');
const searchRoutes  = require('./routes/search');
const paymentRoutes = require('./routes/payment');
const adminRoutes   = require('./routes/admin');
const userRoutes    = require('./routes/user');

const app = express();

app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));

// API routes
app.use('/api/auth',    authRoutes);
app.use('/api/search',  searchRoutes);
app.use('/api/payment', paymentRoutes);
app.use('/api/admin',   adminRoutes);
app.use('/api/user',    userRoutes);

app.get('/api/health', (req, res) => res.json({ status: 'ok', service: 'IntelGrid API' }));

// Serve index for all non-API routes
app.get('*', (req, res) => {
  if (req.path.startsWith('/api')) return res.status(404).json({ message: 'Not found' });
  const page = req.path.replace('/', '') || 'index.html';
  const file = path.join(__dirname, 'public', page.includes('.') ? page : page + '.html');
  res.sendFile(file, err => {
    if (err) res.sendFile(path.join(__dirname, 'public', 'index.html'));
  });
});

mongoose.connect(process.env.MONGO_URI)
  .then(async () => {
    console.log('MongoDB connected');

    // Seed default data
    const { PlanConfig, CreditPack } = require('./models/index');
    const planCount = await PlanConfig.countDocuments();
    if (planCount === 0) {
      await PlanConfig.insertMany([
        { name: 'Basic',  key: 'basic',  price: 299, dailyLimit: 20, validityDays: 30, features: ['20 searches/day', 'Phone & Vehicle', 'Email support'], sortOrder: 1 },
        { name: 'Pro',    key: 'pro',    price: 599, dailyLimit: 50, validityDays: 30, features: ['50 searches/day', 'All search types', 'Priority support', 'Export results'], sortOrder: 2 },
        { name: 'Elite',  key: 'elite',  price: 999, dailyLimit: 0,  validityDays: 30, features: ['Unlimited searches', 'All search types', '24/7 support', 'API access', 'Bulk export'], sortOrder: 3 },
      ]);
      await CreditPack.insertMany([
        { name: '50 Credits',  credits: 50,  price: 149, bonus: 0,  popular: false },
        { name: '150 Credits', credits: 150, price: 399, bonus: 10, popular: false },
        { name: '500 Credits', credits: 500, price: 999, bonus: 50, popular: true  },
      ]);
      console.log('Default plans and credit packs seeded');
    }

    app.listen(process.env.PORT || 5000, () =>
      console.log(`IntelGrid API running on port ${process.env.PORT || 5000}`)
    );
  })
  .catch(err => { console.error('MongoDB error:', err); process.exit(1); });
