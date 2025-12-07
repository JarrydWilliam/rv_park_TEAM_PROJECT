// server/src/routes/reservations.js

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

/**
 * GET /reservations/:id/edit
 * Render the edit reservation form.
 */
router.get('/reservations/:id/edit', requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  const [resRows] = await pool.query(
    'SELECT * FROM Reservation WHERE id = ? LIMIT 1',
    [id]
  );
  const r = resRows[0];

  if (!r) {
    return res.status(404).send('Reservation not found.');
  }

  res.render('edit_reservation', { r });
});

/**
 * GET /employee/reservations/find
 * Employee tool: enter confirmation code, redirect to the edit page.
 */
router.get(
  '/employee/reservations/find',
  requireRole('employee'),
  async (req, res) => {
    const { code } = req.query;

    if (!code) {
      return res.status(400).send('Confirmation code is required.');
    }

    const [rows] = await pool.query(
      'SELECT id FROM Reservation WHERE confirmationCode = ? LIMIT 1',
      [code]
    );
    const r = rows[0];

    if (!r) {
      return res
        .status(404)
        .send('No reservation found for that confirmation code.');
    }

    // Redirect employee to the existing edit page for that reservation ID
    res.redirect(`/reservations/${r.id}/edit`);
  }
);

/**
 * POST /reservations/:id/edit
 * Update reservation details, re-check availability, and recalculate amount.
 */
router.post('/reservations/:id/edit', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { checkIn, checkOut, guestName, guestEmail, rigLengthFt } = req.body;

  // 0) Load existing reservation (for site + old amount + nightlyRate)
  const [existingRows] = await pool.query(
    'SELECT * FROM Reservation WHERE id = ? LIMIT 1',
    [id]
  );
  const existing = existingRows[0];

  if (!existing) {
    return res.status(404).send('Reservation not found.');
  }

  const siteId = existing.siteId;

  // Parse old dates & compute old amount
  const oldCheckIn = toDate(existing.checkIn);
  const oldCheckOut = toDate(existing.checkOut);
  const oldNights = nightsBetween(oldCheckIn, oldCheckOut);

  let nightlyRate = Number(existing.nightlyRate || 0);

  // If nightlyRate is somehow 0 in DB, fall back to a lookup so math still works
  if (!nightlyRate || isNaN(nightlyRate)) {
    nightlyRate = await activeRateFor(
      existing.type || existing.siteType || 'STANDARD',
      oldCheckIn
    );
  }

  const oldAmount =
    nightlyRate > 0 ? nightlyRate * oldNights : Number(existing.amountPaid || 0);

  // 1) Validate new dates
  const checkInDate = toDate(checkIn);
  const checkOutDate = toDate(checkOut);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (!(checkInDate instanceof Date) || isNaN(checkInDate.getTime())) {
    return res.status(400).send('Invalid check-in date.');
  }
  if (!(checkOutDate instanceof Date) || isNaN(checkOutDate.getTime())) {
    return res.status(400).send('Invalid check-out date.');
  }
  if (checkInDate < today) {
    return res.status(400).send('Check-in date cannot be before today.');
  }
  if (checkOutDate <= checkInDate) {
    return res
      .status(400)
      .send('Check-out date must be after check-in date.');
  }

  const newNights = nightsBetween(checkInDate, checkOutDate);

  // 2) Re-check availability for this site for the new dates
  const [conflicts] = await pool.query(
    `SELECT id
     FROM Reservation
     WHERE siteId = ?
       AND id <> ?
       AND status = 'CONFIRMED'
       AND NOT (checkOut <= ? OR checkIn >= ?)`,
    [siteId, id, checkInDate, checkOutDate]
  );

  if (conflicts.length > 0) {
    return res
      .status(409)
      .send(
        'Site is no longer available for those dates. Please choose different dates.'
      );
  }

  // 3) Recalculate new amount using the same nightlyRate
  const newAmount = nightlyRate * newNights;

    // 4) Update reservation with new dates + new amountPaid + nightlyRate
  await pool.query(
    `
      UPDATE Reservation
      SET checkIn = ?,
          checkOut = ?,
          guestName = ?,
          guestEmail = ?,
          rigLengthFt = ?,
          amountPaid = ?,
          nightlyRate = ?
      WHERE id = ?
    `,
    [
      checkInDate,
      checkOutDate,
      guestName,
      guestEmail,
      rigLengthFt,
      newAmount,
      nightlyRate,
      id,
    ]
  );


  // 5) Optional: record adjustment in Payment table (refund or additional charge)
  let adjustment = null;
  if (!isNaN(oldAmount) && !isNaN(newAmount) && nightlyRate > 0) {
    const diff = Number((newAmount - oldAmount).toFixed(2));
    if (diff < 0) {
      adjustment = {
        type: 'refund',
        amount: Math.abs(diff),
      };
    } else if (diff > 0) {
      adjustment = {
        type: 'additional',
        amount: diff,
      };
    }

    if (adjustment) {
      const userId =
        req.session.user && req.session.user.id ? req.session.user.id : null;
      const txnId =
        'ADJ-' + Math.random().toString(36).substring(2, 10).toUpperCase();

      await pool.query(
  `
    INSERT INTO Payment
      (reservationId, userId, amount, paymentMethod, status, transactionId, createdAt)
    VALUES (?, ?, ?, ?, ?, ?, NOW())
  `,
  [
    id,
    userId,
    adjustment.type === 'refund'
      ? -adjustment.amount   // negative = refund
      : adjustment.amount,   // positive = extra charge
    'Adjustment',
    'Completed',            
    txnId
  ]
);


    }
  }

  // 6) Reload updated reservation for confirmation view
  const [updatedRows] = await pool.query(
    `
      SELECT r.*, s.number AS siteNumber, s.lengthFt, s.type AS siteType
      FROM Reservation r
      JOIN Site s ON s.id = r.siteId
      WHERE r.id = ?
      LIMIT 1
    `,
    [id]
  );
  const r = updatedRows[0];

  if (!r) {
    return res.status(404).send('Reservation not found after update.');
  }

  res.render('confirm', { r, adjustment });
});

