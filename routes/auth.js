const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) {
    return res.redirect(req.session.user.role === 'admin' ? '/admin' : '/trainer');
  }

  res.render('login', { title: 'Autentificare' });
});

router.post('/login', async (req, res) => {
  const username = String(req.body.username || '').toLowerCase().trim();
  const password = String(req.body.password || '');

  // Login admin din Render Environment Variables
  if (
    username === String(process.env.ADMIN_USER || '').toLowerCase().trim() &&
    password === String(process.env.ADMIN_PASSWORD || '')
  ) {
    req.session.user = {
      id: 'admin',
      name: 'Administrator',
      username: username,
      role: 'admin',
      location: '',
    };

    return res.redirect('/admin');
  }

  // Login traineri din MongoDB
  const user = await User.findOne({ username, active: true });

  if (!user) {
    req.session.flash = { type: 'error', message: 'User sau parolă incorecte.' };
    return res.redirect('/login');
  }

  const ok = await bcrypt.compare(password, user.passwordHash);

  if (!ok) {
    req.session.flash = { type: 'error', message: 'User sau parolă incorecte.' };
    return res.redirect('/login');
  }

  req.session.user = {
    id: user._id.toString(),
    name: user.name,
    username: user.username,
    role: user.role,
    location: user.location,
  };

  res.redirect(user.role === 'admin' ? '/admin' : '/trainer');
});

router.post('/logout', (req, res) => {
  req.session.destroy(() => res.redirect('/login'));
});

module.exports = router;
