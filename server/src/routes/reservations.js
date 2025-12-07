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
const { requireAuth } = require('../middleware/auth');

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
 * POST /reservations/:id/edit
 * Update reservation details and recalculate amount based on existing nightlyRate.
 * Keeps the same nightlyRate, but adjusts amountPaid and shows any refund / extra owed.
 */
router.post('/reservations/:id/edit', requireAuth, async (req, res) => {
  const id = Number(req.params.id);
  const { checkIn, checkOut, guestName, guestEmail, rigLengthFt } = req.body;

  // 0) Load existing reservation
  const [existingRows] = await pool.query(
    'SELECT * FROM Reservation WHERE id = ? LIMIT 1',
    [id]
  );
  const existing = existingRows[0];

  if (!existing) {
    return res.status(404).send('Reservation not found.');
  }

  // Old dates + amount
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
    return res.status(400).send('Check-out must be after check-in.');
  }

  const newNights = nightsBetween(checkInDate, checkOutDate);
  if (newNights <= 0) {
    return res.status(400).send('Invalid nights count.');
  }

  // 2) Recalculate new amount using same nightlyRate
  const newAmount = nightlyRate * newNights;

  // 3) Update reservation
  await pool.query(
    `
      UPDATE Reservation
      SET checkIn = ?,
          checkOut = ?,
          guestName = ?,
          guestEmail = ?,
          rigLengthFt = ?,
          nightlyRate = ?,
          amountPaid = ?
      WHERE id = ?
    `,
    [
      checkInDate,
      checkOutDate,
      guestName,
      guestEmail,
      rigLengthFt,
      nightlyRate,
      newAmount,
      id,
    ]
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

  // 6) Render confirm view with adjustment info
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
      return res.status(400).send('Missing required reservation parameters.');
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

    // Peak 14-night rule
    const peaksOk = !(
      withinPeak(checkInDate) ||
      withinPeak(checkOutDate)
    ) || nights <= 14;
    if (!peaksOk) {
      return res
        .status(400)
        .send('Stays cannot exceed 14 nights within peak windows.');
    }

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
 *
 * Hotel-style behavior:
 *  - Validate and create a reservation for the selected site.
 *  - If the site is no longer available, suggest alternative sites.
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
      !(checkInDate instanceof Date) ||
      isNaN(checkInDate.getTime()) ||
      !(checkOutDate instanceof Date) ||
      isNaN(checkOutDate.getTime())
    ) {
      throw new Error('Invalid check-in or check-out date.');
    }

    if (checkOutDate <= checkInDate) {
      throw new Error('Check-out must be after check-in.');
    }

    // 1) Fetch site
    const [siteRows] = await pool.query(
      'SELECT * FROM Site WHERE id = ? AND active = 1 LIMIT 1',
      [siteIdNum]
    );
    const site = siteRows[0];

    if (!site) {
      throw new Error('Site not found or inactive.');
    }

    const requestedType = type || site.type || '';

    // 2) Check rig length vs site length
    if (rigLengthNum > site.lengthFt) {
      throw new Error('Rig is too long for this site.');
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
      // This site is not available for those dates anymore.
      // Find alternative sites that are available for the same dates.

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

      // Type filter (try to keep same type the user originally picked)
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
        alternatives: alternativeRows,
      });
    }

    // 4) Business rules: nights, peak season, PCS flag
    const nightCount = nightsBetween(checkInDate, checkOutDate);
    if (nightCount <= 0) {
      throw new Error('Stay must be at least one night.');
    }

    const inPeak =
      withinPeak(checkInDate) || withinPeak(checkOutDate);
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
    const confirmationCode = Math.random()
      .toString(36)
      .slice(2, 10)
      .toUpperCase();

    // 7) Insert reservation with guestId if available
    const guestId =
      req.session.user && req.session.user.id
        ? req.session.user.id
        : null;
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
        1, // paid = 1 for guest reservations
      ]
    );

    // 8) Get the newly created reservation's ID (for payment route)
    const [result] = await pool.query(
      'SELECT id FROM Reservation WHERE confirmationCode = ? LIMIT 1',
      [confirmationCode]
    );
    const reservationId = result[0]?.id;
    if (!reservationId) {
      return res
        .status(500)
        .send(
          'Reservation created, but could not find reservation ID for payment.'
        );
    }

    // Redirect to payment page
    res.redirect(`/payments/${reservationId}`);
  } catch (e) {
    res.status(400).send(String(e));
  }
});

/**
 * GET /confirm/:code
 * Load reservation by confirmation code and render confirm page.
 */
router.get('/confirm/:code', async (req, res) => {
  const { code } = req.params;

  const [resRows] = await pool.query(
    `
      SELECT r.*, s.number AS siteNumber, s.lengthFt, s.type AS siteType
      FROM Reservation r
      JOIN Site s ON s.id = r.siteId
      WHERE r.confirmationCode = ?
      LIMIT 1
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
 * Cancels a reservation and computes any cancellation fee.
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
  const hoursBefore =
    (checkInDate.getTime() - Date.now()) / (1000 * 60 * 60);

  const isSpecial = await stayTouchesSpecialEvent(
    r.checkIn,
    r.checkOut
  );

  const oneNight = Number(r.nightlyRate || 30.0);
  let fee = 0;

  if (isSpecial) {
    fee = oneNight;
  } else if (hoursBefore <= 72) {
    fee = oneNight;
  } else {
    fee = 10.0;
  }

  // 5) Mark reservation as cancelled
  await pool.query(
    'UPDATE Reservation SET status = ? WHERE id = ?',
    ['CANCELLED', id]
  );

  res.render('cancelled', { r, fee, oneNight });
});

module.exports = router;
