const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db/pool'); 
const { requireRole } = require('../middleware/auth');

// GET /admin/walkin_reports
router.get('/walkin_reports', async (req, res) => {
  // Get all active sites
  const [sites] = await pool.query('SELECT * FROM Site WHERE active = 1');
  // For each site, find the next reservation (if any)
  const availableSites = await Promise.all(sites.map(async site => {
    const [[nextRes]] = await pool.query(
      `SELECT checkIn FROM Reservation WHERE siteId = ? AND checkIn > CURDATE() ORDER BY checkIn ASC LIMIT 1`,
      [site.id]
    );
    let availableUntil = null;
    let durationDays = null;
    if (nextRes && nextRes.checkIn) {
      availableUntil = nextRes.checkIn;
      // Calculate days until next reservation
      const today = new Date();
      const nextDate = new Date(nextRes.checkIn);
      durationDays = Math.max(0, Math.ceil((nextDate - today) / (1000 * 60 * 60 * 24)));
    } else {
      availableUntil = null;
      durationDays = null;
    }
    return {
      number: site.number,
      type: site.type,
      lengthFt: site.lengthFt,
      availableUntil,
      durationDays
    };
  }));
  res.render('admin/walkin_reports', { availableSites });
});

// Daily Occupancy Report
router.get('/reports/daily', async (req, res) => {
  const [sites] = await pool.query('SELECT * FROM Site ORDER BY number');
  const [reservations] = await pool.query('SELECT * FROM Reservation WHERE checkOut >= CURDATE()');
  // Map siteId to reservations
  const siteMap = {};
  sites.forEach(site => {
    siteMap[site.id] = {
      site,
      current: null,
      upcoming: []
    };
  });
  const today = new Date();
  reservations.forEach(r => {
    const checkIn = new Date(r.checkIn);
    const checkOut = new Date(r.checkOut);
    if (checkIn <= today && checkOut > today) {
      siteMap[r.siteId].current = r;
    } else if (checkIn > today) {
      siteMap[r.siteId].upcoming.push(r);
    }
  });
  res.render('admin/daily_report', { siteMap });
});

// Availability Report (for a date range)
router.get('/reports/availability', async (req, res) => {
  // Default to this weekend
  const start = req.query.start || new Date().toISOString().slice(0,10);
  const end = req.query.end || (() => {
    const d = new Date();
    d.setDate(d.getDate() + (6 - d.getDay())); // Saturday
    return d.toISOString().slice(0,10);
  })();
  const [sites] = await pool.query('SELECT * FROM Site ORDER BY number');
  const [reservations] = await pool.query('SELECT * FROM Reservation WHERE NOT (checkOut <= ? OR checkIn >= ?)', [start, end]);
  const reservedSiteIds = new Set(reservations.map(r => r.siteId));
  const availableSites = sites.filter(site => !reservedSiteIds.has(site.id));
  res.render('admin/availability_report', { availableSites, start, end });
});

// List all sites
router.get('/sites', requireRole('admin'), async (req, res) => {
  const [sites] = await pool.query('SELECT * FROM Site');
  res.render('admin/sites', { sites });
});

// Render create site form
router.get('/sites/new', requireRole('admin'), (req, res) => {
  res.render('admin/site_form', { site: null });
});

// Create site
router.post('/sites/new', requireRole('admin'), async (req, res) => {
  const { number, type, lengthFt, active } = req.body;
  await pool.query('INSERT INTO Site (number, type, lengthFt, active) VALUES (?, ?, ?, ?)', [number, type, lengthFt, active ? 1 : 0]);
  res.redirect('/admin/sites');
});

// Render edit site form
router.get('/sites/:id/edit', requireRole('admin'), async (req, res) => {
  const [rows] = await pool.query('SELECT * FROM Site WHERE id = ?', [req.params.id]);
  const site = rows[0];
  if (!site) return res.status(404).send('Site not found');
  res.render('admin/site_form', { site });
});

// Update site
router.post('/sites/:id/edit', requireRole('admin'), async (req, res) => {
  const { number, type, lengthFt, active } = req.body;
  await pool.query('UPDATE Site SET number = ?, type = ?, lengthFt = ?, active = ? WHERE id = ?', [number, type, lengthFt, active ? 1 : 0, req.params.id]);
  res.redirect('/admin/sites');
});

