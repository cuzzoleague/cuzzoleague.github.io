// All-time manager history across the league's linked Sleeper seasons.
import {round2} from './util.js';

const HISTORY_KEY = 'cuzzo-history-v1', HISTORY_TTL = 12 * 60 * 60 * 1000;

// Final places from Sleeper brackets. Consolation (losers) bracket places start after the playoff field.
export function bracketPlaces(winners, losers, playoffTeams) {
  const places = new Map();
  for (const [bracket, offset] of [[winners || [], 0], [losers || [], playoffTeams]]) {
    for (const match of bracket) {
      const p = Number(match.p);
      if (!p || match.w == null || match.l == null) continue;
      places.set(Number(match.w), offset + p);
      places.set(Number(match.l), offset + p + 1);
    }
  }
  return places;
}

export function buildSeason({league, users, rosters, winners, losers}) {
  const people = new Map((users || []).map(u => [String(u.user_id), u]));
  const playoffTeams = Number(league.settings?.playoff_teams || 0), complete = league.status === 'complete';
  const places = complete ? bracketPlaces(winners, losers, playoffTeams) : new Map();
  const teams = (rosters || []).filter(r => r.owner_id).map(r => {
    const user = people.get(String(r.owner_id)) || {}, s = r.settings || {};
    return {userId: String(r.owner_id), rosterId: Number(r.roster_id), manager: user.display_name || user.username || 'Manager', teamName: user.metadata?.team_name || '',
      avatar: user.avatar || '', wins: Number(s.wins || 0), losses: Number(s.losses || 0), ties: Number(s.ties || 0),
      pf: round2(Number(s.fpts || 0) + Number(s.fpts_decimal || 0) / 100), pa: round2(Number(s.fpts_against || 0) + Number(s.fpts_against_decimal || 0) / 100),
      finish: places.get(Number(r.roster_id)) || null, madePlayoffs: null};
  });
  const n = teams.length;
  const ranked = complete && n > 1 && teams.every(t => t.finish >= 1 && t.finish <= n) && new Set(teams.map(t => t.finish)).size === n;
  if (ranked) {
    const winPct = t => (t.wins + 0.5 * t.ties) / Math.max(1, t.wins + t.losses + t.ties);
    const lo = f => Math.min(...teams.map(f)), hi = f => Math.max(...teams.map(f));
    const share = (f, t) => hi(f) === lo(f) ? 0.5 : (f(t) - lo(f)) / (hi(f) - lo(f));
    for (const t of teams) {
      t.madePlayoffs = t.finish <= playoffTeams;
      t.legacy = round2(100 * (0.5 * (n - t.finish) / (n - 1) + 0.3 * share(winPct, t) + 0.2 * share(x => x.pf, t)));
    }
  }
  return {leagueId: String(league.league_id), year: String(league.season), name: league.name, status: league.status, complete, ranked, playoffTeams, teams};
}

export async function loadHistory(rootLeague, rootUsers, rootRosters, rootBrackets, get) {
  const seasons = [buildSeason({league: rootLeague, users: rootUsers, rosters: rootRosters, ...rootBrackets})];
  const seen = new Set([String(rootLeague.league_id)]);
  let previous = rootLeague.previous_league_id, error = '';
  for (let depth = 0; previous && previous !== '0' && depth < 25; depth++) {
    const id = String(previous);
    if (seen.has(id)) break;
    seen.add(id);
    try {
      const [league, users, rosters, winners, losers] = await Promise.all([get(`league/${id}`), get(`league/${id}/users`), get(`league/${id}/rosters`),
        get(`league/${id}/winners_bracket`).catch(() => []), get(`league/${id}/losers_bracket`).catch(() => [])]);
      seasons.push(buildSeason({league, users, rosters, winners, losers}));
      previous = league.previous_league_id;
    } catch (failure) { error = failure.message || 'Older seasons could not be loaded'; break; }
  }
  return {rootLeagueId: String(rootLeague.league_id), seasons: seasons.sort((a, b) => Number(b.year) - Number(a.year)), error};
}

export function readHistoryCache(rootLeagueId) {
  try {
    const saved = JSON.parse(localStorage.getItem(HISTORY_KEY));
    return saved?.history?.rootLeagueId === rootLeagueId && Date.now() - saved.savedAt < HISTORY_TTL ? saved.history : null;
  } catch { return null; }
}
export function writeHistoryCache(history) {
  try { localStorage.setItem(HISTORY_KEY, JSON.stringify({savedAt: Date.now(), history})); } catch { /* storage full or blocked */ }
}

// One row per manager (by Sleeper user id) across the chosen seasons.
export function managerTable(history, year = '') {
  const seasons = (history?.seasons || []).filter(s => !year || s.year === year);
  const rows = new Map();
  for (const season of seasons) for (const t of season.teams) {
    let row = rows.get(t.userId);
    if (!row) rows.set(t.userId, row = {userId: t.userId, manager: t.manager, teamName: t.teamName, avatar: t.avatar, seasons: 0, completed: 0,
      wins: 0, losses: 0, ties: 0, pf: 0, games: 0, titles: 0, runnerUps: 0, playoffs: 0, finishSum: 0, legacy: 0, bestFinish: null, years: []});
    row.seasons++; row.years.push(season.year);
    row.wins += t.wins; row.losses += t.losses; row.ties += t.ties; row.games += t.wins + t.losses + t.ties; row.pf += t.pf;
    if (season.ranked) {
      row.completed++; row.finishSum += t.finish; row.legacy += t.legacy || 0;
      if (t.finish === 1) row.titles++;
      if (t.finish === 2) row.runnerUps++;
      if (t.madePlayoffs) row.playoffs++;
      row.bestFinish = row.bestFinish == null ? t.finish : Math.min(row.bestFinish, t.finish);
    }
  }
  return [...rows.values()].map(r => ({...r, pf: round2(r.pf), legacy: round2(r.legacy),
    winPct: r.games ? (r.wins + 0.5 * r.ties) / r.games : 0, ppg: r.games ? r.pf / r.games : 0,
    avgFinish: r.completed ? r.finishSum / r.completed : null}));
}

export function champions(history) {
  return (history?.seasons || []).filter(s => s.ranked).map(s => ({year: s.year, champ: s.teams.find(t => t.finish === 1), runnerUp: s.teams.find(t => t.finish === 2)}));
}
