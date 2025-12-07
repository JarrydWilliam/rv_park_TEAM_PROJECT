// server/src/routes/reservations.js

const express = require('express');
const pool = require('../db/pool');
const {
  toDate,
  nightsBetween,
  withinPeak,
  activeRateFor,
  stayTouchesSpecialEvent
} = require('../utils/policy');

const router = express.Router();

/**
 * GET /reservations/:id/edit
 * Render the edit reservation form.
 */
router.get('/reservations/:id/edit', async (req, res) => {
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
 * POST /reservations/:id/edit
 * Update reservation details and recalculate amount.
 */
router.post('/reservations/:id/edit', async (req, res) => {
  const id = Number(req.params.id);
  const { checkIn, checkOut, guestName, guestEmail, rigLengthFt } = req.body;

  // 0) Load existing reservation (for old amount + dates)
  const [existingRows] = await pool.query(
    'SELECT * FROM Reservation WHERE id = ? LIMIT 1',
    [id]
  );
  const existing = existingRows[0];

  if (!existing) {
    return res.status(404).send('Reservation not found.');
  }

  // Parse old dates & compute old amount
  const oldCheckIn = toDate(existing.checkIn);
  const oldCheckOut = toDate(existing.checkOut);
  const oldNights = nightsBetween(oldCheckIn, oldCheckOut);

  const nightlyRate = Number(existing.nightlyRate || 0);
  const oldAmount =
    nightlyRate > 0
      ? nightlyRate * oldNights
      : Number(existing.amountPaid || 0);

  // 1) Validate new dates
  const checkInDate = toDate(checkIn);
  const checkOutDate = toDate(checkOut);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  if (checkInDate < today) {
    return res.status(400).send('Check-in date cannot be before today.');
  }
  if (checkOutDate <= checkInDate) {
    return res.status(400).send('Check-out date must be after check-in date.');
  }

  const newNights = nightsBetween(checkInDate, checkOutDate);

  // 2) Recalculate new amount using same nightlyRate
  const newAmount = nightlyRate * newNights;

  // 3) Update reservation with new dates + new amountPaid
  await pool.query(
    `
      UPDATE Reservation
      SET checkIn = ?,
          checkOut = ?,
          guestName = ?,
          guestEmail = ?,
          rigLengthFt = ?,
          amountPaid = ?
      WHERE id = ?
    `,
    [checkInDate, checkOutDate, guestName, guestEmail, rigLengthFt, newAmount, id]
  );

  // 4) Compute difference for messaging (refund or extra charge)
  let adjustment = null;
  if (!isNaN(oldAmount) && !isNaN(newAmount) && nightlyRate > 0) {
    if (newAmount < oldAmount) {
      adjustment = {
        type: 'refund',
        amount: Number((oldAmount - newAmount).toFixed(2)),
      };
    } else if (newAmount > oldAmount) {
      adjustment = {
        type: 'additional',
        amount: Number((newAmount - oldAmount).toFixed(2)),
      };
    }
  }

  // 5) Reload updated reservation + site
  const [updatedRows] = await pool.query(
    'SELECT * FROM Reservation WHERE id = ? LIMIT 1',
    [id]
  );
  const r = updatedRows[0];

  const [siteRows] = await pool.query(
    'SELECT * FROM Site WHERE id = ? LIMIT 1',
    [r.siteId]
  );
  r.site = siteRows[0] || null;

  // 6) Render confirm view directly, with adjustment info
  res.render('confirm', { r, adjustment });
});

/**
 * GET /reserve/new
 */
router.get('/reserve/new', async (req, res) => {
  try {
    const { siteId, check_in, check_out, rig_length, type } = req.query;

    if (!siteId || !check_in || !check_out || !rig_length) {
      return res.status(400).send('Missing required reservation parameters.');
    }

    const siteIdNum = Number(siteId);
    const rigLengthNum = Number(rig_length);

    // Load the selected site (only active sites)
    const [siteRows] = await pool.query(
      'SELECT * FROM Site WHERE id = ? AND active = 1 LIMIT 1',
      [siteIdNum]
    );
    const site = siteRows[0];

    if (!site) {
      return res.status(404).send('Selected site not found or inactive.');
    }

    res.render('reserve', {
      site,
      query: {
        check_in,
        check_out,
        rig_length: rigLengthNum ? String(rigLengthNum) : '',
        type: type || ''
      }
    });
  } catch (e) {
    res.status(400).send(String(e));
  }
});

/**
 * POST /reserve
 */
router.post('/reserve', async (req, res) => {
  try {
    const {
      siteId,
      guestName,
      guestEmail,
      rigLengthFt,
      pcs,
      type // may be undefined, we'll default later
    } = req.body;

    const siteIdNum = Number(siteId);
    const rigLengthNum = Number(rigLengthFt);

    // Accept a few possible field names for dates
    const checkInRaw =
      req.body.checkIn || req.body.check_in || req.body.checkin;
    const checkOutRaw =
      req.body.checkOut || req.body.check_out || req.body.checkout;

    if (!siteIdNum || !checkInRaw || !checkOutRaw) {
      throw new Error('Missing site, check-in, or check-out.');
    }

    const checkInDate = toDate(checkInRaw);
    const checkOutDate = toDate(checkOutRaw);

    if (
      !(checkInDate instanceof Date) || isNaN(checkInDate.getTime()) ||
      !(checkOutDate instanceof Date) || isNaN(checkOutDate.getTime())
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

    const requestedType = type || site.type || '';

    // 2) Check rig length vs site length (extra safety)
    if (site.lengthFt < rigLengthNum) {
      throw new Error('Selected site is too short for the rig.');
    }

    // 3) Check for overlapping confirmed reservation on THIS site
    const [overlapRows] = await pool.query(
      `
        SELECT id
        FROM Reservation
        WHERE siteId = ?
          AND status = 'CONFIRMED'
          AND checkIn < ?
          AND checkOut > ?
        LIMIT 1
      `,
      [site.id, checkOutDate, checkInDate]
    );

    if (overlapRows.length > 0) {
      // HOTEL-STYLE BEHAVIOR:
      // Site is not available – find alternatives.

      const params = [];
      const whereClauses = ['s.active = 1'];

      // Exclude the original site we just tried to book
      whereClauses.push('s.id <> ?');
      params.push(site.id);

      // Rig length filter
      if (rigLengthNum && rigLengthNum > 0) {
        whereClauses.push('s.lengthFt >= ?');
        params.push(rigLengthNum);
      }

      // Type filter (keep same type if possible)
      if (requestedType) {
        whereClauses.push('s.type = ?');
        params.push(requestedType);
      }

      // NOT EXISTS overlapping reservations on alternative sites
      whereClauses.push(`
        NOT EXISTS (
          SELECT 1
          FROM Reservation r
          WHERE
            r.siteId = s.id
            AND r.status = 'CONFIRMED'
            AND r.checkIn < ?
            AND r.checkOut > ?
        )
      `);
      params.push(checkOutDate, checkInDate);

      const whereSql = `WHERE ${whereClauses.join(' AND ')}`;

      const [alternativeRows] = await pool.query(
        `
          SELECT
            s.id,
            s.number,
            s.type,
            s.lengthFt,
            s.description,
            s.active
          FROM Site s
          ${whereSql}
          ORDER BY s.lengthFt ASC
        `,
        params
      );

      return res.status(409).render('reserve_conflict', {
        site,
        checkIn: checkInRaw,
        checkOut: checkOutRaw,
        rigLengthFt: rigLengthNum,
        type: requestedType,
        alternatives: alternativeRows
      });
    }

    // 4) Business rules: nights, peak season, PCS flag
    const nightCount = nightsBetween(checkInDate, checkOutDate);
    const inPeak = withinPeak(checkInDate) || withinPeak(checkOutDate);
    const pcsFlag =
      pcs === 'on' ||
      pcs === 'true' ||
      pcs === true ||
      pcs === 1 ||
      pcs === '1';

    if (inPeak && !pcsFlag && nightCount > 14) {
      throw new Error('Peak season limit is 14 nights (PCS exempt).');
    }

    // 5) Rate lookup & total amount
    const nightlyRate = await activeRateFor(site.type, checkInDate);
    const amountPaid = nightlyRate * nightCount;

    // 6) Confirmation code
    const confirmationCode = Math.random().toString(36).slice(2, 10).toUpperCase();

    // 7) Insert reservation with guestId if available
    const guestId =
      req.session.user && req.session.user.id ? req.session.user.id : null;

    await pool.query(
      `
        INSERT INTO Reservation
          (siteId, guestName, guestEmail, rigLengthFt,
           checkIn, checkOut, pcs, confirmationCode,
           nightlyRate, amountPaid, status, guestId, paid)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED', ?, ?)
      `,
      [
        site.id,
        guestName,
        guestEmail,
        rigLengthNum,
        checkInDate,
        checkOutDate,
        pcsFlag ? 1 : 0,
        confirmationCode,
        nightlyRate,
        amountPaid,
        guestId,
        1 // paid = 1 for guest reservations
      ]
    );

    // 8) Get the newly created reservation's ID
    const [result] = await pool.query(
      'SELECT id FROM Reservation WHERE confirmationCode = ? LIMIT 1',
      [confirmationCode]
    );
    const reservationId = result[0]?.id;

    if (!reservationId) {
      return res
        .status(500)
        .send('Reservation created, but could not find reservation ID for payment.');
    }

    // Redirect to payment page
    res.redirect(`/payments/${reservationId}`);
  } catch (e) {
    res.status(400).send(String(e));
  }
});

/**
 * GET /confirm/:code
 */
router.get('/confirm/:code', async (req, res) => {
  const { code } = req.params;

  const [resRows] = await pool.query(
    'SELECT * FROM Reservation WHERE confirmationCode = ? LIMIT 1',
    [code]
  );
  const r = resRows[0];

  if (!r) {
    return res.status(404).send('Reservation not found.');
  }

  const [siteRows] = await pool.query(
    'SELECT * FROM Site WHERE id = ? LIMIT 1',
    [r.siteId]
  );
  r.site = siteRows[0] || null;

  res.render('confirm', { r });
});

/**
 * POST /reservations/:id/cancel
 */
router.post('/reservations/:id/cancel', async (req, res) => {
  const id = Number(req.params.id);

  const [resRows] = await pool.query(
    'SELECT * FROM Reservation WHERE id = ? LIMIT 1',
    [id]
  );
  const r = resRows[0];

  if (!r) {
    return res.status(404).send('Not found');
  }

  const [siteRows] = await pool.query(
    'SELECT * FROM Site WHERE id = ? LIMIT 1',
    [r.siteId]
  );
  r.site = siteRows[0] || null;

  if (r.status === 'CANCELLED') {
    return res.redirect(`/confirm/${r.confirmationCode}`);
  }

  const checkInDate = toDate(r.checkIn);
  const hoursBefore = (checkInDate.getTime() - Date.now()) / (1000 * 60 * 60);

  const isSpecial = await stayTouchesSpecialEvent(r.checkIn, r.checkOut);

  const oneNight = Number(r.nightlyRate || 30.0);
  let fee = 0;

  if (isSpecial) {
    fee = oneNight;
  } else if (hoursBefore <= 72) {
    fee = oneNight;
  } else {
    fee = 10.0;
  }

  await pool.query(
    'UPDATE Reservation SET status = ? WHERE id = ?',
    ['CANCELLED', id]
  );

  res.render('cancelled', { r, fee, oneNight });
});

module.exports = router;
