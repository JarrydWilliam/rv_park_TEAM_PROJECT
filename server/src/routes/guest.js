const express = require('express');
const pool = require('../db/pool');
const router = express.Router();

// GET /my_reservations - show current user's reservations
router.get('/my_reservations', async (req, res) => {
  try {
    // Replace with your actual user identification logic
    const user = req.session.user;
    const userId = user && user.id;
    if (!userId) return res.redirect('/login');

    // Query reservations for the current user
    const [rows] = await pool.query(
      `SELECT r.*, s.number AS siteNumber, s.type AS siteType
       FROM Reservation r
       JOIN Site s ON r.siteId = s.id
       WHERE r.guestId = ?
       ORDER BY r.checkIn DESC`,
      [userId]
    );

    res.render('guest/my_reservations', {
      reservations: rows,
      error: null,
      currentUser: user || null
    });
  } catch (e) {
    res.render('guest/my_reservations', {
      reservations: [],
      error: 'Failed to load reservations.',
      currentUser: req.session.user || null
    });
  }
});

module.exports = router;
