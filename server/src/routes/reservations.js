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
  const [resRows] = await pool.query('SELECT * FROM Reservation WHERE id = ? LIMIT 1', [id]);
  const r = resRows[0];
  if (!r) {
    return res.status(404).send('Reservation not found.');
  }
  res.render('edit_reservation', { r });
});

/**
 * POST /reservations/:id/edit
 * Update reservation details.
 */
router.post('/reservations/:id/edit', async (req, res) => {
  const id = Number(req.params.id);
  const { checkIn, checkOut, guestName, guestEmail, rigLengthFt, type } = req.body;
  // Validate dates
  const checkInDate = toDate(checkIn);
  const checkOutDate = toDate(checkOut);
  const today = new Date();
  today.setHours(0,0,0,0);
  if (checkInDate < today) {
    return res.status(400).send('Check-in date cannot be before today.');
  }
  if (checkOutDate <= checkInDate) {
    return res.status(400).send('Check-out date must be after check-in date.');
  }
  // Update reservation
  await pool.query(
    'UPDATE Reservation SET checkIn = ?, checkOut = ?, guestName = ?, guestEmail = ?, rigLengthFt = ?, type = ? WHERE id = ?',
    [checkInDate, checkOutDate, guestName, guestEmail, rigLengthFt, type, id]
  );
  // Redirect to confirmation page
  res.redirect(`/confirm/${req.params.id}`);
});

/**
 * GET /reserve/new
 * Step 2 of the "hotel-style" flow:
 *  - User has already searched for availability.
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
 * Creates a reservation if:
 *  - Site exists and is long enough
 *  - There is no overlapping CONFIRMED reservation
 *  - Peak season rules are satisfied
 *
 * If there *is* an overlapping reservation, we:
 *  - Block the booking
 *  - Show alternative available sites for the same dates (hotel-style behavior).
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
    // Overlap logic:
    //   status = 'CONFIRMED'
    //   AND checkIn < newCheckOut
    //   AND checkOut > newCheckIn
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
        alternatives: alternativeRows
      });
    }

    // 4) Business rules: nights, peak season, PCS flag
    const nightCount = nightsBetween(checkInDate, checkOutDate);
    const inPeak = withinPeak(checkInDate) || withinPeak(checkOutDate);
    const pcsFlag = (pcs === 'on' || pcs === 'true' || pcs === true || pcs === 1 || pcs === '1');

    if (inPeak && !pcsFlag && nightCount > 14) {
      throw new Error('Peak season limit is 14 nights (PCS exempt).');
    }

    // 5) Rate lookup & total amount
    const nightlyRate = await activeRateFor(site.type, checkInDate);
    const amountPaid = nightlyRate * nightCount;

    // 6) Confirmation code
    const confirmationCode = Math.random().toString(36).slice(2, 10).toUpperCase();

    // 7) Insert reservation
    // IMPORTANT: only uses nightlyRate + amountPaid (no bare "amount" column).
    await pool.query(
      `
        INSERT INTO Reservation
          (siteId, guestName, guestEmail, rigLengthFt,
           checkIn, checkOut, pcs, confirmationCode,
           nightlyRate, amountPaid, status)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'CONFIRMED')
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
        amountPaid
      ]
    );

    // 8) Redirect to confirmation page
    res.redirect(`/confirm/${confirmationCode}`);
  } catch (e) {
    res.status(400).send(String(e));
  }
});

/**
 * GET /confirm/:code
 * Loads a reservation by confirmationCode and its associated site
 * and renders the "confirm" view.
 */
router.get('/confirm/:code', async (req, res) => {
  const { code } = req.params;

  // 1) Find reservation by confirmationCode
  const [resRows] = await pool.query(
    'SELECT * FROM Reservation WHERE confirmationCode = ? LIMIT 1',
    [code]
  );
  const r = resRows[0];

  if (!r) {
    return res.status(404).send('Reservation not found.');
  }

  // 2) Load site info
  const [siteRows] = await pool.query(
    'SELECT * FROM Site WHERE id = ? LIMIT 1',
    [r.siteId]
  );
  r.site = siteRows[0] || null;

  res.render('confirm', { r });
});

/**
 * POST /reservations/:id/cancel
 * Cancels a reservation and computes any cancellation fee.
 */
router.post('/reservations/:id/cancel', async (req, res) => {
  const id = Number(req.params.id);

  // 1) Fetch reservation and its site
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

  // 2) Compute hours before check-in
  const checkInDate = toDate(r.checkIn);
  const hoursBefore = (checkInDate.getTime() - Date.now()) / (1000 * 60 * 60);

  // 3) Check if stay touches a special event
  const isSpecial = await stayTouchesSpecialEvent(r.checkIn, r.checkOut);

  // 4) Cancellation fee logic
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
