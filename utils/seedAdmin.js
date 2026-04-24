require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../models/User');

async function run() {
  await mongoose.connect(process.env.MONGODB_URI);
  const username = (process.env.ADMIN_USERNAME || 'admin').toLowerCase();
  const password = process.env.ADMIN_PASSWORD || 'admin123';
  const existing = await User.findOne({ username });
  if (existing) {
    console.log('Admin există deja:', username);
    process.exit(0);
  }
  await User.create({
    name: 'Administrator',
    username,
    passwordHash: await bcrypt.hash(password, 10),
    role: 'admin',
    active: true,
  });
  console.log('Admin creat:', username);
  process.exit(0);
}
run().catch((error) => { console.error(error); process.exit(1); });
