// server/src/utils/policy.js

const { differenceInCalendarDays } = require('date-fns');
const pool = require('../db/pool');

// ---- Date helpers ----

function toDate(v) {
  return v instanceof Date ? v : new Date(v);
}

function nightsBetween(a, b) {
  const d1 = toDate(a);
  const d2 = toDate(b);
  return Math.max(0, differenceInCalendarDays(d2, d1));
}

/**
 * Peak season check.
 * April 15 (month 3, zero-based) through October 15 (month 9) UTC.
 */
function withinPeak(date) {
  const d = toDate(date);
  const y = d.getUTCFullYear();

  const start = new Date(Date.UTC(y, 3, 15)); // Apr 15
  const end = new Date(Date.UTC(y, 9, 15));   // Oct 15

  return d >= start && d <= end;
}

// ---- DB-backed helpers (now using mysql2 instead of Prisma) ----

/**
 * activeRateFor(siteType, onDate)
 *
 * Looks up the most recent RatePlan that:
 *  - matches the given siteType
 *  - is effective on `onDate` (effectiveFrom <= onDate <= effectiveTo)
 *
 * Falls back to 30.00 if nothing is found.
 *
 * Assumes a table equivalent to Prisma's:
 * model RatePlan {
 *   id            Int       @id @default(autoincrement())
 *   name          String
 *   amount        Decimal
 *   siteType      SiteType?
 *   effectiveFrom DateTime
 *   effectiveTo   DateTime
 * }
 */
async function activeRateFor(siteType, onDate) {
  const when = toDate(onDate);

  const [rows] = await pool.query(
    `
      SELECT amount
      FROM RatePlan
      WHERE siteType = ?
        AND effectiveFrom <= ?
        AND effectiveTo   >= ?
      ORDER BY effectiveFrom DESC
      LIMIT 1
    `,
    [siteType, when, when]
  );

  if (rows.length > 0 && rows[0].amount != null) {
    // mysql2 returns numbers or strings depending on config; normalize to Number
    return Number(rows[0].amount);
  }

  // Default nightly rate if nothing is configured
  return 30.0;
}

/**
 * stayTouchesSpecialEvent(checkIn, checkOut)
 *
 * Returns true if the stay overlaps any SpecialEvent.
 *
 * Prisma model was:
 * model SpecialEvent {
 *   id                Int      @id @default(autoincrement())
 *   name              String
 *   startDate         DateTime
 *   endDate           DateTime
 *   oneNightCancelFee Boolean  @default(true)
 * }
 */
async function stayTouchesSpecialEvent(i, o) {
  const checkIn = toDate(i);
  const checkOut = toDate(o);

  const [rows] = await pool.query(
    `
      SELECT id
      FROM SpecialEvent
      WHERE startDate < ?
        AND endDate   > ?
      LIMIT 1
    `,
    [checkOut, checkIn]
  );

  return rows.length > 0;
}

/**
 * overlapFilter(i, o)
 *
 * This used to return a Prisma "where" filter for Reservation:
 *   status = 'CONFIRMED' AND
 *   checkIn < o AND checkOut > i
 *
 * We keep the structure for now so existing code that builds
 * conditions from it won't crash immediately. When we refactor
 * the routes to pure SQL, we'll stop relying on this shape and
 * move the overlap logic directly into the queries.
 */
function overlapFilter(i, o) {
  return {
    status: 'CONFIRMED',
    AND: [
      { checkIn: { lt: toDate(o) } },
      { checkOut: { gt: toDate(i) } }
    ]
  };
}

module.exports = {
  toDate,
  nightsBetween,
  withinPeak,
  activeRateFor,
  stayTouchesSpecialEvent,
  overlapFilter
};
