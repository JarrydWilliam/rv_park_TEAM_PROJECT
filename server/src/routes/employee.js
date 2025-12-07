const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireRole } = require('../middleware/auth');
const { nightsBetween, activeRateFor, toDate } = require('../utils/policy');

// ============================================================
// Select customer before making a reservation
router.get('/reservations/select-customer', requireRole('employee'), async (req, res) => {
  const [customers] = await pool.query(
    "SELECT id, first_name, last_name, email, username FROM users WHERE role = 'customer'"
  );
  res.render('employee/select_customer', {
    customers,
    currentUser: req.session.user || null
  });
});
// ============================================================
router.get('/dashboard', requireRole('employee'), async (req, res) => {
  // Quick stats for employee view
  const [[stats]] = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM users WHERE role='customer') AS totalCustomers,
      (SELECT COUNT(*) FROM Reservation WHERE status='CONFIRMED') AS totalReservations,
      (SELECT COUNT(*) FROM Reservation WHERE paid=0 AND status='CONFIRMED') AS unpaidReservations
  `);

  res.render('employee/dashboard', {
    stats,
    currentUser: req.session.user || null
  });
});

/* ============================================================
   CUSTOMER CREATION
   ============================================================ */
router.get('/users/new', requireRole('employee'), (req, res) => {
  res.render('employee/user_form', {
    user: null,
    currentUser: req.session.user || null,
    error: null
  });
});

router.post('/users/new', requireRole('employee'), async (req, res) => {
  try {
    const {
      username, email, firstName, lastName, password,
      dodAffiliation, branch, rank, numAdults, numPets, petBreedNotes
    } = req.body;

    const crypto = require('crypto');
    const password_hash = crypto.createHash('sha256').update(password).digest('hex');

    const [result] = await pool.query(
      `
        INSERT INTO users (
          username, email, first_name, last_name, password_hash, role,
          dod_affiliation, branch, rank_grade, num_adults, num_pets, pet_breed_notes
        ) VALUES (?, ?, ?, ?, ?, 'customer', ?, ?, ?, ?, ?, ?)
      `,
      [
        username, email, firstName, lastName, password_hash,
        dodAffiliation, branch, rank, numAdults, numPets, petBreedNotes
      ]
    );

    return res.redirect(`/employee/reservations/new?userId=${result.insertId}`);
  } catch (err) {
    console.error(err);
    return res.render('employee/user_form', {
      user: null,
      currentUser: req.session.user || null,
      error: 'Error creating customer account.'
    });
  }
});

/* ============================================================
   RESERVATION CREATION
   ============================================================ */
router.get('/reservations/new', requireRole('employee'), async (req, res) => {
  const { userId, checkIn, checkOut, rigLengthFt } = req.query;

  let guest = null;
  let availableSites = [];
  let error = null;

  if (userId) {
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
    guest = rows[0] || null;
  }

  if (checkIn && checkOut && rigLengthFt) {
    const ci = new Date(checkIn);
    const co = new Date(checkOut);
    const today = new Date();

    if (ci < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
      error = 'Check-in cannot be in the past.';
    } else if (co <= ci) {
      error = 'Check-out must be after check-in.';
    } else {
      const [sites] = await pool.query(
        `
          SELECT *
          FROM Site
          WHERE active = 1
            AND lengthFt >= ?
            AND id NOT IN (
              SELECT siteId
              FROM Reservation
              WHERE NOT (checkOut <= ? OR checkIn >= ?)
            )
        `,
        [rigLengthFt, checkIn, checkOut]
      );
      availableSites = sites;
    }
  }

  res.render('employee/reservation_form', {
    reservation: null,
    guest: guest || null,
    userId: userId || null,
    checkIn: checkIn || null,
    checkOut: checkOut || null,
    rigLengthFt: rigLengthFt || null,
    availableSites: availableSites || [],
    error: error || null,
    currentUser: req.session.user || null
  });
});

router.post('/reservations/new', requireRole('employee'), async (req, res) => {
  try {
    const { siteId, userId, checkIn, checkOut, rigLengthFt } = req.body;

    // Load guest
    const [rows] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
    const guest = rows[0] || null;
    if (!guest) {
      return res.render('employee/reservation_form', {
        error: 'Guest not found.',
        guest: null,
        userId: userId || null,
        checkIn: checkIn || null,
        checkOut: checkOut || null,
        rigLengthFt: rigLengthFt || null,
        availableSites: [],
        currentUser: req.session.user || null
      });
    }

    const ci = toDate(checkIn);
    const co = toDate(checkOut);

    if (!ci || !co || co <= ci) {
      return res.render('employee/reservation_form', {
        error: 'Invalid date range.',
        guest,
        currentUser: req.session.user || null
      });
    }

    // conflict detection
    const [conflicts] = await pool.query(
      `
        SELECT id
        FROM Reservation
        WHERE siteId = ?
          AND NOT (checkOut <= ? OR checkIn >= ?)
      `,
      [siteId, checkIn, checkOut]
    );

    if (conflicts.length > 0) {
      return res.render('employee/reservation_form', {
        error: 'Site is already reserved for those dates.',
        guest,
        currentUser: req.session.user || null
      });
    }

    const nights = nightsBetween(ci, co);

    const [siteRows] = await pool.query('SELECT * FROM Site WHERE id = ?', [siteId]);
    const site = siteRows[0];
    const { nightlyRate } = await activeRateFor(site.type, ci);

    const amount = nightlyRate * nights;
    const confirmation = 'E' + Math.random().toString(36).substring(2, 10).toUpperCase();

    const [result] = await pool.query(
      `
        INSERT INTO Reservation
          (siteId, guestId, guestName, guestEmail, checkIn, checkOut,
           rigLengthFt, confirmationCode, status, paid, nightlyRate, amountPaid)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', 0, ?, ?)
      `,
      [
        siteId,
        userId,
        `${guest.first_name} ${guest.last_name}`,
        guest.email,
        checkIn,
        checkOut,
        rigLengthFt,
        confirmation,
        nightlyRate,
        amount
      ]
    );

    return res.redirect(`/employee/reservations/${result.insertId}/payment`);

  } catch (err) {
    console.error(err);
    return res.render('employee/reservation_form', {
      error: 'Error saving reservation.',
      currentUser: req.session.user || null
    });
  }
});

/* ============================================================
   PAYMENT PROCESSING
   ============================================================ */
router.get('/reservations/:id/payment', requireRole('employee'), async (req, res) => {
  const id = req.params.id;

  const [rows] = await pool.query('SELECT * FROM Reservation WHERE id = ?', [id]);
  const reservation = rows[0];
  if (!reservation) return res.status(404).send('Reservation not found.');

  const ci = new Date(reservation.checkIn);
  const co = new Date(reservation.checkOut);
  const nights = nightsBetween(ci, co);

  const [siteRows] = await pool.query('SELECT * FROM Site WHERE id = ?', [reservation.siteId]);
  const site = siteRows[0];
  const { nightlyRate } = await activeRateFor(site.type, ci);

  const totalAmount = nightlyRate * nights;

  res.render('employee/payment_form', {
    reservation,
    totalAmount,
    currentUser: req.session.user || null
  });
});

router.post('/reservations/:id/payment', requireRole('employee'), async (req, res) => {
  const id = req.params.id;
  const { amountPaid, paymentMethod, paymentStatus } = req.body;

  const paid = paymentStatus === 'taken' ? 1 : 0;

  await pool.query(
    `
      UPDATE Reservation
      SET amountPaid = ?, paymentMethod = ?, paid = ?
      WHERE id = ?
    `,
    [amountPaid, paymentMethod, paid, id]
  );

  const txnId = 'EMP-' + Math.random().toString(36).substring(2, 10).toUpperCase();

  await pool.query(
    `
      INSERT INTO Payment
        (reservationId, userId, amount, paymentMethod, status, transactionId, notes, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    `,
    [
      id,
      req.session.user?.id || null,
      Number(amountPaid),
      paymentMethod,
      paid ? 'Completed' : 'Pending',
      txnId,
      'Employee payment entry'
    ]
  );

  res.redirect('/employee/reservations');
});

/* ============================================================
   VIEW / MANAGE RESERVATIONS
   ============================================================ */
router.get('/reservations', requireRole('employee'), async (req, res) => {
  const [rows] = await pool.query(
    `
      SELECT r.*, s.number AS siteNumber
      FROM Reservation r
      LEFT JOIN Site s ON r.siteId = s.id
      ORDER BY r.checkIn DESC
    `
  );

  res.render('employee/reservations', {
    reservations: rows,
    currentUser: req.session.user || null
  });
});

// (Legacy) Simple reservation creation – left in place in case templates depend on it

// Edit reservation (basic employee flow)
router.get('/reservations/:id/edit', requireRole('employee'), async (req, res) => {
  const id = req.params.id;
  const [rows] = await pool.query('SELECT * FROM Reservation WHERE id = ?', [id]);
  const reservation = rows[0];
  if (!reservation) return res.status(404).send('Reservation not found');
  let guest = null;
  if (reservation.guestId) {
    const [guests] = await pool.query('SELECT * FROM users WHERE id = ?', [reservation.guestId]);
    guest = guests[0] || null;
  }
  res.render('employee/edit_reservation', { reservation, guest, currentUser: req.session.user || null });
});

router.post('/reservations/:id/edit', requireRole('employee'), async (req, res) => {
  const id = req.params.id;
  const { siteId, guestName, guestEmail, checkIn, checkOut, rigLengthFt, type } = req.body;

  await pool.query(
    `
      UPDATE Reservation
      SET siteId = ?, guestName = ?, guestEmail = ?, checkIn = ?, checkOut = ?,
          rigLengthFt = ?, type = ?
      WHERE id = ?
    `,
    [siteId, guestName, guestEmail, checkIn, checkOut, rigLengthFt, type, id]
  );

  res.redirect('/employee/reservations');
});

/* ============================================================
   CANCEL RESERVATION
   ============================================================ */
router.post('/reservations/:id/cancel', requireRole('employee'), async (req, res) => {
  await pool.query('UPDATE Reservation SET status = "CANCELLED" WHERE id = ?', [
    req.params.id
  ]);
  res.redirect('/employee/reservations');
});

// Employee user management (older User table – likely unused, left for compatibility)

// List / manage sites (employee view)
// This handles GET /employee/sites because router is mounted at /employee
router.get('/sites', requireRole('employee'), async (req, res) => {
  try {
    const [sites] = await pool.query('SELECT * FROM Site ORDER BY number ASC');

    // Reuse admin sites view so UI stays consistent
    res.render('admin/sites', {
      sites,
      fromEmployee: true,
      currentUser: req.session.user || null,
    });
  } catch (err) {
    console.error('Error loading sites for employee:', err);
    res.status(500).send('Unable to load sites.');
  }
});

// Mark reservation as paid (cannot revert)
router.post('/reservations/:id/mark-paid', requireRole('employee'), async (req, res) => {
  const reservationId = Number(req.params.id);
  await pool.query('UPDATE Reservation SET paid = 1 WHERE id = ?', [reservationId]);
  res.redirect(`/employee/reservations/${reservationId}/edit`);
});

module.exports = router;
