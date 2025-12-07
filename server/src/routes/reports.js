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
      SELECT r.id, r.siteId, s.number AS siteNumber, r.guestName, r.checkIn, r.checkOut, r.status
      FROM Reservation r
      JOIN Site s ON s.id = r.siteId
      WHERE r.checkIn <= CURDATE() AND r.checkOut >= CURDATE()
      ORDER BY r.siteId, r.checkIn
    `);
    res.render('admin/occupancy_report', { report: rows });
  } catch (err) {
    console.error('Error generating report:', err);
    res.status(500).send('Error generating report');
  }
});

// GET /reports/daily - Daily Report: all sites, occupancy status, next check-in
router.get('/daily', async (req, res) => {
      const [sites] = await pool.query('SELECT * FROM Site');
      const [reservations] = await pool.query('SELECT * FROM Reservation WHERE checkOut >= CURDATE()');
    // Move debug logging after sites and reservations are defined
    // Already declared above, do not redeclare
  try {
    const [sites] = await pool.query('SELECT * FROM Site');
    const [reservations] = await pool.query('SELECT * FROM Reservation WHERE checkOut >= CURDATE()');
    // Map site occupancy and next check-in
    const today = new Date().toISOString().slice(0, 10);
    const siteStatus = sites.map(site => {
      // Find current reservation using string comparison
      // Convert reservation checkIn/checkOut to YYYY-MM-DD for comparison
      const current = reservations.find(r => {
        const resCheckIn = typeof r.checkIn === 'string' ? r.checkIn.slice(0,10) : r.checkIn.toISOString().slice(0,10);
        const resCheckOut = typeof r.checkOut === 'string' ? r.checkOut.slice(0,10) : r.checkOut.toISOString().slice(0,10);
        return Number(r.siteId) === Number(site.id) && resCheckIn <= today && resCheckOut >= today;
      });
      console.log('DEBUG: Site', site.id, 'today', today, 'current', current);
      let info = {
        siteId: site.id,
        siteNumber: site.number,
        type: site.type,
        status: current ? 'Occupied' : 'Unoccupied',
        currentCheckIn: null,
        currentCheckOut: null,
        nextCheckIn: null
      };
      if (current) {
        info.currentCheckIn = current.checkIn;
        info.currentCheckOut = current.checkOut;
      } else {
        const future = reservations
          .filter(r => r.siteId === site.id && r.checkIn > today)
          .sort((a, b) => a.checkIn.localeCompare(b.checkIn))[0];
        info.nextCheckIn = future ? future.checkIn : null;
      }
      return info;
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
    const [sites] = await pool.query('SELECT * FROM Site');
    // Get reservations overlapping weekend
    const [reserved] = await pool.query('SELECT siteId FROM Reservation WHERE (checkIn <= ? AND checkOut >= ?) OR (checkIn <= ? AND checkOut >= ?)', [satStr, satStr, sunStr, sunStr]);
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
