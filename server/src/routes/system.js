const express = require('express');
const prisma = require('../db/prisma');

const router = express.Router();

// simple liveness
router.get('/health', (req, res) => {
  res.json({ ok: true });
});

// prove DB connectivity + show basic counts
router.get('/dbcheck', async (req, res) => {
  try {
    const [sites, reservations, payments, events, ratePlans] = await Promise.all([
      prisma.site.count(),
      prisma.reservation.count(),
      prisma.payment.count(),
      prisma.specialEvent.count(),
      prisma.ratePlan.count(),
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
