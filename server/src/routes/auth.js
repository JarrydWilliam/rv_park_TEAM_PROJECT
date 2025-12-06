const express = require('express');
const crypto = require('crypto');
const router = express.Router();

const pool = require('../db/pool'); 



function hashPassword(password) {
  return crypto.createHash('sha256').update(password).digest('hex');
}

function comparePassword(password, hash) {
  return hashPassword(password) === hash;
}

// --- LOGIN ---

router.get('/login', (req, res) => {
  res.render('login', { error: null });
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;

  try {
    const [rows] = await pool.query(
      'SELECT id, username, email, password_hash, role, first_name, last_name FROM users WHERE username = ?',
      [username]
    );

    if (rows.length === 0) {
      return res.status(401).render('login', { error: 'Invalid username or password.' });
    }

    const user = rows[0];

    const ok = comparePassword(password, user.password_hash);
    if (!ok) {
      return res.status(401).render('login', { error: 'Invalid username or password.' });
    }

    // Store minimal info in session
    req.session.user = {
      id: user.id,
      username: user.username,
      email: user.email,
      role: user.role,
      firstName: user.first_name,
      lastName: user.last_name,
    };

    // Role-based landing
    if (user.role === 'admin') return res.redirect('/admin/dashboard');
    if (user.role === 'employee') return res.redirect('/employee/dashboard');
    return res.redirect('/guest/dashboard'); // customer
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).render('login', { error: 'An error occurred while signing in.' });
  }
});

// --- REGISTER (CUSTOMER) ---

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
      petDisclaimerAccepted
    } = req.body;

    // basic validation
    if (password !== confirmPassword) {
      return res.status(400).render('register', { error: 'Passwords do not match.' });
    }

    if (!petDisclaimerAccepted) {
      return res.status(400).render('register', { error: 'You must accept the pet policy disclaimer.' });
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

    const [result] = await pool.query(
  `INSERT INTO users
    (username, email, first_name, last_name, password_hash, role,
     dod_affiliation, branch, rank_grade, num_adults, num_pets, pet_breed_notes)
   VALUES (?, ?, ?, ?, ?, 'customer', ?, ?, ?, ?, ?, ?)`,
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
    petBreedNotes || null
  ]
);

    const newUserId = result.insertId;

    req.session.user = {
      id: newUserId,
      username,
      role: 'customer',
      firstName,
      lastName,
    };

    res.redirect('/guest/dashboard');
  } catch (err) {
    console.error('Registration error:', err);
    res.status(500).render('register', { error: 'Error creating account. Please try again.' });
  }
});

// --- LOGOUT ---

router.post('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
