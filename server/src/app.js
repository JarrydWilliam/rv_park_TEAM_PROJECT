
const express = require('express');
const path = require('path');
const session = require('express-session');
require('dotenv').config();

const authRoutes = require('./routes/auth');
const dashboardRoutes = require('./routes/dashboard');   
const searchRoutes = require('./routes/search');
const reservationRoutes = require('./routes/reservations');
const systemRoutes = require('./routes/system');
const paymentsRoutes = require('./routes/payments');
const reportsRoutes = require('./routes/reports');
const adminRoutes = require('./routes/admin');
const guestRoutes = require('./routes/guest');



const { requireRole } = require('./middleware/auth');

const app = express();

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));


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
// Sessions (for login, roles, etc.)
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'dev-rv-park-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      maxAge: 1000 * 60 * 60 * 2, 
    },
  })
);

// Register guest routes after session middlewar
app.use('/', guestRoutes);


app.use((req, res, next) => {
  res.locals.title = res.locals.title || 'RV Park';
  res.locals.currentUser = req.session.user || null; 
  next();
});

app.get('/', (req, res) => {
  if (!req.session.user) {
    return res.redirect('/login');
  }
  
  if (req.session.user.role === 'admin') return res.redirect('/admin/dashboard');
  if (req.session.user.role === 'employee') return res.redirect('/employee/dashboard');
  return res.redirect('/guest/dashboard');
});


app.use('/', authRoutes);
app.use('/', searchRoutes);
app.use('/', reservationRoutes);

// ---------- ROUTE MOUNTS ----------

app.use('/', authRoutes);

app.use('/', dashboardRoutes); 
app.use('/', adminRoutes);


app.use('/', searchRoutes);
app.use('/', reservationRoutes);
app.use('/', systemRoutes);


app.use('/reservations', reservationRoutes);
app.use('/payments', paymentsRoutes);

app.use('/reports', requireRole('admin'), reportsRoutes);

module.exports = app;