/**
 * GET /reserve/new
 *
 * Called when the user is coming from the search page:
 *  - They clicked "Reserve" on a specific site.
 *  - We load that site and show a reservation form for those dates.
 *
 * Query params expected:
 *  - siteId
 *  - check_in (yyyy-MM-dd)
 *  - check_out (yyyy-MM-dd)
 *  - rig_length
 *  - type (optional, mostly for display)
 */
router.get('/reserve/new', requireAuth, async (req, res) => {
  try {
    const { siteId, check_in, check_out, rig_length, type } = req.query;

    if (!siteId || !check_in || !check_out || !rig_length) {
      return res
        .status(400)
        .send('Missing required reservation parameters.');
    }

    const siteIdNum = Number(siteId);
    const rigLengthNum = Number(rig_length);

    if (Number.isNaN(siteIdNum) || Number.isNaN(rigLengthNum)) {
      return res.status(400).send('Invalid site or rig length.');
    }

    // Load site
    const [siteRows] = await pool.query(
      'SELECT * FROM Site WHERE id = ? AND active = 1',
      [siteIdNum]
    );
    const site = siteRows[0];

    if (!site) {
      return res.status(404).send('Site not found or inactive.');
    }

    // Validate date range
    const checkInDate = toDate(check_in);
    const checkOutDate = toDate(check_out);
    const nights = nightsBetween(checkInDate, checkOutDate);

    if (
      !(checkInDate instanceof Date) ||
      isNaN(checkInDate.getTime()) ||
      !(checkOutDate instanceof Date) ||
      isNaN(checkOutDate.getTime()) ||
      nights <= 0
    ) {
      return res.status(400).send('Invalid check-in or check-out date.');
    }

    // Check rig length vs site
    if (rigLengthNum > site.lengthFt) {
      return res.status(400).send('Rig is too long for this site.');
    }

    // Check peak rules
    const peaksOk = withinPeak(checkInDate, checkOutDate);
    if (!peaksOk) {
      return res
        .status(400)
        .send('Stays cannot exceed 14 nights within peak windows.');
    }

    // Render reservation form
    res.render('reserve', {
      site,
      query: {
        check_in,
        check_out,
        rig_length: rigLengthNum ? String(rigLengthNum) : '',
        type: type || '',
      },
    });
  } catch (e) {
    res.status(400).send(String(e));
  }
});

/**
 * POST /reserve
 */
