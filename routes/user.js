
// User routes for Trading Platform
const express = require('express');
const router = express.Router();
const fs = require('fs');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { getCollection } = require('../db');
const { sendCopyTradeEmail, sendInvestmentEmail } = require('../mailer');

// Helper functions to read/write JSON files
const withdrawalsPath = path.join(__dirname, '../data/withdrawals.json');
const depositsPath = path.join(__dirname, '../data/deposits.json');
const investmentsPath = path.join(__dirname, '../data/investments.json');
const copiesPath = path.join(__dirname, '../data/copies.json');
const kycPath = path.join(__dirname, '../data/kyc.json');
const creditsPath = path.join(__dirname, '../data/credits.json');

const getUsersCollection = () => getCollection('users');
const getWithdrawals = () => {
  const data = fs.readFileSync(withdrawalsPath, 'utf8');
  return JSON.parse(data);
};

const saveWithdrawals = (withdrawals) => {
  fs.writeFileSync(withdrawalsPath, JSON.stringify(withdrawals, null, 2));
};

const getDeposits = () => {
  const data = fs.readFileSync(depositsPath, 'utf8');
  return JSON.parse(data);
};

const saveDeposits = (deposits) => {
  fs.writeFileSync(depositsPath, JSON.stringify(deposits, null, 2));
};

