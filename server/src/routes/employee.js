// server/src/routes/employee.js
const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireRole } = require('../middleware/auth');

// Select an existing customer to make a reservation for
router.get('/reservations/select-customer', requireRole('employee'), async (req, res) => {
  const [customers] = await pool.query(
    "SELECT id, first_name, last_name, email, username FROM users WHERE role = 'customer'"
  );
  res.render('employee/select_customer', {
    customers,
    currentUser: req.session.user || null,
  });
});

// Create a new customer (employee-created)
router.get('/users/new', requireRole('employee'), (req, res) => {
  res.render('employee/user_form', {
    user: null,
    currentUser: req.session.user || null,
  });
});

router.post('/users/new', requireRole('employee'), async (req, res) => {
  const {
    username,
    email,
    firstName,
    lastName,
    password,
    dodAffiliation,
    branch,
    rank,
    numAdults,
    numPets,
    petBreedNotes,
  } = req.body;

  const crypto = require('crypto');
  function hashPassword(password) {
    return crypto.createHash('sha256').update(password).digest('hex');
  }
  const password_hash = hashPassword(password);

  const [result] = await pool.query(
    `
      INSERT INTO users (
        username, email, first_name, last_name, password_hash, role,
        dod_affiliation, branch, rank_grade, num_adults, num_pets, pet_breed_notes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      username,
      email,
      firstName,
      lastName,
      password_hash,
      'customer',
      dodAffiliation,
      branch,
      rank,
      numAdults,
      numPets,
      petBreedNotes,
    ]
  );
  const userId = result.insertId;
  res.redirect(`/employee/reservations/new?userId=${userId}`);
});

// Employee: Reservation form for created customer (reservation_form.ejs)
router.get('/reservations/new', requireRole('employee'), async (req, res) => {
  const userId = req.query.userId;
  let guest = null;

  if (userId) {
    const [guests] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
    guest = guests[0] || null;
  }

  const { checkIn, checkOut, rigLengthFt } = req.query;
  let availableSites = [];
  let error = null;

  if (checkIn && checkOut && rigLengthFt) {
    const today = new Date();
    const checkInDate = new Date(checkIn);
    const checkOutDate = new Date(checkOut);

    if (checkInDate < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
      error = 'Check-in date cannot be in the past.';
    } else if (checkOutDate <= checkInDate) {
      error = 'Check-out date must be after check-in date.';
    } else {
      // Find all sites not reserved for any overlapping dates
      const [sites] = await pool.query(
        `
          SELECT * FROM Site
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
    userId,
    guest,
    checkIn,
    checkOut,
    rigLengthFt,
    availableSites,
    error,
    currentUser: req.session.user || null,
  });
});

