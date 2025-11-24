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
 * POST /reserve
 * Creates a reservation if:
 *  - Site exists and is long enough
 *  - There is no overlapping CONFIRMED reservation
 *  - Peak season rules are satisfied
 */
router.post('/reserve', async (req, res) => {
  try {
    const {
      siteId,
      guestName,
      guestEmail,
      rigLengthFt,
      checkIn,
      checkOut,
      pcs
    } = req.body;

    const siteIdNum = Number(siteId);
    const rigLengthNum = Number(rigLengthFt);

    // 1) Fetch site
    const [siteRows] = await pool.query(
      'SELECT * FROM Site WHERE id = ?',
      [siteIdNum]
    );
    const site = siteRows[0];

    if (!site) {
      throw new Error('Site not found.');
    }

    // 2) Check rig length vs site length
    if (site.lengthFt < rigLengthNum) {
      throw new Error('Selected site is too short for the rig.');
    }

    // 3) Check for overlapping confirmed reservation
    // Overlap logic (same as overlapFilter):
    //   status = 'CONFIRMED'
    //   AND checkIn < checkOut
    //   AND checkOut > checkIn
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
      [site.id, toDate(checkOut), toDate(checkIn)]
    );

    if (overlapRows.length > 0) {
      throw new Error('Sorry, this site just got booked. Try another one.');
    }

    // 4) Business rules: nights, peak season, PCS flag
    const nightCount = nightsBetween(checkIn, checkOut);
    const inPeak = withinPeak(checkIn) || withinPeak(checkOut);
    const pcsFlag = (pcs === 'on' || pcs === 'true' || pcs === true);

    if (inPeak && !pcsFlag && nightCount > 14) {
      throw new Error('Peak season limit is 14 nights (PCS exempt).');
    }

    // 5) Rate lookup & amount
    const rate = await activeRateFor(site.type, checkIn);
    const amount = rate * nightCount;

    // 6) Confirmation code
    const confirmationCode = Math.random().toString(36).slice(2, 10).toUpperCase();

    // 7) Insert reservation
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
        toDate(checkIn),
        toDate(checkOut),
        pcsFlag ? 1 : 0,
        confirmationCode,
        rate,
        amount
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

  // 2) Load site info similar to prisma include: { site: true }
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
