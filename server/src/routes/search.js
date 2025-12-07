const express = require('express');
const { parseISO, startOfToday, addDays, format } = require('date-fns');
const pool = require('../db/pool');

const router = express.Router();

/**
 * Helper: fetch min / max rig length from active sites.
 * Used so the UI can show valid bounds to the user.
 */
async function getRigBounds() {
  const [rows] = await pool.query(
    'SELECT MIN(lengthFt) AS minLen, MAX(lengthFt) AS maxLen FROM Site WHERE active = 1'
  );
  const row = rows[0] || {};
  return {
    minLen: row.minLen || 1,
    maxLen: row.maxLen || 100
  };
}

/**
 * Query helper:
 * Find available sites between checkIn and checkOut that:
 *  - are active
 *  - satisfy rig length (if > 0)
 *  - satisfy type (if provided)
 *  - have NO overlapping CONFIRMED reservations in that range
 */
async function findAvailableSites({ checkIn, checkOut, rigLength, type, orderBy = 'lengthFt' }) {
  const params = [];
  let whereClauses = ['s.active = 1'];

  // Rig length filter
  if (rigLength && rigLength > 0) {
    whereClauses.push('s.lengthFt >= ?');
    params.push(rigLength);
  }

  // Type filter
  if (type) {
    whereClauses.push('s.type = ?');
    params.push(type);
  }

  // NOT EXISTS overlapping reservations:
  //   status = 'CONFIRMED'
  //   AND checkIn < checkOut
  //   AND checkOut > checkIn
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
  params.push(checkOut, checkIn);

  const whereSql = whereClauses.length ? `WHERE ${whereClauses.join(' AND ')}` : '';
  const orderSql = orderBy === 'number' ? 'ORDER BY s.number ASC' : 'ORDER BY s.lengthFt ASC';

  const [rows] = await pool.query(
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
      ${orderSql}
    `,
    params
  );

  return rows;
}

// Home: empty form
router.get('/', async (req, res) => {
  const rigBounds = await getRigBounds();
  const todayIso = format(startOfToday(), 'yyyy-MM-dd');

  res.render('search', {
    results: null,
    query: {},
    error: null,
    rigBounds,
    todayIso
  });
});

// Standard search via form submit
router.get('/search', async (req, res) => {
  const rigBounds = await getRigBounds();
  const today = startOfToday();
  const todayIso = format(today, 'yyyy-MM-dd');

  try {
    const { check_in, check_out, rig_length, type } = req.query;

    if (!check_in || !check_out || !rig_length) {
      return res.render('search', {
        results: null,
        query: req.query,
        error: 'Please provide check-in, check-out, and rig length.',
        rigBounds,
        todayIso
      });
    }

    const rigLength = parseInt(rig_length, 10);

    let checkIn, checkOut;
    try {
      checkIn = parseISO(check_in);
      checkOut = parseISO(check_out);
    } catch (err) {
      return res.render('search', {
        results: null,
        query: req.query,
        error: 'One or both dates are invalid.',
        rigBounds,
        todayIso
      });
    }

    // Check-in cannot be in the past
    if (checkIn < today) {
      return res.render('search', {
        results: null,
        query: req.query,
        error: 'Check-in date cannot be in the past.',
        rigBounds,
        todayIso
      });
    }

    // Check-out must be after check-in
    if (checkOut <= checkIn) {
      return res.render('search', {
        results: null,
        query: req.query,
        error: 'Check-out date must be after the check-in date.',
        rigBounds,
        todayIso
      });
    }

    const results = await findAvailableSites({
      checkIn,
      checkOut,
      rigLength,
      type,
      orderBy: 'lengthFt'
    });

    res.render('search', {
      results,
      query: req.query,
      error: null,
      rigBounds,
      todayIso
    });
  } catch (e) {
    res.render('search', {
      results: null,
      query: req.query,
      error: String(e),
      rigBounds,
      todayIso
    });
  }
});

/**
 * Quick vacancy view
 * - Defaults to today -> tomorrow
 * - Rig length optional (0 = any)
 * - Reuses the same 'search' template
 */
router.get('/vacancy', async (req, res) => {
  const rigBounds = await getRigBounds();

  try {
    const today = startOfToday();
    const todayIso = format(today, 'yyyy-MM-dd');
    const defaultIn = format(today, 'yyyy-MM-dd');
    const defaultOut = format(addDays(today, 1), 'yyyy-MM-dd');

    const check_in = req.query.check_in || defaultIn;
    const check_out = req.query.check_out || defaultOut;
    const type = req.query.type || '';
    const rigLengthNum = req.query.rig_length ? parseInt(req.query.rig_length, 10) : 0;

    const checkIn = parseISO(check_in);
    const checkOut = parseISO(check_out);

    // Enforce same date rules on vacancy as well
    if (checkIn < today) {
      return res.render('search', {
        results: null,
        query: {
          check_in,
          check_out,
          rig_length: rigLengthNum ? String(rigLengthNum) : '',
          type
        },
        error: 'Check-in date cannot be in the past.',
        rigBounds,
        todayIso
      });
    }

    if (checkOut <= checkIn) {
      return res.render('search', {
        results: null,
        query: {
          check_in,
          check_out,
          rig_length: rigLengthNum ? String(rigLengthNum) : '',
          type
        },
        error: 'Check-out date must be after the check-in date.',
        rigBounds,
        todayIso
      });
    }

    const results = await findAvailableSites({
      checkIn,
      checkOut,
      rigLength: rigLengthNum,
      type,
      orderBy: 'number'
    });

    res.render('search', {
      results,
      query: {
        check_in,
        check_out,
        rig_length: rigLengthNum ? String(rigLengthNum) : '',
        type
      },
      error: null,
      rigBounds,
      todayIso
    });
  } catch (e) {
    const today = startOfToday();
    const todayIso = format(today, 'yyyy-MM-dd');

    res.render('search', {
      results: null,
      query: req.query,
      error: String(e),
      rigBounds,
      todayIso
    });
  }
});

module.exports = router;
