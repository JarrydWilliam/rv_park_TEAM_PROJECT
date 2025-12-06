const express = require('express');
const router = express.Router();
const pool = require('../db/pool');

// GET /reports - entry page
router.get('/', (req, res) => {
  res.render('admin/reports');
});

// GET /reports/occupancy - real occupancy report
router.get('/occupancy', async (req, res) => {
  try {
    const [rows] = await pool.query(`
      SELECT r.id, r.siteId, r.checkIn, r.checkOut
      FROM reservations r
      ORDER BY r.checkIn DESC
    `);
    res.render('admin/occupancy_report', { report: rows });
  } catch (err) {
    console.error('Error generating report:', err);
    res.status(500).send('Error generating report');
  }
});

// GET /reports/daily - Daily Report: all sites, occupancy status, next check-in
router.get('/daily', async (req, res) => {
  try {
    const [sites] = await pool.query('SELECT * FROM sites');
    const [reservations] = await pool.query('SELECT * FROM reservations WHERE checkOut >= CURDATE()');
    // Map site occupancy and next check-in
    const today = new Date().toISOString().slice(0, 10);
    const siteStatus = sites.map(site => {
      // Find current reservation
      const current = reservations.find(r => r.siteId === site.id && r.checkIn <= today && r.checkOut >= today);
      // Find next future check-in
      const future = reservations
        .filter(r => r.siteId === site.id && r.checkIn > today)
        .sort((a, b) => new Date(a.checkIn) - new Date(b.checkIn))[0];
      return {
        siteId: site.id,
        siteNumber: site.number,
        type: site.type,
        status: current ? 'Occupied' : 'Unoccupied',
        nextCheckIn: future ? future.checkIn : null
      };
    });
    res.render('admin/daily_report', { sites: siteStatus });
  } catch (err) {
    console.error('Error generating daily report:', err);
    res.status(500).send('Error generating daily report');
  }
});

// GET /reports/availability - Availability Report: sites available for walk-ins (not reserved for weekend)
router.get('/availability', async (req, res) => {
  try {
    // Find upcoming weekend dates
    const now = new Date();
    const day = now.getDay();
    const daysUntilSaturday = (6 - day + 7) % 7;
    const saturday = new Date(now);
    saturday.setDate(now.getDate() + daysUntilSaturday);
    const sunday = new Date(saturday);
    sunday.setDate(saturday.getDate() + 1);
    const satStr = saturday.toISOString().slice(0, 10);
    const sunStr = sunday.toISOString().slice(0, 10);
    // Get all sites
    const [sites] = await pool.query('SELECT * FROM sites');
    // Get reservations overlapping weekend
    const [reserved] = await pool.query('SELECT siteId FROM reservations WHERE (checkIn <= ? AND checkOut >= ?) OR (checkIn <= ? AND checkOut >= ?)', [satStr, satStr, sunStr, sunStr]);
    const reservedIds = reserved.map(r => r.siteId);
    // Filter available sites
    const availableSites = sites.filter(site => !reservedIds.includes(site.id));
    res.render('admin/availability_report', { sites: availableSites, weekend: { saturday: satStr, sunday: sunStr } });
  } catch (err) {
    console.error('Error generating availability report:', err);
    res.status(500).send('Error generating availability report');
  }
});

module.exports = router;
