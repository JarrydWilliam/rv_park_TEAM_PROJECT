const express = require('express');
const { parseISO, startOfToday, addDays, format } = require('date-fns');
const pool = require('../db/pool');

const router = express.Router();

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
  // Overlap condition (from overlapFilter):
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
  res.render('search', { results: null, query: {}, error: null });
});

// Standard search via form submit
router.get('/search', async (req, res) => {
  try {
    const { check_in, check_out, rig_length, type } = req.query;

    if (!check_in || !check_out || !rig_length) {
      return res.render('search', {
        results: null,
        query: req.query,
        error: 'Please provide check-in, check-out, and rig length.',
      });
    }

    const rigLength = parseInt(rig_length, 10);
    const checkIn = parseISO(check_in);
    const checkOut = parseISO(check_out);

    const results = await findAvailableSites({
      checkIn,
      checkOut,
      rigLength,
      type,
      orderBy: 'lengthFt',
    });

    res.render('search', { results, query: req.query, error: null });
  } catch (e) {
    res.render('search', { results: null, query: req.query, error: String(e) });
  }
});

/**
 * Quick vacancy view
 * - Defaults to today -> tomorrow
 * - Rig length optional (0 = any)
 * - Reuses the same 'search' template
 */
router.get('/vacancy', async (req, res) => {
  try {
    const today = startOfToday();
    const defaultIn = format(today, 'yyyy-MM-dd');
    const defaultOut = format(addDays(today, 1), 'yyyy-MM-dd');

    const check_in = req.query.check_in || defaultIn;
    const check_out = req.query.check_out || defaultOut;
    const type = req.query.type || '';
    const rigLengthNum = req.query.rig_length ? parseInt(req.query.rig_length, 10) : 0;

    const checkIn = parseISO(check_in);
    const checkOut = parseISO(check_out);

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
    });
  } catch (e) {
    res.render('search', { results: null, query: req.query, error: String(e) });
  }
});

module.exports = router;
