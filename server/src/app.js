const express = require('express');
const path = require('path');
require('dotenv').config();

// Existing routes
const searchRoutes = require('./routes/search');
const reservationRoutes = require('./routes/reservations');
const systemRoutes = require('./routes/system');

// Alpha / extra feature routes (added)
const paymentsRoutes = require('./routes/payments');
const reportsRoutes = require('./routes/reports');

const app = express();

// View engine (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static assets from /public  =>  /css/theme.css, /img, etc.
app.use(
  express.static(path.join(__dirname, '../public'), {
    maxAge: '7d',
    setHeaders: (res, filePath) => {
      // don't aggressively cache any HTML we might place in /public
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

// Body parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// default page title for templates that don't set one
app.use((req, res, next) => {
  res.locals.title = res.locals.title || 'RV Park';
  next();
});

/**
 * ORIGINAL MOUNTS (keep behavior for main project)
 * These keep all your existing URLs working the same way as before.
 */
app.use('/', searchRoutes);
app.use('/', reservationRoutes);
app.use('/', systemRoutes);

/**
 * EXTRA MOUNTS FOR ALPHA
 * These allow direct URLs like:
 *   /reservations
 *   /payments
 *   /reports
 * without breaking anything that already worked.
 */
app.use('/reservations', reservationRoutes);
app.use('/payments', paymentsRoutes);
app.use('/reports', reportsRoutes);

module.exports = app;
