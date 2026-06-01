// Authentication routes for Trading Platform
const express = require('express');
const router = express.Router();
const bcrypt = require('bcryptjs');
const { v4: uuidv4 } = require('uuid');
const { checkAuthenticated, checkNotAuthenticated } = require('../middleware/auth');
const { getCollection } = require('../db');
const { sendLoginEmail } = require('../mailer');

const usersCollection = () => getCollection('users');
const referralsCollection = () => getCollection('referrals');

const normalize = (value) => (value || '').toString().trim().toLowerCase();

const findUserByIdentity = async (identity) => {
  const lower = normalize(identity);
  if (!lower) return null;
  const users = await usersCollection();
  return users.findOne({
    $or: [
      { emailLower: lower },
      { usernameLower: lower }
    ]
  });
};

// Sign up GET route
router.get('/signup', checkNotAuthenticated, (req, res) => {
  res.render('auth/signup', { error: null });
});

// Sign up POST route
router.post('/signup', checkNotAuthenticated, async (req, res) => {
  try {
    const { username, fullName, email, phone, password, country } = req.body;
    
    // Basic validation
    if (!username || !fullName || !email || !password || !country) {
      return res.render('auth/signup', { 
        error: 'All fields are required',
        formData: req.body
      });
    }
    
    // Password validation (min 8 chars, must include uppercase)
    if (password.length < 8 || !/[A-Z]/.test(password)) {
      return res.render('auth/signup', { 
        error: 'Password must be at least 8 characters and include an uppercase letter',
        formData: req.body
      });
    }

    const users = await usersCollection();
    const lowerEmail = normalize(email);
    const lowerUsername = normalize(username);

    const existingUser = await users.findOne({
      $or: [
        { emailLower: lowerEmail },
        { usernameLower: lowerUsername }
      ]
    });

    if (existingUser) {
      return res.render('auth/signup', { 
        error: 'Email or username already registered',
        formData: req.body
      });
    }
    
    // Hash the password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Create new user
    const newUser = {
      id: uuidv4(),
      username,
      usernameLower: lowerUsername,
      fullName,
      email,
      emailLower: lowerEmail,
      phone: phone || '',
      password: hashedPassword,
      country,
      role: 'user',
      status: 'active',
      balance: 0.00,
      referralEarnings: 0.00,
      referralsCount: 0,
      referrals: [],
      canTrade: false,
      createdAt: new Date().toISOString()
    };

    await users.insertOne(newUser);

    const referrerId = req.body.referrer || req.query.ref || req.body.referrerId;
    if (referrerId) {
      const refUser = await users.findOne({ id: referrerId });
      if (refUser) {
        const bonus = 10.00; // signup referral bonus
        await users.updateOne(
          { id: referrerId },
          {
            $inc: { referralsCount: 1, referralEarnings: bonus, balance: bonus },
            $push: { referrals: newUser.id }
          }
        );

        const referrals = await referralsCollection();
        await referrals.insertOne({ id: uuidv4(), referrerId, referredId: newUser.id, amount: bonus, type: 'signup', createdAt: new Date().toISOString() });
        await users.updateOne({ id: newUser.id }, { $set: { referredBy: referrerId } });
      }
    }

    req.session.flashMessage = 'Account created successfully! Please log in.';
    res.redirect('/login');
  } catch (error) {
    console.error('Signup error:', error);
    res.render('auth/signup', { 
      error: 'An error occurred. Please try again.',
      formData: req.body
    });
  }
});