router.post('/reserve', requireAuth, async (req, res) => {
  try {
    const {
      siteId,
      guestName,
      guestEmail,
      rigLengthFt,
      pcs,
      type, // may be undefined, we'll default later
    } = req.body;

    const siteIdNum = Number(siteId);
    const rigLengthNum = Number(rigLengthFt);

    if (!siteId || !guestName || !guestEmail || !rigLengthFt || !pcs) {
      throw new Error('Missing required fields.');
    }

    if (Number.isNaN(siteIdNum) || Number.isNaN(rigLengthNum)) {
      throw new Error('Invalid site or rig length.');
    }

    const { checkIn, checkOut } = pcs;
    const checkInDate = toDate(checkIn);
    const checkOutDate = toDate(checkOut);

    if (
      !(checkInDate instanceof Date) ||
      isNaN(checkInDate.getTime()) ||
      !(checkOutDate instanceof Date) ||
      isNaN(checkOutDate.getTime())
    ) {
      throw new Error('Invalid check-in or check-out date.');
    }

    // 1) Fetch site
    const [siteRows] = await pool.query(
      'SELECT * FROM Site WHERE id = ? AND active = 1',
      [siteIdNum]
    );
    const site = siteRows[0];

    if (!site) {
      throw new Error('Site not found or inactive.');
    }

    // 2) Check rig vs site length
    if (rigLengthNum > site.lengthFt) {
      throw new Error('Rig is too long for this site.');
    }

    // 3) Check peak rules
    const peaksOk = withinPeak(checkInDate, checkOutDate);
    if (!peaksOk) {
      throw new Error('Stays cannot exceed 14 nights within peak windows.');
    }

    // 4) Ensure no overlapping CONFIRMED reservation for that site
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
      // conflict – show alternatives for the same dates
      const [altSites] = await pool.query(
        `
         SELECT s.*
         FROM Site s
         WHERE s.active = 1
           AND s.lengthFt >= ?
           AND NOT EXISTS (
             SELECT 1 FROM Reservation r
             WHERE r.siteId = s.id
               AND r.status = 'CONFIRMED'
               AND NOT (r.checkOut <= ? OR r.checkIn >= ?)
           )
        `,
        [rigLengthNum, checkIn, checkOut]
      );

      return res.status(409).render('reserve_conflict', {
        site,
        checkIn,
        checkOut,
        rigLengthFt: rigLengthNum,
        type: type || site.type,
        alternatives: altSites,
      });
    }

    // 5) Get active rate
    const { nightlyRate } = await activeRateFor(
      siteIdNum,
      checkInDate,
      checkOutDate
    );
    const nights = nightsBetween(checkInDate, checkOutDate);
    const totalAmount = nightlyRate * nights;

    // 6) Insert reservation
    const confirmationCode =
      'R' + Date.now().toString(36).toUpperCase();
    const [result] = await pool.query(
      `
       INSERT INTO Reservation
         (siteId, guestName, guestEmail, checkIn, checkOut, nights,
          rigLengthFt, type, nightlyRate, amountPaid, status, confirmationCode)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?)
      `,
      [
        siteIdNum,
        guestName,
        guestEmail,
        checkIn,
        checkOut,
        nights,
        rigLengthNum,
        type || site.type,
        nightlyRate,
        totalAmount,
        confirmationCode,
      ]
    );

    const reservationId = result.insertId;
    res.redirect(`/payments/${reservationId}`);
  } catch (e) {
    console.error('Error creating reservation:', e);
    res.status(400).send(String(e));
  }
});

/**
 * GET /confirm/:code
 */
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
    return res
      .status(404)
      .send('Reservation not found for this confirmation code.');
  }

  res.render('confirm', { r });
});

/**
 * POST /reservations/:id/cancel
 */
router.post('/reservations/:id/cancel', requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  // 1) Fetch reservation and its site
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
    return res.status(404).send('Reservation not found.');
  }

  const checkInDate = toDate(r.checkIn);
  const now = new Date();
  const hoursBefore =
    (checkInDate.getTime() - now.getTime()) / (1000 * 60 * 60);

  // 2) Determine if this stay touches a special event
  const isSpecial = await stayTouchesSpecialEvent(r.checkIn, r.checkOut);

  // 3) Fee logic: always $10 admin fee, plus one night if within 48 hours OR special event
  const oneNight = Number(r.nightlyRate || 30.0);

  let fee = 10.0; // base admin fee
  if (hoursBefore <= 48 || isSpecial) {
    fee += oneNight;
  }

  const totalPaid = Number(r.amountPaid || 0);
  let refundAmount = 0;

  if (totalPaid > 0) {
    refundAmount = Math.max(0, totalPaid - fee);
  }

  // 4) Record refund/fee in Payment table (negative amount for refund)
  if (refundAmount > 0) {
    const userId =
      req.session.user && req.session.user.id ? req.session.user.id : null;
    const txnId =
      'REF-' + Math.random().toString(36).substring(2, 10).toUpperCase();

    await pool.query(
      `
        INSERT INTO Payment
          (reservationId, userId, amount, paymentMethod, status, transactionId, createdAt)
        VALUES (?, ?, ?, ?, ?, ?, ?, NOW())
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

  // 5) Mark reservation as cancelled
  await pool.query('UPDATE Reservation SET status = ? WHERE id = ?', [
    'CANCELLED',
    id,
  ]);

  res.render('cancelled', { r, fee, oneNight });
});

module.exports = router;
