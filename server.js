require('dotenv').config();

const express = require('express');
const mongoose = require('mongoose');
const session = require('express-session');
const MongoStore = require('connect-mongo');
const methodOverride = require('method-override');
const morgan = require('morgan');
const helmet = require('helmet');
const path = require('path');

const authRoutes = require('./routes/auth');
const adminAiRoutes = require('./routes/adminAi');
const adminRoutes = require('./routes/admin');
const trainerRoutes = require('./routes/trainer');

const app = express();

app.set('trust proxy', 1);

const PORT = process.env.PORT || 3000;
const MONGODB_URI = process.env.MONGODB_URI;
const SESSION_SECRET = process.env.SESSION_SECRET || 'change-me-in-production';

if (!MONGODB_URI) {
  console.error('Lipsește MONGODB_URI în .env');
  process.exit(1);
}

mongoose
  .connect(MONGODB_URI)
  .then(() => console.log('MongoDB conectat'))
  .catch((error) => {
    console.error('Eroare MongoDB:', error.message);
    process.exit(1);
  });

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(helmet({ contentSecurityPolicy: false }));
app.use(morgan('dev'));
app.use(express.urlencoded({ extended: true, limit: '2mb' }));
app.use(express.json({ limit: '2mb' }));
app.use(methodOverride('_method'));
app.use(express.static(path.join(__dirname, 'public')));

app.use(
  session({
    secret: SESSION_SECRET,
    resave: false,
    saveUninitialized: false,
    proxy: true,
    store: MongoStore.create({
      mongoUrl: MONGODB_URI,
      touchAfter: 24 * 3600,
    }),
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  })
);

app.use((req, res, next) => {
  res.locals.currentUser = req.session.user || null;
  res.locals.flash = req.session.flash || null;
  delete req.session.flash;
  next();
});

app.get('/', (req, res) => {
  if (!req.session.user) return res.redirect('/login');
  return res.redirect(req.session.user.role === 'admin' ? '/admin' : '/trainer');
});

app.use('/', authRoutes);
app.use('/admin/ai', adminAiRoutes);
app.use('/admin', adminRoutes);
app.use('/trainer', trainerRoutes);

app.use((req, res) => {
  res.status(404).render('404', { title: 'Pagina nu există' });
});

app.listen(PORT, () => console.log(`Server pornit pe port ${PORT}`));
