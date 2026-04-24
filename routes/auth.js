const express = require('express');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

const router = express.Router();

router.get('/login', (req, res) => {
  if (req.session.user) return res.redirect(req.session.user.role === 'admin' ? '/admin' : '/trainer');
  res.render('login', { title: 'Autentificare' });
});

router.post('/login', async (req, res) => {
  const username = String(req.body.username || '').toLowerCase().trim();
  const password = String(req.body.password || '');

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
