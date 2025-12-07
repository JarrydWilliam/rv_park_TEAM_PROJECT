
const express = require('express');
const pool = require('../db/pool');
const {
  toDate,
  nightsBetween,
  withinPeak,
  activeRateFor,
  stayTouchesSpecialEvent,
} = require('../utils/policy');
const { requireAuth, requireRole } = require('../middleware/auth');
const router = express.Router();

// Handle reservation edit (POST)
router.post('/:id/edit', async (req, res) => {
    // Debug logging for conflict detection (after id is defined)
    // We'll log after all variables are initialized, just before the conflict check
  const id = Number(req.params.id);
  // Accept all fields from reserve_conflict or edit form
  let { guestName, guestEmail, rigLengthFt, checkIn, checkOut, siteId: newSiteId } = req.body;
  const [existingRows] = await pool.query('SELECT * FROM Reservation WHERE id = ? LIMIT 1', [id]);
  const existing = existingRows[0];
  if (!existing) {
    return res.render('edit_reservation', { r: null, error: 'Reservation not found.' });
  }
  // Use POSTed values if present, otherwise fallback to existing
  guestName = guestName || existing.guestName;
  guestEmail = guestEmail || existing.guestEmail;
  rigLengthFt = rigLengthFt || existing.rigLengthFt;
  let siteId = newSiteId || existing.siteId;
  let siteChanged = false;
  // Only validate date strings, do not convert to JS Date for DB
  if (!checkIn || !/^\d{4}-\d{2}-\d{2}$/.test(checkIn)) {
    return res.render('edit_reservation', { r: existing, error: 'Invalid check-in date.' });
  }
  if (!checkOut || !/^\d{4}-\d{2}-\d{2}$/.test(checkOut)) {
    return res.render('edit_reservation', { r: existing, error: 'Invalid check-out date.' });
  }
  // For nightsBetween and logic, use Date objects, but save raw strings to DB
  const checkInDate = toDate(checkIn);
  const checkOutDate = toDate(checkOut);
  if (checkOutDate <= checkInDate) {
    return res.render('edit_reservation', { r: existing, error: 'Check-out date must be after check-in date.' });
  }
  const newNights = nightsBetween(checkInDate, checkOutDate);
  console.log('DEBUG: Edit reservation', {
    reservationId: id,
    siteId,
    checkIn,
    checkOut,
    checkInDate,
    checkOutDate
  });
  // Re-check availability (excluding this reservation)
  const [conflicts] = await pool.query(
    `SELECT id, siteId, checkIn, checkOut FROM Reservation WHERE siteId = ? AND id <> ? AND status = 'CONFIRMED' AND NOT (checkOut <= ? OR checkIn >= ?)`,
    [siteId, id, checkIn, checkOut]
  );
  console.log('DEBUG: Conflicts found:', conflicts);
  if (conflicts.length > 0) {
    // Find alternative available sites
    const [alternatives] = await pool.query(
      `SELECT s.* FROM Site s WHERE s.active = 1 AND s.lengthFt >= ? AND s.id NOT IN (
        SELECT siteId FROM Reservation WHERE status = 'CONFIRMED' AND NOT (checkOut <= ? OR checkIn >= ?)
      ) ORDER BY s.id ASC`,
      [rigLengthFt, checkIn, checkOut]
    );
    // Pass all required info to reserve_conflict for edit
    return res.render('reserve_conflict', {
      reservationId: id,
      site: { number: existing.siteNumber || existing.siteId },
      checkIn,
      checkOut,
      rigLengthFt,
      guestName,
      guestEmail,
      alternatives
    });
  }
  // Recalculate amount
  let nightlyRate = Number(existing.nightlyRate || 0);
  if (!nightlyRate || isNaN(nightlyRate)) {
    const rateObj = await activeRateFor(existing.type || 'STANDARD', checkInDate);
    nightlyRate = rateObj.nightlyRate || nightlyRate;
  }
  const newAmount = nightlyRate * newNights;
  // Update reservation (save raw date strings)
  await pool.query(
    `UPDATE Reservation SET siteId = ?, checkIn = ?, checkOut = ?, guestName = ?, guestEmail = ?, rigLengthFt = ?, amountPaid = ?, nightlyRate = ? WHERE id = ?`,
    [siteId, checkIn, checkOut, guestName, guestEmail, rigLengthFt, newAmount, nightlyRate, id]
  );
  // Reload updated reservation
  const [updatedRows] = await pool.query(
    `SELECT r.*, s.number AS siteNumber, s.lengthFt, s.type AS siteType FROM Reservation r JOIN Site s ON s.id = r.siteId WHERE r.id = ? LIMIT 1`,
    [id]
  );
  const r = updatedRows[0];
  res.render('confirm', { r, siteChanged });
});

