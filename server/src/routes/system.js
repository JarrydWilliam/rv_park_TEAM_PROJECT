// server/src/routes/system.js

const express = require('express');
const pool = require('../db/pool');

const router = express.Router();

// simple liveness
router.get('/health', (req, res) => {
  res.json({ ok: true });
});

// helper: count rows in a table
async function countTable(tableName) {
  const [rows] = await pool.query(
    `SELECT COUNT(*) AS count FROM \`${tableName}\``
  );
  return rows[0]?.count ?? 0;
}

// prove DB connectivity + show basic counts
router.get('/dbcheck', async (req, res) => {
  try {
    const [sites, reservations, payments, events, ratePlans] = await Promise.all([
      countTable('Site'),
      countTable('Reservation'),
      countTable('Payment'),
      countTable('SpecialEvent'),
      countTable('RatePlan'),
    ]);

    res.json({
      ok: true,
      db: 'connected',
      counts: { sites, reservations, payments, events, ratePlans },
      timestamp: new Date().toISOString(),
    });
  } catch (e) {
    res.status(500).json({ ok: false, error: String(e) });
  }
});

module.exports = router;
