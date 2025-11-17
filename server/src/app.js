const express = require('express');
const path = require('path');
require('dotenv').config();

// Route imports
const searchRoutes = require('./routes/search');
const reservationRoutes = require('./routes/reservations');
const systemRoutes = require('./routes/system');

// Alpha Feature Routes
const paymentsRoutes = require('./routes/payments');
const reportsRoutes = require('./routes/reports');

const app = express();

// View engine setup (EJS)
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static assets
app.use(
  express.static(path.join(__dirname, '../public'), {
    maxAge: '7d',
    setHeaders: (res, filePath) => {
      if (filePath.endsWith('.html')) res.setHeader('Cache-Control', 'no-cache');
    },
  })
);

// Body parsers
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

// Default title for EJS templates
app.use((req, res, next) => {
  res.locals.title = res.locals.title || 'RV Park';
  next();
});

// Main routes
app.use('/', searchRoutes);
app.use('/reservations', reservationRoutes);
app.use('/system', systemRoutes);

// 🔹 Mount new Alpha routes
app.use('/payments', paymentsRoutes);
app.use('/reports', reportsRoutes);

// Default route (homepage)
app.get('/', (req, res) => {
  res.render('index', { title: 'RV Park Home' });
});

// 404 handler
app.use((req, res) => {
  res.status(404).render('404', { title: 'Not Found' });
});

module.exports = app;

