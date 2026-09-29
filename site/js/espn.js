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
      return {id: String(c.team?.id || ''), abbr: toSleeperTeam(c.team?.abbreviation || ''), espnAbbr: c.team?.abbreviation || '', name: c.team?.shortDisplayName || c.team?.displayName || '', score: Number(c.score || 0), logo: c.team?.logo || ''};
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

export function gamesByTeam(games) {
  const map = new Map();
  for (const game of games) { map.set(game.home.abbr, game); map.set(game.away.abbr, game); }
  return map;
}
