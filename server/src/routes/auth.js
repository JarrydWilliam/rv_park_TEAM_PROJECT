// server/src/routes/auth.js
const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const pool = require('../db/pool');

function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

// --- LOGIN ---

router.get('/login', (req, res) => {
  let next = req.query.next || '';
  if (next.startsWith('/login')) next = '';
  res.render('login', { error: null, next, currentUser: req.session.user || null });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  const [rows] = await pool.query(
    'SELECT * FROM users WHERE username = ? LIMIT 1',
    [username]
  );
  const user = rows[0];

  if (!user) {
    return res
      .status(401)
      .render('login', { error: 'Invalid username or password.', currentUser: null });
  }

  const passwordHash = hashPassword(password);
  if (user.password_hash !== passwordHash) {
    return res
      .status(401)
      .render('login', { error: 'Invalid username or password.', currentUser: null });
  }

  req.session.user = {
    id: user.id,
    username: user.username,
    role: user.role,
    firstName: user.first_name,
    lastName: user.last_name,
    email: user.email,
    name: (user.first_name && user.last_name) ? `${user.first_name} ${user.last_name}` : user.username
  };

  // Only redirect to next if it's a valid, non-login path
  let next = req.body.next || '';
  if (next && !next.startsWith('/login')) {
    return res.redirect(next);
  }
  if (user.role === 'admin') {
    return res.redirect('/admin/dashboard');
  }
  if (user.role === 'employee') {
    return res.redirect('/employee/dashboard');
  }
  return res.redirect('/guest/dashboard');
});

// --- REGISTER ---

router.get('/register', (req, res) => {
  res.render('register', { error: null });
});

router.post('/register', async (req, res) => {
  try {
    const {
      firstName,
      lastName,
      email,
      username,
      password,
      confirmPassword,
      dodAffiliation,
      branch,
      rank,
      numAdults,
      numPets,
      petBreedNotes,
      petDisclaimerAccepted,
      baseAccessConfirmed,
    } = req.body;

    // basic validation
    if (password !== confirmPassword) {
      return res.status(400).render('register', { error: 'Passwords do not match.' });
    }

    if (!petDisclaimerAccepted) {
      return res
        .status(400)
        .render('register', { error: 'You must accept the pet policy disclaimer.' });
    }

    if (!baseAccessConfirmed) {
      return res
        .status(400)
        .render('register', { error: 'You must confirm that you can access the base.' });
    }

    // check username uniqueness
    const [existing] = await pool.query(
      'SELECT id FROM users WHERE username = ?',
      [username]
    );
    if (existing.length > 0) {
      return res.status(400).render('register', { error: 'Username is already taken.' });
    }

    const passwordHash = hashPassword(password);

    const petDisclaimerFlag =
      petDisclaimerAccepted === 'on' ||
      petDisclaimerAccepted === 'true' ||
      petDisclaimerAccepted === true ||
      petDisclaimerAccepted === 1 ||
      petDisclaimerAccepted === '1';

    const baseAccessFlag =
      baseAccessConfirmed === 'on' ||
      baseAccessConfirmed === 'true' ||
      baseAccessConfirmed === true ||
      baseAccessConfirmed === 1 ||
      baseAccessConfirmed === '1';

    const [result] = await pool.query(
      `INSERT INTO users
        (username, email, first_name, last_name, password_hash, role,
         dod_affiliation, branch, rank_grade, num_adults, num_pets, pet_breed_notes,
         pet_disclaimer_accepted, base_access_confirmed)
       VALUES (?, ?, ?, ?, ?, 'customer', ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        username,
        email,
        firstName,
        lastName,
        passwordHash,
        dodAffiliation,
        branch,
        rank,
        Number(numAdults) || 1,
        Number(numPets) || 0,
        petBreedNotes || null,
        petDisclaimerFlag ? 1 : 0,
        baseAccessFlag ? 1 : 0,
      ]
    );

    const newUserId = result.insertId;

    req.session.user = {
      id: newUserId,
      username,
      role: 'customer',
      firstName,
      lastName,
      email,
      name: (firstName && lastName) ? `${firstName} ${lastName}` : username
    };

    res.redirect('/guest/dashboard');
  } catch (err) {
    console.error('Registration error:', err);
    res
      .status(500)
      .render('register', { error: 'Error creating account. Please try again.' });
  }
});

// --- LOGOUT ---

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
