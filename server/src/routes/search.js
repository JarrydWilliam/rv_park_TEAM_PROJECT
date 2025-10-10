const express = require('express');
const prisma = require('../db/prisma');
const { overlapFilter } = require('../utils/policy');
const { parseISO, startOfToday, addDays, format } = require('date-fns');

const router = express.Router();

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

    const results = await prisma.site.findMany({
      where: {
        active: true,
        lengthFt: { gte: rigLength },
        ...(type ? { type } : {}),
        reservations: { none: overlapFilter(checkIn, checkOut) },
      },
      orderBy: { lengthFt: 'asc' },
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

    const results = await prisma.site.findMany({
      where: {
        active: true,
        ...(rigLengthNum ? { lengthFt: { gte: rigLengthNum } } : {}),
        ...(type ? { type } : {}),
        reservations: { none: overlapFilter(checkIn, checkOut) },
      },
      orderBy: { number: 'asc' },
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
