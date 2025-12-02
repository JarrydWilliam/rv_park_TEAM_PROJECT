// app.js
const express = require('express');
const app = express();
const path = require('path');

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Serve static files (like CSS or images)
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => {
  res.render('login'); // looks for /views/index.ejs
});


// Guest 
app.get('/guest/dashboard', (req, res) => {
  res.render('guest/dashboard'); // looks for /views/guest/dashboard.ejs
});

app.get('/register', (req, res) => {
  res.render('guest/register'); // looks for /views/guest/dashboard.ejs
});

app.get('/guest/search', (req, res) => {
  res.render('guest/search'); // looks for /views/guest/dashboard.ejs
});

app.get('/guest/book', (req, res) => {
  res.render('guest/book'); // looks for /views/guest/dashboard.ejs
});

app.get('/guest/confirm', (req, res) => {
  res.render('guest/confirm'); // looks for /views/guest/dashboard.ejs
});

app.get('/guest/manage', (req, res) => {
  res.render('guest/manage'); // looks for /views/guest/dashboard.ejs
});

app.get('/guest/profile', (req, res) => {
  res.render('guest/profile'); // looks for /views/guest/dashboard.ejs
});


// Employee 
app.get('/employee', (req,res) => {
  res.render('employee/dashboard');
});

app.get('/employee/checkins', (req,res) => {
  res.render('employee/checkins');
});

app.get('/employee/guestinfo', (req,res) => {
  res.render('employee/guestinfo');
});

app.get('/employee/maintenance', (req,res) => {
  res.render('employee/maintenance');
});

app.get('/employee/addticket', (req,res) => {
  res.render('employee/add-ticket');
});

app.get('/employee/sites', (req,res) => {
  res.render('employee/sites');
});

app.get('/employee/reservations', (req,res) => {
  res.render('employee/reservations');
});

// Admin 

app.get('/admin', (req, res) => {
  res.render('admin/dashboard');
});

app.get('/admin/sites', (req, res) => {
  res.render('admin/sites');
});

app.get('/admin/logs', (req, res) => {
  res.render('admin/logs');
});

app.get('/admin/users', (req, res) => {
  res.render('admin/users');
});

app.get('/admin/reports', (req, res) => {
  res.render('admin/reports'); // looks for /views/admin/reports.ejs
});

// Start the server
app.listen(3000, () => {
  console.log('Server running at http://localhost:3000');
});
