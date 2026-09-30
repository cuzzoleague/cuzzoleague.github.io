// Fantasy weeks roll over every Tuesday at 8:00 AM Pacific, after Monday night's game is final.
export const ROLLOVER = {weekday: 2, hour: 8, timeZone: 'America/Los_Angeles'};

// How far a time zone is from UTC at a given instant (negative west of Greenwich), in ms.
function zoneOffset(ts, timeZone) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-US', {timeZone, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric', second: 'numeric'})
    .formatToParts(ts).map(p => [p.type, p.value]));
  return Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - ts;
}

// UTC timestamp of a wall-clock time in a time zone; day overflow (e.g. Sep 36) rolls into the next month.
export function zonedTimeToUtc(y, m, d, h, timeZone = ROLLOVER.timeZone) {
  const wall = Date.UTC(y, m - 1, d, h);
  let ts = wall;
  for (let i = 0; i < 2; i++) ts = wall - zoneOffset(ts, timeZone);
  return ts;
}

// Start of each fantasy week: the Tuesday on or before Sleeper's season start date opens Week 1.
export function weekStarts(seasonStart, count = 25) {
  const [y, m, d] = String(seasonStart).split('-').map(Number);
  const back = (new Date(Date.UTC(y, m - 1, d)).getUTCDay() - ROLLOVER.weekday + 7) % 7;
  return Array.from({length: count}, (_, k) => zonedTimeToUtc(y, m, d - back + 7 * k, ROLLOVER.hour));
}

export function fantasyWeekAt(seasonStart, now = Date.now()) {
  const starts = weekStarts(seasonStart);
  let week = 1;
  while (week < starts.length && now >= starts[week]) week++;
  return week;
}

export const nextRollover = (seasonStart, now = Date.now()) => weekStarts(seasonStart).find(t => t > now) ?? null;