const getInvestments = () => {
  try {
    if (!fs.existsSync(investmentsPath)) fs.writeFileSync(investmentsPath, JSON.stringify([], null, 2));
    const data = fs.readFileSync(investmentsPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
};

const saveInvestments = (investments) => {
  fs.writeFileSync(investmentsPath, JSON.stringify(investments, null, 2));
};

const getCopies = () => {
  try {
    if (!fs.existsSync(copiesPath)) fs.writeFileSync(copiesPath, JSON.stringify([], null, 2));
    const data = fs.readFileSync(copiesPath, 'utf8');
    return JSON.parse(data);
  } catch (err) {
    return [];
  }
};

const saveCopies = (copies) => {
  fs.writeFileSync(copiesPath, JSON.stringify(copies, null, 2));
};

const getKyc = () => {
  try { if (!fs.existsSync(kycPath)) fs.writeFileSync(kycPath, JSON.stringify([])); return JSON.parse(fs.readFileSync(kycPath,'utf8')); } catch(e){return[]}
};
const saveKyc = (list) => { fs.writeFileSync(kycPath, JSON.stringify(list, null, 2)); };

const getCredits = () => {
  try { if (!fs.existsSync(creditsPath)) fs.writeFileSync(creditsPath, JSON.stringify([])); return JSON.parse(fs.readFileSync(creditsPath,'utf8')); } catch(e){return[]}
};
const saveCredits = (list) => { fs.writeFileSync(creditsPath, JSON.stringify(list, null, 2)); };

const getCurrentUser = (req) => req.currentUser || null;

router.use(async (req, res, next) => {
  if (req.session.userId) {
    req.currentUser = await (await getUsersCollection()).findOne({ id: req.session.userId });
  }
  next();
});

const updateUserBalance = async (userId, newBalance) => {
  const users = await getUsersCollection();
  const result = await users.findOneAndUpdate(
    { id: userId },
    { $set: { balance: newBalance } },
    { returnDocument: 'after' }
  );
  return result.value;
};

// Dashboard route
router.get('/dashboard', (req, res) => {
  const user = req.currentUser;
  if (!user) {
    req.session.destroy();
    return res.redirect('/login');
  }

  const activeCopies = getCopies().filter(copy => copy.userId === user.id && copy.status === 'active');
  const activeInvestments = getInvestments().filter(inv => inv.userId === user.id && inv.status === 'active');

  res.render('user/dashboard', {
    user,
    page: 'dashboard',
    activeCopies,
    activeInvestments
  });
});

// Trade route
router.get('/trade', (req, res) => {
  const user = req.currentUser;
  
  if (!user) {
    req.session.destroy();
    return res.redirect('/login');
  }
  
  res.render('user/trade', { user, page: 'trade' });
});

// Process trade route
router.post('/trade', async (req, res) => {
  const user = req.currentUser;
  
  if (!user) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  
  const { amount, signal } = req.body;
  const tradeAmount = parseFloat(amount);
  
  // Validate trade
  if (isNaN(tradeAmount) || tradeAmount < 10) {
    return res.status(400).json({ error: 'Invalid trade amount' });
  }
  
  if (tradeAmount > user.balance) {
    return res.status(400).json({ error: 'Insufficient balance' });
  }
  
  // Update user balance
  const newBalance = user.balance - tradeAmount;
  const updatedUser = await updateUserBalance(user.id, newBalance);
  
  if (!updatedUser) {
    return res.status(500).json({ error: 'Failed to process trade' });
  }
  
  res.json({ 
    success: true,
    newBalance: updatedUser.balance
  });
});

// Deposit route
router.get('/deposit', (req, res) => {
  const user = req.currentUser;
  
  if (!user) {
    req.session.destroy();
    return res.redirect('/login');
  }
  
  res.render('user/deposit', { 
    user, 
    page: 'deposit',
    success: null,
    error: null
  });
});

// Submit deposit route
router.post('/deposit', (req, res) => {
  const user = req.currentUser;
  
  if (!user) {
    req.session.destroy();
    return res.redirect('/login');
  }
  
  const { amount, cryptocurrency } = req.body;
  
  // Basic validation
  if (!amount || !cryptocurrency) {
    return res.render('user/deposit', {
      user,
      page: 'deposit',
      error: 'All fields are required',
      success: null
    });
  }
  
  // Create deposit request
  const depositRequest = {
    id: uuidv4(),
    userId: user.id,
    userEmail: user.email,
    userName: user.fullName,
    amount: parseFloat(amount),
    cryptocurrency,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  
  // Save deposit request
  const deposits = getDeposits();
  deposits.push(depositRequest);
  saveDeposits(deposits);
  
  res.render('user/deposit', {
    user,
    page: 'deposit',
    success: 'Deposit request submitted successfully!',
    error: null
  });
});

// Withdraw route
router.get('/withdraw', (req, res) => {
  const user = req.currentUser;
  
  if (!user) {
    req.session.destroy();
    return res.redirect('/login');
  }
  
  res.render('user/withdraw', { 
    user, 
    page: 'withdraw', 
    error: null, 
    success: null 
  });
});

// Withdraw POST route
router.post('/withdraw', (req, res) => {
  const user = req.currentUser;
  
  if (!user) {
    req.session.destroy();
    return res.redirect('/login');
  }
  
  const { bitcoinAddress, walletUid, amount } = req.body;
  
  // Basic validation
  if (!bitcoinAddress || !amount) {
    return res.render('user/withdraw', { 
      user, 
      page: 'withdraw', 
      error: 'Bitcoin address and amount are required', 
      success: null,
      formData: req.body
    });
  }
  
  // Amount validation
  const withdrawAmount = parseFloat(amount);
  if (isNaN(withdrawAmount) || withdrawAmount <= 0) {
    return res.render('user/withdraw', { 
      user, 
      page: 'withdraw', 
      error: 'Please enter a valid amount', 
      success: null,
      formData: req.body
    });
  }
  
  if (withdrawAmount > user.balance) {
    return res.render('user/withdraw', { 
      user, 
      page: 'withdraw', 
      error: 'Insufficient balance', 
      success: null,
      formData: req.body
    });
  }
  
  // Create withdrawal request
  const withdrawalRequest = {
    id: uuidv4(),
    userId: user.id,
    userEmail: user.email,
    userName: user.fullName,
    bitcoinAddress,
    walletUid: walletUid || '',
    amount: withdrawAmount,
    status: 'pending',
    createdAt: new Date().toISOString()
  };
  
  // Save withdrawal request
  const withdrawals = getWithdrawals();
  withdrawals.push(withdrawalRequest);
  saveWithdrawals(withdrawals);
  
  // Return success
  res.render('user/withdraw', { 
    user, 
    page: 'withdraw', 
    error: null, 
    success: 'Withdrawal request submitted successfully!',
    formData: {}
  });
});

// Additional dashboard pages (placeholders with designed UI)
const requireUser = (req, res, view, page) => {
  const user = req.currentUser;
  if (!user) { req.session.destroy(); return res.redirect('/login'); }
  res.render(view, { user, page });
};

router.get('/account-statement', (req, res) => requireUser(req, res, 'user/account-statement', 'account-statement'));
router.get('/real-estate-plans', (req, res) => requireUser(req, res, 'user/real-estate-plans', 'real-estate-plans'));
router.get('/my-portfolio', (req, res) => requireUser(req, res, 'user/my-portfolio', 'my-portfolio'));
router.get('/performance-history', (req, res) => requireUser(req, res, 'user/performance-history', 'performance-history'));
router.get('/copy-trading', (req, res) => {
  const user = req.currentUser;
  if (!user) {
    req.session.destroy();
    return res.redirect('/login');
  }
  res.render('user/experts', { user, page: 'copy-trading' });
});
router.get('/ai-trading-bots', (req, res) => requireUser(req, res, 'user/ai-trading-bots', 'ai-trading-bots'));
router.get('/internal-transfer', (req, res) => requireUser(req, res, 'user/internal-transfer', 'internal-transfer'));
router.get('/apply-credit', (req, res) => requireUser(req, res, 'user/apply-credit', 'apply-credit'));
router.get('/credit-history', (req, res) => requireUser(req, res, 'user/credit-history', 'credit-history'));
router.get('/profile-settings', (req, res) => requireUser(req, res, 'user/profile-settings', 'profile-settings'));
router.get('/identity-verification', (req, res) => requireUser(req, res, 'user/identity-verification', 'identity-verification'));
// Growth & Rewards removed (now a nav title). Route intentionally disabled.
router.get('/referral-program', (req, res) => requireUser(req, res, 'user/referral-program', 'referral-program'));
router.get('/support-center', (req, res) => requireUser(req, res, 'user/support-center', 'support-center'));

// Experts listing (not in sidebar)
router.get('/experts', (req, res) => requireUser(req, res, 'user/experts', 'experts'));

// Bot trading detail (not in sidebar) -- renders a single bot by id
router.get('/bot-trading/:id', (req, res) => {
  const user = req.currentUser;
  if (!user) { req.session.destroy(); return res.redirect('/login'); }

  const id = req.params.id || '4';
  const botsMap = {
    '4': {
      id: '4',
      name: 'GoldRush Bot',
      title: 'Specialized commodities trading bot with expertise in precious metals and energy markets. Ideal for portfolio diversification and inflation hedging strategies.',
      status: 'Active',
      performance: '84.0',
      successRate: '84%',
      totalTrades: 0,
      totalProfit: 0.00,
      expectedReturn: '1.8%',
      strategyType: 'Advanced AI Trading',
      tradingFrequency: 'Multiple times daily',
      description: 'Advanced machine learning algorithms analyze market patterns to execute profitable trades.',
      minInvestment: 200,
      maxInvestment: 15000,
      expectedROI: '0.0%',
      riskLevel: 'Medium'
    }
  };

  const bot = botsMap[id] || botsMap['4'];
  res.render('user/bot-trading', { user, page: 'bot-trading', bot });
});

// Receive deposit selection from deposit page and respond with redirect URL
router.post('/payment', (req, res) => {
  const user = req.currentUser;
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized' });

  // Accept form-data or json
  const paymentMethod = req.body.paymentMethod || (req.body.get && req.body.get('paymentMethod')) || req.body.method || req.query.method;
  const amount = req.body.amount || (req.body.get && req.body.get('amount')) || req.query.amount;

  if (!paymentMethod || !amount) {
    return res.json({ success: false, message: 'Missing payment method or amount' });
  }

  const redirect = `/user/payment?method=${encodeURIComponent(paymentMethod)}&amount=${encodeURIComponent(amount)}`;
  return res.json({ success: true, redirect });
});

// Render payment page showing address/QR for selected currency
router.get('/payment', (req, res) => {
  const user = req.currentUser;
  if (!user) { req.session.destroy(); return res.redirect('/login'); }

  const method = req.query.method || 'USDT';
  const amount = Number(req.query.amount) || 0;

  // Simple address mapping — replace with real addresses as needed
  const addressMap = {
    XRP: 'rHncB8VCL7A4cHMsCMdGsjgzeCmc7f7ZY',
    DOGE: 'D9mY2oVd8x7zQe1RkP9sT9uV6g3hJkLmN',
    USDT_ERC20: '0xAbCdEf0123456789abcdef0123456789AbCdEf01',
    SOL: 'So1anaExampleAddress1111111111111111111111',
    USDT: 'TetherExampleAddress11111111111111111111',
    BTC: '1BoatSLRHtKNngkdXEeobR76b53LETtpyT'
  };

  const address = addressMap[method] || addressMap['USDT'];

  // QR URL for displaying
  const qrUrl = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(address)}`;

  res.render('user/payment', { user, page: 'payment', method, amount, address, qrUrl });
});

// Submit payment proof (AJAX) -> create deposit request and notify admin via deposits.json
router.post('/payment/submit', (req, res) => {
  const user = req.currentUser;
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized', redirect: '/login' });

  const amount = parseFloat(req.body.amount);
  const cryptocurrency = req.body.cryptocurrency || req.body.method || req.body.currency;
  const proof = req.body.proof || '';

  if (isNaN(amount) || amount <= 0) return res.json({ success: false, message: 'Invalid amount' });
  if (!cryptocurrency) return res.json({ success: false, message: 'Missing cryptocurrency' });

  const depositRequest = {
    id: uuidv4(),
    userId: user.id,
    userEmail: user.email,
    userName: user.fullName,
    amount: parseFloat(amount.toFixed(2)),
    cryptocurrency,
    proof: proof || null,
    status: 'pending',
    createdAt: new Date().toISOString()
  };

  const deposits = getDeposits();
  deposits.push(depositRequest);
  saveDeposits(deposits);

  return res.json({ success: true, message: 'Deposit submitted', redirect: '/user/dashboard' });
});

// Join a copy-trading expert (AJAX)
router.post('/join-copy', async (req, res) => {
  const user = req.currentUser;
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized', redirect: '/login' });

  const amount = parseFloat(req.body.amount);
  const expertId = req.body.expertId || null;
  const expertName = req.body.expertName || 'Expert';

  if (isNaN(amount) || amount <= 0) {
    return res.json({ success: false, message: 'Invalid amount' });
  }

  const currentBalance = Number(user.balance) || 0;
  if (amount > currentBalance) {
    return res.json({ success: false, message: 'Insufficient balance', redirect: '/user/deposit' });
  }

  // Deduct balance and record copy with rollback on failure to avoid losing funds
  const newBalance = Number((currentBalance - amount).toFixed(2));
  try {
    const updated = await updateUserBalance(user.id, newBalance);
    if (!updated) throw new Error('Failed to update balance');

    // Record copy
    const copies = getCopies();
    const copyRecord = {
      id: uuidv4(),
      userId: user.id,
      userEmail: user.email,
      expertId,
      expertName,
      amount,
      status: 'active',
      createdAt: new Date().toISOString()
    };
    copies.push(copyRecord);
    saveCopies(copies);

    sendCopyTradeEmail(user.email, user.fullName, expertName, amount)
      .catch((emailErr) => console.error('Copy trade email error:', emailErr));

    return res.json({ success: true, message: 'Copying started', newBalance: updated.balance });
  } catch (err) {
    console.error('Join copy error:', err);
    // Attempt rollback if balance was changed
    try {
      const currentUser = await (await getUsersCollection()).findOne({ id: user.id });
      if (currentUser && Number(currentUser.balance) === newBalance) {
        // revert
        await updateUserBalance(user.id, Number((newBalance + amount).toFixed(2)));
      }
      req.session.user.balance = currentBalance;
    } catch (rollbackErr) {
      console.error('Rollback failed:', rollbackErr);
    }

    return res.status(500).json({ success: false, message: 'Unable to copy at this time. Please try again later.' });
  }
});

// Join investment plan (AJAX)
router.post('/join-plan', async (req, res) => {
  const user = req.currentUser;
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized', redirect: '/login' });

  const amount = parseFloat(req.body.amount);
  const planId = req.body.planId || null;
  const planName = req.body.planName || 'Investment Plan';

  if (isNaN(amount) || amount <= 0) {
    return res.json({ success: false, message: 'Invalid amount' });
  }

  const currentBalance = Number(user.balance) || 0;
  if (amount > currentBalance) {
    return res.json({ success: false, message: 'Insufficient balance', redirect: '/user/deposit' });
  }

  // Deduct balance
  const newBalance = Number((currentBalance - amount).toFixed(2));
  const updated = await updateUserBalance(user.id, newBalance);
  if (!updated) return res.status(500).json({ success: false, message: 'Failed to update balance' });

  // Record investment
  const investments = getInvestments();
  const investmentRecord = {
    id: uuidv4(),
    userId: user.id,
    userEmail: user.email,
    planId: planId,
    planName: planName,
    amount: amount,
    status: 'active',
    createdAt: new Date().toISOString()
  };
  investments.push(investmentRecord);
  saveInvestments(investments);

  sendInvestmentEmail(user.email, user.fullName, planName, amount)
    .catch((emailErr) => console.error('Investment email error:', emailErr));

  return res.json({ success: true, message: 'Investment started', newBalance: updated.balance });
});

// Submit KYC (AJAX)
router.post('/kyc-submit', (req, res) => {
  const user = req.currentUser;
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized', redirect: '/login' });

  const { fullName, idNumber, country, document } = req.body;
  if (!fullName || !idNumber || !country) return res.json({ success: false, message: 'Missing KYC fields' });

  const kyc = getKyc();
  const record = {
    id: uuidv4(), userId: user.id, userName: user.fullName, fullName, idNumber, country, document: document || null, status: 'pending', createdAt: new Date().toISOString()
  };
  kyc.push(record);
  saveKyc(kyc);

  return res.json({ success: true, message: 'KYC submitted' });
});

// Update profile
router.post('/profile/update', async (req, res) => {
  const user = req.currentUser;
  if (!user) { req.session.destroy(); return res.redirect('/login'); }
  const { fullName, phone, country } = req.body;
  const updateFields = {};
  if (fullName) updateFields.fullName = fullName;
  if (phone) updateFields.phone = phone;
  if (country) updateFields.country = country;
  updateFields.updatedAt = new Date().toISOString();

  const users = await getUsersCollection();
  await users.updateOne({ id: user.id }, { $set: updateFields });

  return res.redirect('/user/profile-settings');
});

// Apply for credit (AJAX) - not auto-approved; admin will review
router.post('/apply-credit', (req, res) => {
  const user = req.currentUser;
  if (!user) return res.status(401).json({ success: false, message: 'Unauthorized', redirect: '/login' });

  const amount = parseFloat(req.body.amount);
  const reason = req.body.reason || '';
  if (isNaN(amount) || amount <= 0) return res.json({ success: false, message: 'Invalid amount' });

  const credits = getCredits();
  const reqRecord = { id: uuidv4(), userId: user.id, userName: user.fullName, amount: parseFloat(amount.toFixed(2)), reason, status: 'pending', createdAt: new Date().toISOString() };
  credits.push(reqRecord);
  saveCredits(credits);

  return res.json({ success: true, message: 'Credit request submitted' });
});

module.exports = router;