// Edit reservation page
router.get('/:id/edit', async (req, res) => {
  const id = Number(req.params.id);
  const [resRows] = await pool.query('SELECT * FROM Reservation WHERE id = ? LIMIT 1', [id]);
  const r = resRows[0];
  if (!r) {
    return res.render('edit_reservation', { r: null, error: 'Reservation not found.' });
  }
  res.render('edit_reservation', { r });
});

// --- Place all your route handlers here, after router initialization ---

// Example: Delete reservation
router.post('/:id/delete', async (req, res) => {
  const id = Number(req.params.id);
  try {
    await pool.query('DELETE FROM Reservation WHERE id = ?', [id]);
    // Redirect to the guest's list of reservations after deletion
    res.redirect('/guest/my_reservations');
  } catch (e) {
    res.status(500).send('Failed to delete reservation.');
  }
});

// ...existing route handlers (GET/POST for reservations, confirm, etc.)...

/* ============================================================
   GET /reserve/new
   ============================================================ */
router.get('/reserve/new', async (req, res) => {
    // DEBUG: Log session user and role
    console.log('DEBUG /reserve/new session.user:', req.session.user);
  try {
    const { siteId, check_in, check_out, rig_length, type } = req.query;

    if (!siteId || !check_in || !check_out || !rig_length) {
      return res.render('reserve', { error: 'Missing required parameters.', site: null, query: {} });
    }

    const siteIdNum = Number(siteId);
    const rigLengthNum = Number(rig_length);

    const [siteRows] = await pool.query(
      'SELECT * FROM Site WHERE id = ? AND active = 1',
      [siteIdNum]
    );
    console.log('DEBUG /reserve/new siteRows:', siteRows);
    const site = siteRows[0];

    if (!site) {
      return res.render('reserve', { error: 'Site not found or inactive.', site: null, query: {} });
    }

    const checkInDate = toDate(check_in);
    const checkOutDate = toDate(check_out);
    const nights = nightsBetween(checkInDate, checkOutDate);

    if (nights <= 0) {
      return res.render('reserve', {
        error: 'Invalid date range.',
        site,
        query: req.body || {},
      });
    }

    if (rigLengthNum > site.lengthFt) {
      return res.render('reserve', {
        error: 'Rig is too long for this site.',
        site,
        query: req.body || {},
      });
    }

    if (!withinPeak(checkInDate, checkOutDate)) {
      return res.render('reserve', {
        error: 'Stays cannot exceed 14 nights within peak season.',
        site,
        query: req.body || {},
      });
    }

    // Only skip reserve.ejs for users with role 'customer'
    // Always show the reserve.ejs form for all users
    // Otherwise, show the reserve.ejs form
    const renderObj = {
      site,
      query: {
        check_in,
        check_out,
        rig_length: String(rigLengthNum),
        type: type || '',
      },
      guest: req.session.user || null,
      error: null,
    };
    console.log('DEBUG /reserve/new rendering with:', renderObj);
    res.render('reserve', renderObj);
  } catch (e) {
    res.render('reserve', { error: String(e), site: null, query: {} });
  }
});

/* ============================================================
   POST /reserve
   ============================================================ */
