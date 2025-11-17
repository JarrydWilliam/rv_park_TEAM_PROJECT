const express = require('express');
const router = express.Router();
const prisma = require('../../prisma'); // adjust if needed

// GET /reports/occupancy - sample Alpha report
router.get('/occupancy', async (req, res) => {
  try {
    // Mock or real Prisma query for occupied sites
    const report = await prisma.reservations.findMany({
      select: { id: true, siteId: true, checkIn: true, checkOut: true }
    });
    res.render('reports', { title: 'Daily Occupancy Report', report });
  } catch (err) {
    console.error(err);
    res.status(500).send('Error generating report');
  }
});

module.exports = router;
