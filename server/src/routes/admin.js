const express = require('express');
const router = express.Router();
const pool = require('../db/pool');
const { requireRole } = require('../middleware/auth');

// Protect all admin routes
router.use(requireRole('admin'));

/**
 * GET /admin/dashboard
 */
router.get('/admin/dashboard', async (req, res) => {
  const currentUser = req.session.user || null;

  const [[counts]] = await pool.query(`
    SELECT
      (SELECT COUNT(*) FROM Reservation WHERE status = 'CONFIRMED') AS totalReservations,
      (SELECT COUNT(*) FROM Site WHERE active = 1) AS activeSites,
      (SELECT COUNT(*) FROM users WHERE role = 'customer') AS customers
  `);

  res.render('admin/dashboard', { counts, currentUser });
});

/**
 * GET /admin/sites
 */
router.get('/admin/sites', async (req, res) => {
  const [sites] = await pool.query('SELECT * FROM Site ORDER BY number ASC');
  res.render('admin/sites', { sites, currentUser: req.session.user || null });
});

/**
 * GET /admin/sites/new
 */
router.get('/admin/sites/new', async (req, res) => {
  res.render('admin/site_form', {
    site: null,
    currentUser: req.session.user || null,
  });
});

/**
 * POST /admin/sites/new
 */
router.post('/admin/sites/new', async (req, res) => {
  const { number, type, lengthFt, description, active } = req.body;

  await pool.query(
    `
      INSERT INTO Site (number, type, lengthFt, description, active)
      VALUES (?, ?, ?, ?, ?)
    `,
    [number, type, Number(lengthFt), description || '', active ? 1 : 0]
  );

  res.redirect('/admin/sites');
});

/**
 * GET /admin/sites/:id/edit
 */
router.get('/admin/sites/:id/edit', async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM Site WHERE id = ?', [
    req.params.id,
  ]);
  const site = rows[0];

  if (!site) return res.status(404).send('Site not found');

  res.render('admin/site_form', {
    site,
    currentUser: req.session.user || null,
  });
});

/**
 * POST /admin/sites/:id/edit
 */
router.post('/admin/sites/:id/edit', async (req, res) => {
  const { number, type, lengthFt, description, active } = req.body;

  await pool.query(
    `
      UPDATE Site
      SET number = ?, type = ?, lengthFt = ?, description = ?, active = ?
      WHERE id = ?
    `,
    [
      number,
      type,
      Number(lengthFt),
      description || '',
      active ? 1 : 0,
      req.params.id,
    ]
  );

  res.redirect('/admin/sites');
});

/**
 * Soft delete / archive site
 */
router.post('/sites/:id/delete', requireRole('admin'), async (req, res) => {
  await pool.query('UPDATE Site SET active = 0 WHERE id = ?', [
    req.params.id,
  ]);
  res.redirect('/admin/sites');
});

/**
 * GET /admin/walkin_reports
 */
router.get('/admin/walkin_reports', async (req, res) => {
  const [sites] = await pool.query(
    'SELECT * FROM Site WHERE active = 1 ORDER BY number ASC'
  );

  const availableSites = await Promise.all(
    sites.map(async (site) => {
      const [[nextRes]] = await pool.query(
        `
        SELECT checkIn
        FROM Reservation
        WHERE siteId = ?
          AND status = 'CONFIRMED'
          AND checkIn > CURDATE()
        ORDER BY checkIn ASC
        LIMIT 1
      `,
        [site.id]
      );

      let availableUntil = null;
      let durationDays = null;

      if (nextRes?.checkIn) {
        availableUntil = nextRes.checkIn;

        const today = new Date();
        const nextCheck = new Date(nextRes.checkIn);
        durationDays = Math.max(
          0,
          Math.ceil((nextCheck - today) / (1000 * 60 * 60 * 24))
        );
      }

      return {
        number: site.number,
        type: site.type,
        lengthFt: site.lengthFt,
        availableUntil,
        durationDays,
      };
    })
  );

  res.render('admin/walkin_reports', {
    availableSites,
    currentUser: req.session.user || null,
  });
});

