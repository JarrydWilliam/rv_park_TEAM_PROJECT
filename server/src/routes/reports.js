const express = require('express');
const router = express.Router();

// GET /reports - entry page
router.get('/', (req, res) => {
  res.send(`
    <h1>Alpha Reports Demo</h1>
    <p>This page demonstrates the Reports functional point for the Alpha version.</p>
    <p>View today's occupancy report here:</p>
    <p><a href="/reports/occupancy">Daily Occupancy Report</a></p>
    <p><a href="/">Return to Home</a></p>
  `);
});

// GET /reports/occupancy - mock occupancy report
router.get('/occupancy', async (req, res) => {
  try {
    // Mock data for Alpha. In the full project, Prisma is used in other routes.
    const report = [
      {
        id: 1,
        siteId: 'A1',
        checkIn: '2025-11-18',
        checkOut: '2025-11-20',
      },
      {
        id: 2,
        siteId: 'B3',
        checkIn: '2025-11-19',
        checkOut: '2025-11-21',
      },
    ];

    let rows = report
      .map((r) => {
        return `
          <tr>
            <td>${r.id}</td>
            <td>${r.siteId}</td>
            <td>${r.checkIn}</td>
            <td>${r.checkOut}</td>
          </tr>
        `;
      })
      .join('');

    if (!rows) {
      rows = `<tr><td colspan="4">No reservations found.</td></tr>`;
    }

    res.send(`
      <h1>Daily Occupancy Report (Alpha Demo)</h1>
      <table border="1" cellspacing="0" cellpadding="6">
        <thead>
          <tr>
            <th>Reservation ID</th>
            <th>Site</th>
            <th>Check-in</th>
            <th>Check-out</th>
          </tr>
        </thead>
        <tbody>
          ${rows}
        </tbody>
      </table>
      <p><a href="/reports">Back to Reports</a></p>
      <p><a href="/">Return to Home</a></p>
    `);
  } catch (err) {
    console.error('Error generating report (Alpha mock):', err);
    res.status(500).send('Error generating report');
  }
});

module.exports = router;
