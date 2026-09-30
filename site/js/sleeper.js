// Sleeper API access. Everything here is public and CORS-enabled, so the site needs no backend.

const API = 'https://api.sleeper.app';
const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
const PLAYER_CACHE = 'cuzzo-players-v2', PLAYER_KEY = 'https://cuzzo.local/players.json', PLAYER_TTL = 24 * 60 * 60 * 1000;

async function getJson(url, {fresh = false} = {}) {
  const response = await fetch(url, fresh ? {cache: 'no-store'} : undefined);
  if (!response.ok) throw new Error(response.status === 404 ? 'Sleeper could not find that data.' : `Sleeper is unavailable right now (${response.status}).`);
  return response.json();
}
export const sleeper = (path, options) => getJson(`${API}/v1/${path}`, options);

export async function loadLeagueCore(leagueId) {
  const [state, league, users, rosters, winners, losers] = await Promise.all([
    sleeper('state/nfl'), sleeper(`league/${leagueId}`), sleeper(`league/${leagueId}/users`), sleeper(`league/${leagueId}/rosters`),
    sleeper(`league/${leagueId}/winners_bracket`).catch(() => []), sleeper(`league/${leagueId}/losers_bracket`).catch(() => [])
  ]);
  if (!league?.league_id || !Array.isArray(users) || !Array.isArray(rosters)) throw new Error('Sleeper returned incomplete league data.');
  return {state, league, users, rosters, winners: winners || [], losers: losers || []};
}

export async function loadMatchups(leagueId, week, options) {
  const entries = await sleeper(`league/${leagueId}/matchups/${week}`, options);
  return Array.isArray(entries) ? entries : [];
}

export async function loadAllMatchups(leagueId, lastWeek) {
  const weeks = Array.from({length: lastWeek}, (_, i) => i + 1);
  const lists = await Promise.all(weeks.map(week => loadMatchups(leagueId, week).catch(() => [])));
  return new Map(weeks.map((week, i) => [week, lists[i]]));
}

export async function loadTransactions(leagueId, lastWeek) {
  const lists = await Promise.all(Array.from({length: lastWeek + 1}, (_, leg) => sleeper(`league/${leagueId}/transactions/${leg}`).catch(() => [])));
  return [...new Map(lists.flat().filter(Boolean).map(tx => [tx.transaction_id, tx])).values()];
}

// Weekly stat lines or projections for every fantasy-relevant player: Map<player_id, stats>.
const weeklyCache = new Map();
export async function loadWeekly(kind, season, week, {fresh = false} = {}) {
  const key = `${kind}:${season}:${week}`;
  if (!fresh && weeklyCache.has(key)) return weeklyCache.get(key);
  const query = POSITIONS.map(p => `position[]=${p}`).join('&');
  const request = getJson(`${API}/${kind}/nfl/${season}/${week}?season_type=regular&${query}`, {fresh}).then(rows => {
    const map = new Map();
    for (const row of rows || []) if (row?.player_id) map.set(String(row.player_id), {stats: row.stats || {}, player: row.player, team: row.team, opponent: row.opponent});
    return map;
  });
  weeklyCache.set(key, request);
  request.catch(() => weeklyCache.delete(key));
  return request;
}

// The full player directory is ~2.5 MB compressed, so a trimmed copy is kept in Cache Storage for a day.
function trimPlayers(raw) {
  const out = {};
  for (const [id, p] of Object.entries(raw || {})) {
    if (!p) continue;
    const position = p.position || (p.fantasy_positions || [])[0] || '';
    if (!['QB', 'RB', 'WR', 'TE', 'K', 'DEF', 'FB'].includes(position) && !(p.fantasy_positions || []).some(pos => POSITIONS.includes(pos))) continue;
    out[id] = {
      first: p.first_name || '', last: p.last_name || '',
      name: position === 'DEF' ? `${p.first_name || id} ${p.last_name || ''}`.trim() : (p.full_name || `${p.first_name || ''} ${p.last_name || ''}`.trim() || id),
      pos: position, fpos: p.fantasy_positions || [position], team: p.team || null, injury: p.injury_status || null, espn: p.espn_id || null,
      age: p.age || null, ht: p.height || null, wt: p.weight || null, exp: p.years_exp ?? null, college: p.college || null, num: p.number ?? null
    };
  }
  return out;
}
export async function loadPlayers() {
  const store = typeof caches !== 'undefined' ? await caches.open(PLAYER_CACHE).catch(() => null) : null;
  const cached = store ? await store.match(PLAYER_KEY).catch(() => null) : null;
  const savedAt = cached ? Number(cached.headers.get('x-saved-at') || 0) : 0;
  if (cached && Date.now() - savedAt < PLAYER_TTL) {
    try { return await cached.clone().json(); } catch { /* fall through to a fresh download */ }
  }
  try {
    const trimmed = trimPlayers(await getJson(`${API}/v1/players/nfl`));
    if (store) {
      const body = new Response(JSON.stringify(trimmed), {headers: {'content-type': 'application/json', 'x-saved-at': String(Date.now())}});
      store.put(PLAYER_KEY, body).catch(() => {});
    }
    return trimmed;
  } catch (error) {
    if (cached) return cached.json();
    throw error;
  }
}

// One player's stat lines and projections for a season, keyed by week (null = no game).
const logCache = new Map();
export function loadPlayerLog(id, season) {
  const key = `${id}:${season}`;
  if (!logCache.has(key)) {
    const query = `season_type=regular&season=${season}&grouping=week`;
    logCache.set(key, Promise.all([
      getJson(`${API}/stats/nfl/player/${id}?${query}`).catch(() => ({})),
      getJson(`${API}/projections/nfl/player/${id}?${query}`).catch(() => ({}))
    ]).then(([stats, proj]) => ({stats: stats || {}, proj: proj || {}})));
  }
  return logCache.get(key);
}

const scheduleCache = new Map();
export function loadSchedule(season) {
  if (!scheduleCache.has(season)) scheduleCache.set(season, getJson(`${API}/schedule/nfl/regular/${season}`).catch(() => []));
  return scheduleCache.get(season);
}

export const isTeamId = id => /^[A-Z]{2,3}$/.test(String(id));
export const playerPhotoUrl = id => isTeamId(id)
  ? `https://sleepercdn.com/images/team_logos/nfl/${String(id).toLowerCase()}.png`
  : `https://sleepercdn.com/content/nfl/players/thumb/${id}.jpg`;

export const avatarUrl = (user, size = 'thumbs') => {
  const custom = user?.metadata?.avatar;
  if (custom && /^https:\/\//.test(custom)) return custom;
  return user?.avatar ? `https://sleepercdn.com/avatars/${size}/${user.avatar}` : '';
};
