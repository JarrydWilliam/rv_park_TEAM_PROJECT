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

/* ============================================================
   GET /reservations/:id/edit
   ============================================================ */
router.get('/reservations/:id/edit', requireAuth, async (req, res) => {
  const id = Number(req.params.id);

  const [resRows] = await pool.query(
    'SELECT * FROM Reservation WHERE id = ? LIMIT 1',
    [id]
  );
  const r = resRows[0];

  if (!r) {
    return res.render('edit_reservation', {
      r: null,
      error: 'Reservation not found.',
    });
  }

  res.render('edit_reservation', { r });
});

/* ============================================================
   EMPLOYEE FIND BY CONFIRMATION CODE
   ============================================================ */
router.get(
  '/employee/reservations/find',
  requireRole('employee'),
  async (req, res) => {
    const { code } = req.query;

    if (!code) {
      return res.render('employee/reservation_form', {
        error: 'Confirmation code is required.',
      });
    }

    const [rows] = await pool.query(
      'SELECT id FROM Reservation WHERE confirmationCode = ? LIMIT 1',
      [code]
    );
    const r = rows[0];

    if (!r) {
      return res.render('employee/reservation_form', {
        error: 'No reservation found under that confirmation code.',
      });
    }

    res.redirect(`/reservations/${r.id}/edit`);
  }
);

/* ============================================================
   POST /reservations/:id/edit
   ============================================================ */
router.post('/reservations/:id/edit', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { checkIn, checkOut, guestName, guestEmail, rigLengthFt } = req.body;

  const [existingRows] = await pool.query(
    'SELECT * FROM Reservation WHERE id = ? LIMIT 1',
    [id]
  );
  const existing = existingRows[0];

  if (!existing) {
    return res.render('edit_reservation', {
      r: null,
      error: 'Reservation not found.',
    });
  }

  const siteId = existing.siteId;

  const checkInDate = toDate(checkIn);
  const checkOutDate = toDate(checkOut);

  if (!checkInDate || isNaN(checkInDate.getTime())) {
    return res.render('edit_reservation', {
      r: existing,
      error: 'Invalid check-in date.',
    });
  }
  if (!checkOutDate || isNaN(checkOutDate.getTime())) {
    return res.render('edit_reservation', {
      r: existing,
      error: 'Invalid check-out date.',
    });
  }
  if (checkOutDate <= checkInDate) {
    return res.render('edit_reservation', {
      r: existing,
      error: 'Check-out date must be after check-in date.',
    });
  }

  const newNights = nightsBetween(checkInDate, checkOutDate);

  // Re-check availability (excluding this reservation)
  const [conflicts] = await pool.query(
    `
    SELECT id FROM Reservation
    WHERE siteId = ?
      AND id <> ?
      AND status = 'CONFIRMED'
      AND NOT (checkOut <= ? OR checkIn >= ?)
  `,
    [siteId, id, checkInDate, checkOutDate]
  );

  if (conflicts.length > 0) {
    return res.render('edit_reservation', {
      r: existing,
      error: 'Site is no longer available for those dates.',
    });
  }

  // Recalculate amount
  const oldAmount = Number(existing.amountPaid || 0);

  let nightlyRate = Number(existing.nightlyRate || 0);
  if (!nightlyRate || isNaN(nightlyRate)) {
    const rateObj = await activeRateFor(existing.type || 'STANDARD', checkInDate);
    nightlyRate = rateObj.nightlyRate || nightlyRate;
  }

  const newAmount = nightlyRate * newNights;

  // Update reservation (clean final merged version)
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

  /* ============================================================
     OPTIONAL – RECORD ADJUSTMENT (REFUND OR ADDITIONAL CHARGE)
     ============================================================ */
  let adjustment = null;

  if (!isNaN(oldAmount) && !isNaN(newAmount) && nightlyRate > 0) {
    const diff = Number((newAmount - oldAmount).toFixed(2));

    if (diff < 0) {
      adjustment = { type: 'refund', amount: Math.abs(diff) };
    } else if (diff > 0) {
      adjustment = { type: 'additional', amount: diff };
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
          adjustment.type === 'refund' ? -adjustment.amount : adjustment.amount,
          'Adjustment',
          'Completed',
          txnId,
        ]
      );
    }
  }

  // Reload updated reservation
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
  res.render('confirm', { r, adjustment });
});

/* ============================================================
   GET /reserve/new
   ============================================================ */
router.get('/reserve/new', requireAuth, async (req, res) => {
  try {
    const { siteId, check_in, check_out, rig_length, type } = req.query;

    if (!siteId || !check_in || !check_out || !rig_length) {
      return res.render('reserve', { error: 'Missing required parameters.' });
    }

    const siteIdNum = Number(siteId);
    const rigLengthNum = Number(rig_length);

    const [siteRows] = await pool.query(
      'SELECT * FROM Site WHERE id = ? AND active = 1',
      [siteIdNum]
    );
    const site = siteRows[0];

    if (!site) {
      return res.render('reserve', { error: 'Site not found or inactive.' });
    }

    const checkInDate = toDate(check_in);
    const checkOutDate = toDate(check_out);
    const nights = nightsBetween(checkInDate, checkOutDate);

    if (nights <= 0) {
      return res.render('reserve', {
        error: 'Invalid date range.',
        site,
      });
    }

    if (rigLengthNum > site.lengthFt) {
      return res.render('reserve', {
        error: 'Rig is too long for this site.',
        site,
      });
    }

    if (!withinPeak(checkInDate, checkOutDate)) {
      return res.render('reserve', {
        error: 'Stays cannot exceed 14 nights within peak season.',
        site,
      });
    }

    res.render('reserve', {
      site,
      query: {
        check_in,
        check_out,
        rig_length: String(rigLengthNum),
        type: type || '',
      },
      error: null,
    });
  } catch (e) {
    res.render('reserve', { error: String(e) });
  }
});

/* ============================================================
   POST /reserve
   ============================================================ */
router.post('/reserve', requireAuth, async (req, res) => {
  try {
    const {
      siteId,
      guestName,
      guestEmail,
      rigLengthFt,
      pcs,
      type,
    } = req.body;

    const siteIdNum = Number(siteId);
    const rigLengthNum = Number(rigLengthFt);

    const { checkIn, checkOut } = pcs;
    const checkInDate = toDate(checkIn);
    const checkOutDate = toDate(checkOut);

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

    // CREATE RESERVATION (no nights column)
    const [result] = await pool.query(
      `
      INSERT INTO Reservation
        (siteId, guestName, guestEmail, checkIn, checkOut,
         rigLengthFt, type, nightlyRate, amountPaid, status, confirmationCode)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?)
    `,
      [
        siteIdNum,
        guestName,
        guestEmail,
        checkIn,
        checkOut,
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
