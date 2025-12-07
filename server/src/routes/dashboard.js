// server/src/routes/dashboard.js

const express = require('express');
const router = express.Router();


// --- Guest dashboard ---
router.get('/guest/dashboard', (req, res) => {
  return res.render('guest/dashboard');
});

// --- Employee dashboard ---
router.get('/employee/dashboard', (req, res) => {
  return res.render('employee/dashboard');
 
});

// --- Admin dashboard  ---
router.get('/admin/dashboard', (req, res) => {
  return res.render('admin/dashboard');
 
});

module.exports = router;