router.post('/reserve', async (req, res) => {
  try {
    let {
      siteId,
      guestName,
      guestEmail,
      rigLengthFt,
      pcs,
      checkIn,
      checkOut
    } = req.body;

    // If guestName or guestEmail are missing, use values from logged-in user
    if ((!guestName || !guestEmail) && req.session && req.session.user) {
      if (!guestName) guestName = req.session.user.name || req.session.user.username || '';
      if (!guestEmail) guestEmail = req.session.user.email || '';
    }

    // Validate guestName and guestEmail
    if (!guestName || !guestEmail) {
      return res.render('reserve', { error: 'Missing guest name or email.' });
    }

    // Validate siteId
    if (!siteId || isNaN(Number(siteId))) {
      return res.render('reserve', { error: 'Invalid or missing site selection.' });
    }
    if (!checkIn || !checkOut) {
      return res.render('reserve', { error: 'Missing check-in or check-out date.' });
    }
    const siteIdNum = Number(siteId);
    const rigLengthNum = Number(rigLengthFt);
    const checkInDate = toDate(checkIn);
    const checkOutDate = toDate(checkOut);

    // Check that site exists and is active
    const [siteRows] = await pool.query(
      'SELECT * FROM Site WHERE id = ? AND active = 1',
      [siteIdNum]
    );
    const site = siteRows[0];
    if (!site) {
      return res.render('reserve', { error: 'Site not found or inactive.' });
    }

    if (rigLengthNum > site.lengthFt) {
      return res.render('reserve', {
        error: 'Rig too long for this site.',
        site,
      });
    }

    if (!withinPeak(checkInDate, checkOutDate)) {
      return res.render('reserve', {
        error: 'Stays cannot exceed 14 nights during peak season.',
        site,
      });
    }

    // CONFLICT CHECK
    const [overlapRows] = await pool.query(
      `
      SELECT id
      FROM Reservation
      WHERE siteId = ?
        AND status = 'CONFIRMED'
        AND NOT (checkOut <= ? OR checkIn >= ?)
    `,
      [siteIdNum, checkIn, checkOut]
    );

    if (overlapRows.length > 0) {
      return res.render('reserve_conflict', {
        site,
        checkIn,
        checkOut,
        rigLengthFt: rigLengthNum,
        type: type || site.type,
        alternatives: [],
        error: 'Site is already reserved during that timeframe.',
      });
    }

    // PRICING
    const nights = nightsBetween(checkInDate, checkOutDate);
    const { nightlyRate } = await activeRateFor(siteIdNum, checkInDate);
    const totalAmount = nightlyRate * nights;

    const confirmationCode =
      'R' + Date.now().toString(36).toUpperCase();

    // CREATE RESERVATION (now includes guestId)
    const guestId = req.session && req.session.user ? req.session.user.id : null;
    const [result] = await pool.query(
      `
      INSERT INTO Reservation
        (siteId, guestId, guestName, guestEmail, checkIn, checkOut,
         rigLengthFt, nightlyRate, amountPaid, status, confirmationCode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `,
      [
        siteIdNum,
        guestId,
        guestName,
        guestEmail,
        checkIn,
        checkOut,
        rigLengthNum,
        nightlyRate,
        totalAmount,
        'CONFIRMED',
        confirmationCode
      ]
    );

    const reservationId = result.insertId;
    res.redirect(`/payments/${reservationId}`);
  } catch (e) {
    console.error('Error creating reservation:', e);
    res.render('reserve', { error: String(e) });
  }
});

/* ============================================================
   GET /confirm/:code
   ============================================================ */
router.get('/confirm/:code', async (req, res) => {
  const { code } = req.params;

  const [resRows] = await pool.query(
    `
      SELECT r.*, s.number AS siteNumber, s.lengthFt, s.type AS siteType
      FROM Reservation r
      JOIN Site s ON s.id = r.siteId
      WHERE r.confirmationCode = ?
    `,
    [code]
  );

  const r = resRows[0];

  if (!r) {
    return res.render('confirm', {
      r: null,
      error: 'Reservation not found for confirmation code.',
    });
  }

  res.render('confirm', { r });
});

/* ============================================================
   POST /reservations/:id/cancel
   ============================================================ */
router.post('/reservations/:id/cancel', requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  const [resRows] = await pool.query(
    `
      SELECT r.*, s.number AS siteNumber, s.type AS siteType
      FROM Reservation r
      JOIN Site s ON s.id = r.siteId
      WHERE r.id = ?
      LIMIT 1
    `,
    [id]
  );
  const r = resRows[0];

  if (!r) {
    return res.render('cancelled', { error: 'Reservation not found.' });
  }

  const checkInDate = toDate(r.checkIn);
  const now = new Date();
  const hoursBefore =
    (checkInDate.getTime() - now.getTime()) / (1000 * 60 * 60);

  const isSpecial = await stayTouchesSpecialEvent(r.checkIn, r.checkOut);

  const oneNight = Number(r.nightlyRate || 30.0);

  let fee = 10.0;
  if (hoursBefore <= 48 || isSpecial) {
    fee += oneNight;
  }

  const totalPaid = Number(r.amountPaid || 0);
  let refundAmount = Math.max(0, totalPaid - fee);

  if (refundAmount > 0) {
    const userId =
      req.session.user && req.session.user.id ? req.session.user.id : null;
    const txnId =
      'REF-' + Math.random().toString(36).substring(2, 10).toUpperCase();

    await pool.query(
      `
        INSERT INTO Payment
          (reservationId, userId, amount, paymentMethod, status, transactionId, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, NOW())
      `,
      [
        r.id,
        userId,
        -refundAmount,
        'Refund',
        'Completed',
        txnId,
        `Cancellation refund (fee ${fee.toFixed(2)})`,
      ]
    );
  }

  await pool.query('UPDATE Reservation SET status = ? WHERE id = ?', [
    'CANCELLED',
    id,
  ]);

  res.render('cancelled', { r, fee, oneNight });
});

module.exports = router;