// JSON API sign up route for AJAX flows
router.post('/api/auth/signup', checkNotAuthenticated, async (req, res) => {
  try {
    const { username, fullName, email, phone, country, password } = req.body;

    if (!fullName || !email || !password || !country || !username) {
      return res.status(400).json({ error: 'All fields are required' });
    }

    if (password.length < 8 || !/[A-Z]/.test(password)) {
      return res.status(400).json({ error: 'Password must be at least 8 characters and include an uppercase letter' });
    }

    const users = await usersCollection();
    const lowerEmail = normalize(email);
    const lowerUsername = normalize(username);
    const existingUser = await users.findOne({
      $or: [
        { emailLower: lowerEmail },
        { usernameLower: lowerUsername }
      ]
    });

    if (existingUser) {
      return res.status(409).json({ error: 'Email or username already registered' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const newUser = {
      id: uuidv4(),
      username,
      usernameLower: lowerUsername,
      fullName,
      email,
      emailLower: lowerEmail,
      phone: phone || '',
      password: hashedPassword,
      country,
      role: 'user',
      status: 'active',
      balance: 0.00,
      referralEarnings: 0.00,
      referralsCount: 0,
      referrals: [],
      canTrade: false,
      createdAt: new Date().toISOString()
    };

    await users.insertOne(newUser);

    const referrerId = req.body.referrer || req.body.referrerId || req.query.ref;
    if (referrerId) {
      const refUser = await users.findOne({ id: referrerId });
      if (refUser) {
        const bonus = 10.00;
        await users.updateOne(
          { id: referrerId },
          {
            $inc: { referralsCount: 1, referralEarnings: bonus, balance: bonus },
            $push: { referrals: newUser.id }
          }
        );

        const referrals = await referralsCollection();
        await referrals.insertOne({ id: uuidv4(), referrerId: refUser.id, referredId: newUser.id, amount: bonus, type: 'signup', createdAt: new Date().toISOString() });
        await users.updateOne({ id: newUser.id }, { $set: { referredBy: referrerId } });
      }
    }

    req.session.userId = newUser.id;

    return res.status(201).json({ success: true, redirect: '/user/dashboard', user: { id: newUser.id, username: newUser.username, email: newUser.email, country: newUser.country, createdAt: newUser.createdAt, status: newUser.status } });
  } catch (err) {
    console.error('API signup error:', err);
    return res.status(500).json({ error: 'An error occurred' });
  }
});

// Login GET route
router.get('/login', checkNotAuthenticated, (req, res) => {
  const flashMessage = req.session.flashMessage;
  req.session.flashMessage = null;
  
  res.render('auth/login', { 
    error: null, 
    message: flashMessage
  });
});

// Login POST route
router.post('/login', checkNotAuthenticated, async (req, res) => {
  try {
    const identity = (req.body.identity || req.body.email || '').trim();
    const { password } = req.body;
    
    // Basic validation
    if (!identity || !password) {
      return res.render('auth/login', { 
        error: 'Email/username and password are required',
        formData: { identity }
      });
    }
    
    const user = await findUserByIdentity(identity);
    
    if (!user) {
      return res.render('auth/login', { 
        error: 'Invalid email/username or password',
        formData: { identity }
      });
    }
    
    // Check password
    const isPasswordValid = await bcrypt.compare(password, user.password);
    
    if (!isPasswordValid) {
      return res.render('auth/login', { 
        error: 'Invalid email/username or password',
        formData: { identity }
      });
    }
    
    // Set user session
    req.session.userId = user.id;

    sendLoginEmail(user.email, user.fullName)
      .catch((emailErr) => console.error('Login email error:', emailErr));

    // Redirect to dashboard
    res.redirect('/user/dashboard');
  } catch (error) {
    console.error('Login error:', error);
    res.render('auth/login', { 
      error: 'An error occurred. Please try again.',
      formData: { identity: req.body.identity || req.body.email }
    });
  }
});

// Admin login GET route
router.get('/admin/login', (req, res) => {
  res.render('admin/login', { error: null });
});

// Admin login POST route
router.post('/admin/login', (req, res) => {
  const { email, password } = req.body;
  
  // Hardcoded admin credentials
  if (email === 'admin@example.com' && password === 'Admin123') {
    req.session.isAdmin = true;
    return res.redirect('/admin/dashboard');
  }
  
  res.render('admin/login', { 
    error: 'Invalid admin credentials',
    formData: { email }
  });
});

// Logout route
router.get('/logout', (req, res) => {
  req.session.destroy(err => {
    if (err) {
      console.error('Logout error:', err);
    }
    res.redirect('/login');
  });
});

module.exports = router;
