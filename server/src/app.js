const express = require('express');
const path = require('path');
require('dotenv').config();

const searchRoutes = require('./routes/search');
const reservationRoutes = require('./routes/reservations');
const systemRoutes = require('./routes/system');

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

// Optional: default page title for templates that don't set one
app.use((req, res, next) => {
  res.locals.title = res.locals.title || 'RV Park';
  next();
});

// Routes
app.use('/', searchRoutes);
app.use('/', reservationRoutes);
app.use('/', systemRoutes);

module.exports = app;
