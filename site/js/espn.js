// ESPN's public scoreboard and game summaries supply NFL game clocks and play-by-play text.

const SITE = 'https://site.api.espn.com/apis/site/v2/sports/football/nfl';
const TEAM_FIX = {WSH: 'WAS'};
export const toSleeperTeam = abbr => TEAM_FIX[abbr] || abbr;

function clockSeconds(display) {
  const [m, s] = String(display || '0:00').split(':').map(Number);
  return (m || 0) * 60 + (s || 0);
}

// Share of regulation already played (0 before kickoff, 1 once final).
export function gameFraction(game) {
  if (!game || game.state === 'pre') return 0;
  if (game.state === 'post') return 1;
  if (game.statusName === 'STATUS_HALFTIME') return 0.5;
  if (game.period > 4) return 0.98;
  const elapsed = (Math.max(1, game.period) - 1) * 900 + (900 - Math.min(900, game.clockSeconds));
  return Math.min(0.98, Math.max(0.01, elapsed / 3600));
}

export function normalizeScoreboard(json) {
  return (json?.events || []).map(event => {
    const comp = event.competitions?.[0] || {}, status = comp.status || event.status || {};
    const side = homeAway => {
      const c = (comp.competitors || []).find(x => x.homeAway === homeAway) || {};
      return {id: String(c.team?.id || ''), abbr: toSleeperTeam(c.team?.abbreviation || ''), espnAbbr: c.team?.abbreviation || '', name: c.team?.shortDisplayName || c.team?.displayName || '', score: Number(c.score || 0), logo: c.team?.logo || '', record: (c.records || [])[0]?.summary || ''};
    };
    const game = {
      id: String(event.id), date: event.date, state: status.type?.state || 'pre', statusName: status.type?.name || '',
      detail: status.type?.shortDetail || status.type?.detail || '', period: Number(status.period || 0),
      clock: status.displayClock || '', clockSeconds: clockSeconds(status.displayClock), home: side('home'), away: side('away')
    };
    game.fraction = gameFraction(game);
    return game;
  });
}

export async function loadScoreboard(season, week, {fresh = false} = {}) {
  const response = await fetch(`${SITE}/scoreboard?dates=${season}&seasontype=2&week=${week}`, fresh ? {cache: 'no-store'} : undefined);
  if (!response.ok) throw new Error(`ESPN scoreboard unavailable (${response.status})`);
  return normalizeScoreboard(await response.json());
}

// Finished games never change, so their summaries are kept for the session.
const finished = new Map();
export async function loadSummary(eventId, {fresh = false} = {}) {
  if (finished.has(eventId)) return finished.get(eventId);
  const response = await fetch(`${SITE}/summary?event=${eventId}`, fresh ? {cache: 'no-store'} : undefined);
  if (!response.ok) throw new Error(`ESPN game feed unavailable (${response.status})`);
  const json = await response.json();
  if (json?.header?.competitions?.[0]?.status?.type?.state === 'post') finished.set(eventId, json);
  return json;
}

// Clock and score as reported inside a game summary (fetched separately from the scoreboard).
export function summaryStatus(summary) {
  const comp = summary?.header?.competitions?.[0];
  if (!comp) return null;
  const status = comp.status || {}, score = side => Number((comp.competitors || []).find(c => c.homeAway === side)?.score || 0);
  return {state: status.type?.state || null, statusName: status.type?.name || '', detail: status.type?.shortDetail || status.type?.detail || '',
    period: status.period != null ? Number(status.period) : null, clock: status.displayClock ?? null, home: score('home'), away: score('away')};
}

const STATE_ORDER = {pre: 0, in: 1, post: 2};
// The scoreboard and a game's summary update independently. Copy the summary's clock and score onto the
// scoreboard game when the summary is further along, so every view shows the freshest of the two.
export function mergeFresher(game, s) {
  if (!game || !s?.state) return false;
  const hasClock = s.period != null && s.clock != null;
  const mine = [STATE_ORDER[game.state] ?? 0, game.period || 0, -(game.clockSeconds || 0), game.home.score + game.away.score];
  const theirs = [STATE_ORDER[s.state] ?? 0, hasClock ? s.period : game.period || 0, hasClock ? -clockSeconds(s.clock) : -(game.clockSeconds || 0), s.home + s.away];
  const i = mine.findIndex((v, k) => v !== theirs[k]);
  if (i < 0 || theirs[i] < mine[i]) return false;
  Object.assign(game, {state: s.state, statusName: s.statusName || game.statusName, detail: s.detail || game.detail});
  if (hasClock) Object.assign(game, {period: s.period, clock: s.clock, clockSeconds: clockSeconds(s.clock)});
  game.home.score = s.home;
  game.away.score = s.away;
  game.fraction = gameFraction(game);
  return true;
}

export function gamesByTeam(games) {
  const map = new Map();
  for (const game of games) { map.set(game.home.abbr, game); map.set(game.away.abbr, game); }
  return map;
}
