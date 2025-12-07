// Allow /reserve/new at root to redirect to /reservations/reserve/new

// ========================
// Imports and Setup
// ========================
const express = require('express');
const path = require('path');
const session = require('express-session');
require('dotenv').config();

// Route imports
const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');
const searchRoutes = require('./routes/search');
const reservationRoutes = require('./routes/reservations');
const systemRoutes = require('./routes/system');
const paymentsRoutes = require('./routes/payments');
const reportsRoutes = require('./routes/reports');
const adminRoutes = require('./routes/admin');
const guestRoutes = require('./routes/guest');
const employeeRoutes = require('./routes/employee');
const { requireRole } = require('./middleware/auth');

const app = express();

// ========================
// Middleware
// ========================
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

app.use(express.static(path.join(__dirname, '../public'), {
  maxAge: '7d',
  setHeaders: (res, filePath) => {
    if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
  },
}));

app.use(express.urlencoded({ extended: true }));
app.use(express.json());
app.use(session({
  secret: process.env.SESSION_SECRET || 'dev-rv-park-secret',
  resave: false,
  saveUninitialized: false,
  cookie: {
    httpOnly: true,
    maxAge: 1000 * 60 * 60 * 2,
  },
}));

// Set locals for all views
app.use((req, res, next) => {
  res.locals.title = res.locals.title || 'RV Park';
  res.locals.currentUser = req.session.user || null;
  next();
});

// ========================
// Routes
// ========================
app.use('/', authRoutes);
app.use('/guest', guestRoutes);
app.use('/employee', employeeRoutes);
app.use('/admin', adminRoutes);
app.use('/', dashboardRoutes);
app.use('/system', systemRoutes);
app.use('/reservations', reservationRoutes);
app.use('/payments', paymentsRoutes);
app.use('/reports', requireRole('admin'), reportsRoutes);
app.use('/search', searchRoutes);

// Root route
app.get('/', (req, res) => {
  if (req.session && req.session.user) {
    if (req.session.user.role === 'admin') {
      return res.redirect('/admin/dashboard');
    }
    if (req.session.user.role === 'employee') {
      return res.redirect('/employee/dashboard');
    }
    // default: customer / guest
    return res.redirect('/guest/dashboard');
  }
  return res.render('home');
});

// Allow /reserve/new at root to redirect to /reservations/reserve/new
app.get('/reserve/new', (req, res) => {
  const query = Object.entries(req.query)
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');
  res.redirect(`/reservations/reserve/new${query ? '?' + query : ''}`);
});

module.exports = app;
// (Removed duplicate route mounts and module.exports)