/**
 * GET /admin/reports
 */
router.get('/admin/reports', async (req, res) => {
  res.render('admin/reports', { currentUser: req.session.user || null });
});

/**
 * GET /admin/daily_report
 */
router.get('/admin/daily_report', async (req, res) => {
  const [rows] = await pool.query(`
    SELECT
      s.id,
      s.number,
      s.type,
      s.lengthFt,
      r.id AS reservationId,
      r.checkIn,
      r.checkOut,
      r.status,
      r.guestName
    FROM Site s
    LEFT JOIN Reservation r
      ON r.siteId = s.id
      AND r.status = 'CONFIRMED'
      AND CURDATE() >= r.checkIn
      AND CURDATE() < r.checkOut
    ORDER BY s.number ASC
  `);

  res.render('admin/daily_report', {
    rows,
    currentUser: req.session.user || null,
  });
});

/**
 * GET /admin/availability_report
 */
router.get('/admin/availability_report', async (req, res) => {
  const { date } = req.query;

  const toDate = (d) => new Date(d + 'T00:00:00');

  let selectedDate = date ? toDate(date) : new Date();
  selectedDate.setHours(0, 0, 0, 0);

  const [rows] = await pool.query(
    `
      SELECT
        s.id,
        s.number,
        s.type,
        s.lengthFt,
        r.id AS reservationId,
        r.checkIn,
        r.checkOut,
        r.status
      FROM Site s
      LEFT JOIN Reservation r
        ON r.siteId = s.id
        AND r.status = 'CONFIRMED'
        AND ? >= r.checkIn
        AND ? < r.checkOut
      ORDER BY s.number ASC
    `,
    [selectedDate, selectedDate]
  );

  res.render('admin/availability_report', {
    rows,
    selectedDate,
    currentUser: req.session.user || null,
  });
});

/**
 * GET /admin/walkins/unpaid
 */
router.get('/admin/walkins/unpaid', async (req, res) => {
  const [walkins] = await pool.query(`
    SELECT *,
      DATEDIFF(checkOut, checkIn) AS nights,
      nightlyRate * DATEDIFF(checkOut, checkIn) AS expectedAmount
    FROM Reservation
    WHERE paid = 0
      AND status = 'CONFIRMED'
  `);

  res.render('admin/unpaid_walkins', {
    walkins,
    currentUser: req.session.user || null,
  });
});

/**
 * NEW — POST /admin/walkins/mark-paid/:id
 * Fixes: Cannot POST /admin/walkins/mark-paid/18
 */
router.post('/admin/walkins/mark-paid/:id', async (req, res) => {
  await pool.query('UPDATE Reservation SET paid = 1 WHERE id = ?', [
    req.params.id,
  ]);

  res.redirect('/admin/walkins/unpaid');
});

/**
 * GET /admin/users
 * Fixes "message is not defined"
 */
router.get('/admin/users', async (req, res) => {
  const message = req.query.msg || null;
  const error = req.query.err || null;

  const [users] = await pool.query(
    `
    SELECT id, username, email, first_name, last_name, role,
           dod_affiliation, branch, rank_grade, num_adults, num_pets
    FROM users
  `
  );

  res.render('admin/users', {
    users,
    message,
    error,
    currentUser: req.session.user || null,
  });
});

/**
 * POST /admin/users/new
 */
router.post('/admin/users/new', async (req, res) => {
  try {
    const { username, email, role } = req.body;

    await pool.query(
      `
      INSERT INTO users
        (username, email, first_name, last_name, password_hash, role,
         dod_affiliation, branch, rank_grade, num_adults, num_pets,
         pet_disclaimer_accepted, base_access_confirmed)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0, 0, 0)
    `,
      [
        username,
        email,
        'Admin',
        'User',
        'DUMMY_HASH',
        role,
        'Admin Created',
        'N/A',
        'N/A',
      ]
    );

    return res.redirect('/admin/users?msg=User%20created');
  } catch (err) {
    console.error('Admin create user error:', err);
    return res.redirect('/admin/users?err=Error%20creating%20user');
  }
});

module.exports = router;
