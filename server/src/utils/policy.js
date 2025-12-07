/**
 * Convert input to a Date object safely
 */
function toDate(x) {
  if (!x) return null;
  const d = new Date(x);
  return isNaN(d.getTime()) ? null : d;
}

/**
 * Calculate nights between two dates
 */
function nightsBetween(checkIn, checkOut) {
  const ms = checkOut.getTime() - checkIn.getTime();
  return Math.max(0, Math.ceil(ms / (1000 * 60 * 60 * 24)));
}

/**
 * FIXED PEAK SEASON LOGIC
 * ------------------------
 * Peak Season = June 1 → September 1
 *
 * A stay is only a problem if:
 *  - It overlaps peak season, AND
 *  - It exceeds 14 nights
 *
 * All other stays (including December) are always allowed.
 */
function withinPeak(checkIn, checkOut) {
  const nights = nightsBetween(checkIn, checkOut);

  // If nights <= 14, always allowed
  if (nights <= 14) return true;

  // Define peak window based on reservation year
  const year = checkIn.getFullYear();
  const peakStart = new Date(year, 5, 1); // June 1
  const peakEnd = new Date(year, 8, 1);   // Sept 1

  const overlapsPeak = checkIn < peakEnd && checkOut > peakStart;

  // If overlapping peak AND >14 nights → not allowed
  if (overlapsPeak) return false;

  // Otherwise fine
  return true;
}

/**
 * activeRateFor(type, startDate)
 * Your project already expects this shape.
 * We only strengthen the defaults.
 */
async function activeRateFor(type, date) {
  // Base rate
  let rate = 30;

  // Peak season surcharge
  const year = date.getFullYear();
  const peakStart = new Date(year, 5, 1);
  const peakEnd = new Date(year, 8, 1);

  if (date >= peakStart && date < peakEnd) {
    rate = 35;
  }

  return { nightlyRate: rate };
}

/**
 * Used by cancellation logic.
 * We keep this unchanged to avoid breaking your flow.
 */
async function stayTouchesSpecialEvent(checkIn, checkOut) {
  return false; // you can expand this later
}

module.exports = {
  toDate,
  nightsBetween,
  withinPeak,
  activeRateFor,
  stayTouchesSpecialEvent,
};