router.post('/reservations/new', requireRole('employee'), async (req, res) => {
  const { siteId, checkIn, checkOut, rigLengthFt, userId } = req.body;

  const today = new Date();
  const checkInDate = new Date(checkIn);
  if (checkInDate < new Date(today.getFullYear(), today.getMonth(), today.getDate())) {
    return res.status(400).send('Check-in date cannot be in the past.');
  }

  const checkOutDate = new Date(checkOut);
  if (checkOutDate <= checkInDate) {
    return res.status(400).send('Check-out date must be after check-in date.');
  }

  const [guests] = await pool.query('SELECT * FROM users WHERE id = ?', [userId]);
  const guest = guests[0];
  if (!guest) return res.status(400).send('Guest not found');

  const [conflicts] = await pool.query(
    `
      SELECT *
      FROM Reservation
      WHERE siteId = ?
        AND NOT (checkOut <= ? OR checkIn >= ?)
    `,
    [siteId, checkIn, checkOut]
  );
  if (conflicts.length > 0) {
    return res.status(400).send('Site is already reserved for those dates.');
  }

  function generateConfirmationCode(length = 8) {
    return Math.random().toString(36).substring(2, 2 + length).toUpperCase();
  }
  const confirmationCode = generateConfirmationCode();

  const [result] = await pool.query(
    `
      INSERT INTO Reservation
        (siteId, guestId, guestName, guestEmail, checkIn, checkOut,
         rigLengthFt, confirmationCode, status, paid)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [
      siteId,
      userId,
      `${guest.first_name} ${guest.last_name}`,
      guest.email,
      checkIn,
      checkOut,
      rigLengthFt,
      confirmationCode,
      'CONFIRMED',
      0,
    ]
  );

  const reservationId = result.insertId;
  res.redirect(`/employee/reservations/${reservationId}/payment`);
});

// Employee: Payment form for reservation (payment_form.ejs)
router.get('/reservations/:id/payment', requireRole('employee'), async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM Reservation WHERE id = ?', [
    req.params.id,
  ]);
  const reservation = rows[0];
  if (!reservation) return res.status(404).send('Reservation not found');

  const { nightsBetween, activeRateFor } = require('../utils/policy');
  let totalAmount = 0;

  if (reservation) {
    const nights = nightsBetween(reservation.checkIn, reservation.checkOut);
    const [siteRows] = await pool.query('SELECT * FROM Site WHERE id = ?', [
      reservation.siteId,
    ]);
    const site = siteRows[0];
    let nightlyRate = 30.0;
    if (site) {
      // activeRateFor accepts (siteType, date) in your current policy.js
      nightlyRate = await activeRateFor(site.type, reservation.checkIn);
    }
    totalAmount = nightlyRate * nights;
  }

  res.render('employee/payment_form', {
    reservation,
    totalAmount,
    currentUser: req.session.user || null,
  });
});

// Employee: Record manual payment + write Payment transaction
router.post('/reservations/:id/payment', requireRole('employee'), async (req, res) => {
  const { amountPaid, paymentMethod, paymentStatus } = req.body;
  const paid = paymentStatus === 'taken' ? 1 : 0;
  const reservationId = Number(req.params.id);

  // Update Reservation
  await pool.query(
    `
      UPDATE Reservation
      SET amountPaid = ?, paymentMethod = ?, paid = ?
      WHERE id = ?
    `,
    [amountPaid, paymentMethod, paid, reservationId]
  );

  // Insert Payment record
  const userId = req.session.user && req.session.user.id ? req.session.user.id : null;
  const txnId = 'MAN-' + Math.random().toString(36).substring(2, 10).toUpperCase();

  await pool.query(
    `
      INSERT INTO Payment
        (reservationId, userId, amount, paymentMethod, status, transactionId, notes, createdAt)
      VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
    `,
    [
      reservationId,
      userId,
      Number(amountPaid) || 0,
      paymentMethod || 'Manual',
      paid ? 'Completed' : 'Pending',
      txnId,
      'Manual payment taken by employee',
    ]
  );

  res.redirect('/employee/reservations');
});

// GET /employee/walkin_reports
router.get('/walkin_reports', requireRole('employee'), async (req, res) => {
  const [sites] = await pool.query('SELECT * FROM Site WHERE active = 1');

  const availableSites = await Promise.all(
    sites.map(async (site) => {
      const [[nextRes]] = await pool.query(
        `
          SELECT checkIn
          FROM Reservation
          WHERE siteId = ?
            AND checkIn > CURDATE()
          ORDER BY checkIn ASC
          LIMIT 1
        `,
        [site.id]
      );

      let availableUntil = null;
      let durationDays = null;

      if (nextRes && nextRes.checkIn) {
        availableUntil = nextRes.checkIn;
        const today = new Date();
        const nextDate = new Date(nextRes.checkIn);
        durationDays = Math.max(
          0,
          Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24))
        );
      }

      return {
        number: site.number,
        type: site.type,
        lengthFt: site.lengthFt,
        availableUntil,
        durationDays,
      };
    })
  );

  res.render('employee/walkin_reports', {
    availableSites,
    currentUser: req.session.user || null,
  });
});

// List all reservations in employee view
router.get('/reservations', requireRole('employee'), async (req, res) => {
  const [reservations] = await pool.query(
    `
      SELECT r.*, s.number AS siteNumber
      FROM Reservation r
      LEFT JOIN Site s ON r.siteId = s.id
    `
  );
  res.render('employee/reservations', {
    reservations,
    currentUser: req.session.user || null,
  });
});

// (Legacy) Simple reservation creation – left in place in case templates depend on it
router.get('/reservations/new', requireRole('employee'), async (req, res) => {
  const [sites] = await pool.query('SELECT * FROM Site WHERE active = 1');
  res.render('employee/reservation_form', { reservation: null, sites });
});

router.post('/reservations/new', requireRole('employee'), async (req, res) => {
  const { siteId, guestName, guestEmail, checkIn, checkOut, rigLengthFt, type } = req.body;
  await pool.query(
    `
      INSERT INTO Reservation
        (siteId, guestName, guestEmail, checkIn, checkOut, rigLengthFt, type, status)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `,
    [siteId, guestName, guestEmail, checkIn, checkOut, rigLengthFt, type, 'CONFIRMED']
  );
  res.redirect('/employee/reservations');
});

// Edit reservation (basic employee flow)
router.get('/reservations/:id/edit', requireRole('employee'), async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM Reservation WHERE id = ?', [
    req.params.id,
  ]);
  const reservation = rows[0];
  if (!reservation) return res.status(404).send('Reservation not found');

  const [sites] = await pool.query('SELECT * FROM Site WHERE active = 1');
  res.render('employee/reservation_form', { reservation, sites });
});

router.post('/reservations/:id/edit', requireRole('employee'), async (req, res) => {
  const { siteId, guestName, guestEmail, checkIn, checkOut, rigLengthFt, type } = req.body;
  await pool.query(
    `
      UPDATE Reservation
      SET siteId = ?, guestName = ?, guestEmail = ?, checkIn = ?, checkOut = ?,
          rigLengthFt = ?, type = ?
      WHERE id = ?
    `,
    [siteId, guestName, guestEmail, checkIn, checkOut, rigLengthFt, type, req.params.id]
  );
  res.redirect('/employee/reservations');
});

// Cancel reservation from employee side
router.post('/reservations/:id/cancel', requireRole('employee'), async (req, res) => {
  await pool.query('UPDATE Reservation SET status = ? WHERE id = ?', [
    'CANCELLED',
    req.params.id,
  ]);
  res.redirect('/employee/reservations');
});

// Employee user management (older User table – likely unused, left for compatibility)
router.get('/users', requireRole('employee'), async (req, res) => {
  const [users] = await pool.query('SELECT * FROM User');
  res.render('employee/users', { users });
});

router.get('/users/new', requireRole('employee'), (req, res) => {
  res.render('employee/user_form', { user: null });
});

router.post('/users/new', requireRole('employee'), async (req, res) => {
  const { username, email, role, password } = req.body;
  await pool.query(
    'INSERT INTO User (username, email, role, password) VALUES (?, ?, ?, ?)',
    [username, email, role, password]
  );
  res.redirect('/employee/users');
});

router.get('/users/:id/edit', requireRole('employee'), async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM User WHERE id = ?', [req.params.id]);
  const user = rows[0];
  if (!user) return res.status(404).send('User not found');
  res.render('employee/user_form', { user });
});

router.post('/users/:id/edit', requireRole('employee'), async (req, res) => {
  const { username, email, role } = req.body;
  await pool.query(
    'UPDATE User SET username = ?, email = ?, role = ? WHERE id = ?',
    [username, email, role, req.params.id]
  );
  res.redirect('/employee/users');
});

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

module.exports = router;
