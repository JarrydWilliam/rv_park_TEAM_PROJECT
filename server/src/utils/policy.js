// server/src/utils/policy.js
//
// Shared business-rule helpers for reservations & cancellations.
// NOTE: This version is aligned with the new MySQL schema created in
// server/src/db/bootstrap.js:
//
//   - RatePlan: uses `nightlyRate` (NOT `amount`)
//   - Reservation: uses `nightlyRate` + `amountPaid`
//
// There should be **no** references to a column named `amount` anywhere.

const { differenceInCalendarDays, parseISO } = require('date-fns');
const pool = require('../db/pool');

// ---- Basic date helpers ----------------------------------------------------

/**
 * toDate
 * Accepts a JS Date, ISO string, or 'yyyy-MM-dd' string
 * and returns a Date object.
 */
function toDate(value) {
  if (value instanceof Date) return value;
  if (typeof value === 'string') {
    // parseISO handles both full ISO and yyyy-MM-dd nicely
    return parseISO(value);
  }
  // Fallback: try to construct
  return new Date(value);
}

/**
 * nightsBetween
 * Given check-in and check-out (string or Date), returns the number of nights.
 * Example: 2025-12-01 to 2025-12-03 => 2 nights.
 */
function nightsBetween(checkIn, checkOut) {
  const inDate = toDate(checkIn);
  const outDate = toDate(checkOut);
  // differenceInCalendarDays(out, in) is exactly what we want
  return Math.max(differenceInCalendarDays(outDate, inDate), 0);
}

/**
 * withinPeak
 * Returns true if the given date falls inside a "peak season" window.
 * (Used for the 14-night rule unless PCS is checked.)
 *
 * Here we define peak season as roughly May 15 – Sep 15 for any given year.
 */
function withinPeak(dateLike) {
  const d = toDate(dateLike);
  const y = d.getFullYear();

  const peakStart = new Date(y, 4, 15); // May 15
  const peakEnd = new Date(y, 8, 15);   // Sep 15

  return d >= peakStart && d <= peakEnd;
}

// ---- DB-backed helpers (mysql2, NOT Prisma) -------------------------------

/**
 * activeRateFor(siteType, checkIn)
 *
 * Looks up the active nightly rate for a given site type on a given date.
 * Table: RatePlan
 *   - id INT PK
 *   - siteType VARCHAR(...)
 *   - nightlyRate DECIMAL(10,2)
 *   - startDate DATE
 *   - endDate DATE NULL
 *   - active TINYINT(1)
 *
 * If no matching row is found, we fall back to a default of 30.00.
 */
async function activeRateFor(siteType, checkIn) {
  const checkInDate = toDate(checkIn);
  const checkInSql = checkInDate.toISOString().slice(0, 10); // yyyy-MM-dd

  const [rows] = await pool.query(
    `
      SELECT nightlyRate
      FROM RatePlan
      WHERE siteType = ?
        AND startDate <= ?
        AND (endDate IS NULL OR endDate >= ?)
        AND active = 1
      ORDER BY startDate DESC
      LIMIT 1
    `,
    [siteType, checkInSql, checkInSql]
  );

  if (!rows.length || rows[0].nightlyRate == null) {
    // Reasonable default if no plan is found
    return 30.0;
  }
  return Number(rows[0].nightlyRate);
}

/**
 * stayTouchesSpecialEvent(checkIn, checkOut)
 *
 * Returns true if a stay overlaps any special event.
 * Table: SpecialEvent
 *   - id INT PK
 *   - name VARCHAR(...)
 *   - startDate DATE
 *   - endDate DATE
 *
 * Overlap rule is the same as reservations:
 *   event.startDate < stay.checkOut
 *   AND event.endDate > stay.checkIn
 */
async function stayTouchesSpecialEvent(checkIn, checkOut) {
  const inDate = toDate(checkIn).toISOString().slice(0, 10);
  const outDate = toDate(checkOut).toISOString().slice(0, 10);

  const [rows] = await pool.query(
    `
      SELECT 1
      FROM SpecialEvent
      WHERE
        startDate < ?
        AND endDate > ?
      LIMIT 1
    `,
    [outDate, inDate]
  );

  return rows.length > 0;
}

module.exports = {
  toDate,
  nightsBetween,
  withinPeak,
  activeRateFor,
  stayTouchesSpecialEvent
};
