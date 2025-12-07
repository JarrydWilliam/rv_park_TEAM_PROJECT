const express = require('express');
const { parseISO, startOfToday, addDays, format } = require('date-fns');
const pool = require('../db/pool');
const { nightsBetween } = require('../utils/policy');

const router = express.Router();

/**
 * Helper: fetch min / max rig length from active sites.
 */
async function getRigBounds() {
  const [rows] = await pool.query(
    'SELECT MIN(lengthFt) AS minLen, MAX(lengthFt) AS maxLen FROM Site WHERE active = 1'
  );
  const row = rows[0] || {};
  return {
    minLen: row.minLen || 1,
    maxLen: row.maxLen || 100,
  };
}

/**
 * Simple length-based pricing for display on search page:
 *  - 35 ft  -> $30
 *  - 40 ft  -> $35
 *  - 45 ft  -> $40
 *  - anything else -> $30 (fallback)
 */
function baseRateForLength(lengthFt) {
  if (lengthFt === 35) return 30.0;
  if (lengthFt === 40) return 35.0;
  if (lengthFt === 45) return 40.0;
  return 30.0;
}

/**
 * Find available sites and enrich with pricing:
 *  - nights
 *  - nightlyRate, totalAmount
 *  - militaryNightlyRate, militaryTotalAmount (20% off)
 */
async function findAvailableSites({ checkIn, checkOut, rigLength, type, orderBy = 'lengthFt' }) {
  const params = [];
  const whereClauses = ['s.active = 1'];

  if (rigLength && rigLength > 0) {
    whereClauses.push('s.lengthFt >= ?');
    params.push(rigLength);
  }

  if (type) {
    whereClauses.push('s.type = ?');
    params.push(type);
  }

  // Exclude sites that have overlapping CONFIRMED reservations
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

  const whereSql = `WHERE ${whereClauses.join(' AND ')}`;
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

  const nights = nightsBetween(checkIn, checkOut);

  return rows.map((site) => {
    const nightlyRate = baseRateForLength(site.lengthFt);
    const totalAmount = nightlyRate * nights;

    const militaryNightlyRate = nightlyRate * 0.8;
    const militaryTotalAmount = totalAmount * 0.8;

    return {
      ...site,
      nights,
      nightlyRate,
      totalAmount,
      militaryNightlyRate,
      militaryTotalAmount,
      displayNightlyRate: nightlyRate.toFixed(2),
      displayTotalAmount: totalAmount.toFixed(2),
      displayMilitaryNightlyRate: militaryNightlyRate.toFixed(2),
      displayMilitaryTotalAmount: militaryTotalAmount.toFixed(2),
    };
  });
}

// Landing / empty search form
router.get('/', async (req, res) => {
  const rigBounds = await getRigBounds();
  const todayIso = format(startOfToday(), 'yyyy-MM-dd');

  res.render('search', {
    results: null,
    query: {},
    error: null,
    rigBounds,
    todayIso,
  });
});

// Main search
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
        todayIso,
      });
    }

    const rigLength = parseInt(rig_length, 10);
    if (Number.isNaN(rigLength) || rigLength <= 0) {
      return res.render('search', {
        results: null,
        query: req.query,
        error: 'Rig length must be a positive number.',
        rigBounds,
        todayIso,
      });
    }

    let checkIn;
    let checkOut;

    try {
      checkIn = parseISO(check_in);
      checkOut = parseISO(check_out);
    } catch {
      return res.render('search', {
        results: null,
        query: req.query,
        error: 'One or both dates are invalid.',
        rigBounds,
        todayIso,
      });
    }

    if (checkIn < today) {
      return res.render('search', {
        results: null,
        query: req.query,
        error: 'Check-in date cannot be in the past.',
        rigBounds,
        todayIso,
      });
    }

    if (checkOut <= checkIn) {
      return res.render('search', {
        results: null,
        query: req.query,
        error: 'Check-out date must be after the check-in date.',
        rigBounds,
        todayIso,
      });
    }

    const results = await findAvailableSites({
      checkIn,
      checkOut,
      rigLength,
      type,
      orderBy: 'lengthFt',
    });

    res.render('search', {
      results,
      query: req.query,
      error: null,
      rigBounds,
      todayIso,
    });
  } catch (e) {
    res.render('search', {
      results: null,
      query: req.query,
      error: String(e),
      rigBounds,
      todayIso,
    });
  }
});

// Quick vacancy view that reuses search.ejs
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

    if (checkIn < today) {
      return res.render('search', {
        results: null,
        query: { check_in, check_out, rig_length: rigLengthNum ? String(rigLengthNum) : '', type },
        error: 'Check-in date cannot be in the past.',
        rigBounds,
        todayIso,
      });
    }

    if (checkOut <= checkIn) {
      return res.render('search', {
        results: null,
        query: { check_in, check_out, rig_length: rigLengthNum ? String(rigLengthNum) : '', type },
        error: 'Check-out date must be after the check-in date.',
        rigBounds,
        todayIso,
      });
    }

    const results = await findAvailableSites({
      checkIn,
      checkOut,
      rigLength: rigLengthNum,
      type,
      orderBy: 'number',
    });

    res.render('search', {
      results,
      query: {
        check_in,
        check_out,
        rig_length: rigLengthNum ? String(rigLengthNum) : '',
        type,
      },
      error: null,
      rigBounds,
      todayIso,
    });
  } catch (e) {
    const today = startOfToday();
    const todayIso = format(today, 'yyyy-MM-dd');

    res.render('search', {
      results: null,
      query: req.query,
      error: String(e),
      rigBounds,
      todayIso,
    });
  }
});

module.exports = router;
