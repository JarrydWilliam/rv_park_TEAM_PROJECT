// GET /employee/walkin_reports
router.get('/walkin_reports', async (req, res) => {
  // Get all active sites
  const [sites] = await pool.query('SELECT * FROM Site WHERE active = 1');
  // For each site, find the next reservation (if any)
  const availableSites = await Promise.all(sites.map(async site => {
    const [[nextRes]] = await pool.query(
      `SELECT checkIn FROM Reservation WHERE siteId = ? AND checkIn > CURDATE() ORDER BY checkIn ASC LIMIT 1`,
      [site.id]
    );
    let availableUntil = null;
    let durationDays = null;
    if (nextRes && nextRes.checkIn) {
      availableUntil = nextRes.checkIn;
      // Calculate days until next reservation
      const today = new Date();
      const nextDate = new Date(nextRes.checkIn);
      durationDays = Math.max(0, Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24)));
    } else {
      availableUntil = null;
      durationDays = null;
    }
    return {
      number: site.number,
      type: site.type,
      lengthFt: site.lengthFt,
      availableUntil,
      durationDays
    };
  }));
  res.render('employee/walkin_reports', { availableSites });
});
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireRole } = require('../middleware/auth');

// Render manual payment form
router.get('/reservations/:id/payment', requireRole('employee'), async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM Reservation WHERE id = ?', [req.params.id]);
  const reservation = rows[0];
  if (!reservation) return res.status(404).send('Reservation not found');
  res.render('employee/payment_form', { reservation });
});

// Record manual payment
router.post('/reservations/:id/payment', requireRole('employee'), async (req, res) => {
  const { amountPaid, paymentMethod } = req.body;
  await pool.query('UPDATE Reservation SET amountPaid = ?, paymentMethod = ? WHERE id = ?', [amountPaid, paymentMethod, req.params.id]);
  res.redirect('/employee/reservations');
});
// List all reservations
router.get('/reservations', requireRole('employee'), async (req, res) => {
  const [reservations] = await pool.query('SELECT r.*, s.number AS siteNumber FROM Reservation r LEFT JOIN Site s ON r.siteId = s.id');
  res.render('employee/reservations', { reservations });
});
// anastasia comment
// Render create reservation form
router.get('/reservations/new', requireRole('employee'), async (req, res) => {
  const [sites] = await pool.query('SELECT * FROM Site WHERE active = 1');
  res.render('employee/reservation_form', { reservation: null, sites });
});

// Create reservation
router.post('/reservations/new', requireRole('employee'), async (req, res) => {
  const { siteId, guestName, guestEmail, checkIn, checkOut, rigLengthFt, type } = req.body;
  await pool.query(
    'INSERT INTO Reservation (siteId, guestName, guestEmail, checkIn, checkOut, rigLengthFt, type, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    [siteId, guestName, guestEmail, checkIn, checkOut, rigLengthFt, type, 'CONFIRMED']
  );
  res.redirect('/employee/reservations');
});

// Render edit reservation form
router.get('/reservations/:id/edit', requireRole('employee'), async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM Reservation WHERE id = ?', [req.params.id]);
  const reservation = rows[0];
  if (!reservation) return res.status(404).send('Reservation not found');
  const [sites] = await pool.query('SELECT * FROM Site WHERE active = 1');
  res.render('employee/reservation_form', { reservation, sites });
});

// Update reservation
router.post('/reservations/:id/edit', requireRole('employee'), async (req, res) => {
  const { siteId, guestName, guestEmail, checkIn, checkOut, rigLengthFt, type } = req.body;
  await pool.query(
    'UPDATE Reservation SET siteId = ?, guestName = ?, guestEmail = ?, checkIn = ?, checkOut = ?, rigLengthFt = ?, type = ? WHERE id = ?',
    [siteId, guestName, guestEmail, checkIn, checkOut, rigLengthFt, type, req.params.id]
  );
  res.redirect('/employee/reservations');
});

// Cancel reservation
router.post('/reservations/:id/cancel', requireRole('employee'), async (req, res) => {
  await pool.query('UPDATE Reservation SET status = ? WHERE id = ?', ['CANCELLED', req.params.id]);
  res.redirect('/employee/reservations');
});

// List all users
router.get('/users', requireRole('employee'), async (req, res) => {
  const [users] = await pool.query('SELECT * FROM User');
  res.render('employee/users', { users });
});

// Render create user form
router.get('/users/new', requireRole('employee'), (req, res) => {
  res.render('employee/user_form', { user: null });
});

// Create user
router.post('/users/new', requireRole('employee'), async (req, res) => {
  const { username, email, role, password } = req.body;
  await pool.query('INSERT INTO User (username, email, role, password) VALUES (?, ?, ?, ?)', [username, email, role, password]);
  res.redirect('/employee/users');
});

// Render edit user form
router.get('/users/:id/edit', requireRole('employee'), async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM User WHERE id = ?', [req.params.id]);
  const user = rows[0];
  if (!user) return res.status(404).send('User not found');
  res.render('employee/user_form', { user });
});

// Update user
router.post('/users/:id/edit', requireRole('employee'), async (req, res) => {
  const { username, email, role } = req.body;
  await pool.query('UPDATE User SET username = ?, email = ?, role = ? WHERE id = ?', [username, email, role, req.params.id]);
  res.redirect('/employee/users');
});

module.exports = router;
