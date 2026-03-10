const jwt  = require('jsonwebtoken');
const User = require('../models/User');

const protect = async (req, res, next) => {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer '))
      return res.status(401).json({ message: 'Not authenticated.' });

    const token   = header.split(' ')[1];
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const user    = await User.findById(decoded.id);

    if (!user)       return res.status(401).json({ message: 'User not found.' });
    if (user.isBanned) return res.status(403).json({ message: `Account banned. Reason: ${user.banReason || 'Policy violation'}` });
    if (!user.isActive) return res.status(403).json({ message: 'Account deactivated. Contact support.' });

    req.user = user;
    next();
  } catch (err) {
    return res.status(401).json({ message: 'Invalid or expired token.' });
  }
};

const adminOnly = (req, res, next) => {
  if (req.user?.role !== 'admin')
    return res.status(403).json({ message: 'Admin access required.' });
  next();
};

const hasCredits = (cost = 1) => (req, res, next) => {
  const user = req.user;
  // Check subscription first
  if (user.hasActivePlan()) return next();
  // Else check credits
  if (user.credits < cost)
    return res.status(402).json({ message: `Insufficient credits. Need ${cost}, have ${user.credits}.`, code: 'NO_CREDITS' });
  next();
};

module.exports = { protect, adminOnly, hasCredits };