// Archive/disable site
router.post('/sites/:id/archive', requireRole('admin'), async (req, res) => {
  await pool.query('UPDATE Site SET active = 0 WHERE id = ?', [req.params.id]);
  res.redirect('/admin/sites');
});

// Delete site
router.post('/sites/:id/delete', requireRole('admin'), async (req, res) => {
  await pool.query('DELETE FROM Site WHERE id = ?', [req.params.id]);
  res.redirect('/admin/sites');
});

// GET /admin/walkins/unpaid
router.get('/walkins/unpaid', async (req, res) => {
  const [walkins] = await pool.query(`
    SELECT *,
      DATEDIFF(checkOut, checkIn) AS nights,
      nightlyRate * DATEDIFF(checkOut, checkIn) AS totalDue
    FROM Reservation
    WHERE source = 'walkin' AND amountPaid < (nightlyRate * DATEDIFF(checkOut, checkIn))
  `);
  res.render('admin/unpaid_walkins', { walkins });
});

// POST /admin/walkins/mark-paid/:id
router.post('/walkins/mark-paid/:id', async (req, res) => {
  // Get total due for this reservation
  const [[reservation]] = await pool.query(
    `SELECT nightlyRate, DATEDIFF(checkOut, checkIn) AS nights FROM Reservation WHERE id = ?`,
    [req.params.id]
  );
  const totalDue = reservation.nightlyRate * reservation.nights;
  await pool.query(
    `UPDATE Reservation SET amountPaid = ? WHERE id = ?`,
    [totalDue, req.params.id]
  );
  res.redirect('/admin/walkins/unpaid');
});

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// GET /admin/users  -> list all users
router.get('/admin/users', requireRole('admin'), async (req, res) => {
  try {
    const [rows] = await pool.query(
      `SELECT id, username, email, first_name, last_name,
              role, dod_affiliation, branch, rank_grade,
              num_adults, num_pets
       FROM users
       ORDER BY id`
    );

    res.render('admin/users', {
      users: rows,
      message: req.query.msg || null,
      error: req.query.err || null,
    });
  } catch (err) {
    console.error('Admin users list error:', err);
    res.status(500).render('admin/users', {
      users: [],
      message: null,
      error: 'Error loading users.',
    });
  }
});

// POST /admin/users/:id/role  -> change a user’s role
router.post('/admin/users/:id/role', requireRole('admin'), async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  const allowed = ['customer', 'employee', 'admin'];
  if (!allowed.includes(role)) {
    return res.redirect('/admin/users?err=Invalid%20role%20selected');
  }

  try {
    await pool.query('UPDATE users SET role = ? WHERE id = ?', [role, id]);
    return res.redirect('/admin/users?msg=Role%20updated');
  } catch (err) {
    console.error('Admin role update error:', err);
    return res.redirect('/admin/users?err=Error%20updating%20role');
  }
});

// POST /admin/users/create  -> create a new user (admin UI)
router.post('/admin/users/create', requireRole('admin'), async (req, res) => {
  try {
    const {
      username,
      email,
      firstName,
      lastName,
      role,
      password,
      dodAffiliation,
      branch,
      rankGrade,
      numAdults,
      numPets,
      petBreedNotes,
    } = req.body;

    if (!username || !email || !firstName || !lastName || !password) {
      return res.redirect('/admin/users?err=Missing%20required%20fields');
    }

    const allowedRoles = ['customer', 'employee', 'admin'];
    const safeRole = allowedRoles.includes(role) ? role : 'customer';

    // check username uniqueness
    const [existing] = await pool.query(
      'SELECT id FROM users WHERE username = ?',
      [username]
    );
    if (existing.length > 0) {
      return res.redirect('/admin/users?err=Username%20already%20exists');
    }

    const passwordHash = hashPassword(password);

    await pool.query(
      `INSERT INTO users
        (username, email, first_name, last_name, password_hash, role,
         dod_affiliation, branch, rank_grade, num_adults, num_pets, pet_breed_notes)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        username,
        email,
        firstName,
        lastName,
        passwordHash,
        safeRole,
        dodAffiliation || 'Admin-created',
        branch || 'N/A',
        rankGrade || 'N/A',
        Number(numAdults) || 1,
        Number(numPets) || 0,
        petBreedNotes || null,
      ]
    );

    return res.redirect('/admin/users?msg=User%20created');
  } catch (err) {
    console.error('Admin create user error:', err);
    return res.redirect('/admin/users?err=Error%20creating%20user');
  }
});

module.exports = router;
