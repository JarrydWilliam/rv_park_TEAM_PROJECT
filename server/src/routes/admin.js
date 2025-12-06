// server/src/routes/admin.js
const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const pool = require('../db/pool'); 
const { requireRole } = require('../middleware/auth');

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
