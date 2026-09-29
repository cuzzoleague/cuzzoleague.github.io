// The site is built for one league only. When Sleeper rolls the league over to a new season,
// the new league's ID can go here; older seasons are found through `previous_league_id`.
export const LEAGUE_ID = '1355263150177394688';
export const SITE_NAME = 'Cuzzo League';

// Live refresh cadence while NFL games are in progress (ms).
export const LIVE_POLL_MS = 30_000;
export const IDLE_POLL_MS = 5 * 60_000;
