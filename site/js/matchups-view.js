// Matchups tab: every matchup for a chosen week with live win odds, plus the fantasy play-by-play.
import {esc, fmt, pct, recordText, plural} from './util.js';
import {loadWeekly, loadMatchups} from './sleeper.js';
import {loadScoreboard, loadSummary, gamesByTeam} from './espn.js';
import {pointsFromStats, activeSlots, slotLabel} from './scoring.js';
import {lineupOutlook, teamModelOutlook, winProbability, isTossUp} from './winprob.js';
import {trackPlayers, fantasyFeed, periodLabel} from './plays.js';
import {pairsFor} from './analytics.js';
import {avatar} from './league-view.js';
import {LIVE_POLL_MS, IDLE_POLL_MS} from './config.js';

const $ = sel => document.querySelector(sel);
const INJURY = {Questionable: 'Q', Doubtful: 'D', Out: 'O', IR: 'IR', PUP: 'PUP', Sus: 'SUS', NA: 'NA', DNR: 'DNR', COV: 'COV'};
const mu = {week: null, pick: null, filter: 'all', game: '', timer: null, updatedAt: null, requestId: 0,
  scoreboards: new Map(), projections: new Map(), projTeams: new Map(), liveEntries: new Map(), models: [],
  feed: [], feedKey: '', feedGames: [], feedError: '', seen: new Set(), shownPoints: new Map(), flashUntil: new Map(), feedLoading: false};
let getCtx = () => null, isVisible = () => false, onLive = () => {};

// ---------------------------------------------------------------- data
const entriesFor = week => mu.liveEntries.get(week) || getCtx().weeks.get(week) || [];

async function scoreboardFor(week, fresh = false) {
  if (!fresh && mu.scoreboards.has(week)) return mu.scoreboards.get(week);
  try {
    const games = await loadScoreboard(getCtx().league.season, week, {fresh});
    mu.scoreboards.set(week, games);
    return games;
  } catch (error) {
    console.warn('Scoreboard unavailable', error);
    return mu.scoreboards.get(week) || null;
  }
}

async function projectionsFor(week) {
  if (mu.projections.has(week)) return mu.projections.get(week);
  const ctx = getCtx(), map = new Map();
  try {
    const rows = await loadWeekly('projections', ctx.league.season, week);
    for (const [id, row] of rows) {
      map.set(id, pointsFromStats(row.stats, ctx.league.scoring_settings));
      if (row.team) mu.projTeams.set(id, row.team);
    }
  } catch (error) { console.warn('Projections unavailable', error); }
  mu.projections.set(week, map);
  return map;
}

const playerTeam = id => getCtx().players?.[id]?.team || mu.projTeams.get(id) || (/^[A-Z]{2,3}$/.test(id) ? id : null);
const playerName = id => getCtx().players?.[id]?.name || (/^[A-Z]{2,3}$/.test(id) ? `${id} D/ST` : 'Loading…');
const shortName = id => {
  const p = getCtx().players?.[id];
  if (!p) return playerName(id);
  if (p.pos === 'DEF') return `${p.team || id} D/ST`;
  return p.first ? `${p.first[0]}. ${p.last}` : p.name;
};

function startersOf(entry) {
  if (entry?.starters?.length) return entry.starters.map(String);
  const roster = getCtx().rosters.find(r => Number(r.roster_id) === Number(entry?.roster_id));
  return (roster?.starters || []).map(String);
}

function kickoff(date) {
  const d = new Date(date);
  return Number.isNaN(d.getTime()) ? 'TBD' : d.toLocaleString([], {weekday: 'short', hour: 'numeric', minute: '2-digit'});
}
function gameLine(team, byTeam) {
  if (!team) return {text: 'Free agent', cls: ''};
  const g = byTeam.get(team);
  if (!g) return {text: byTeam.size ? 'Bye week' : team, cls: ''};
  const home = g.home.abbr === team, opp = home ? `vs ${g.away.abbr}` : `@ ${g.home.abbr}`;
  const mine = home ? g.home.score : g.away.score, theirs = home ? g.away.score : g.home.score;
  if (g.state === 'pre') return {text: `${opp} · ${kickoff(g.date)}`, cls: ''};
  if (g.state === 'in') return {text: `${opp} · ${g.detail} · ${mine}-${theirs}`, cls: 'in'};
  return {text: `${opp} · Final ${mine}-${theirs}`, cls: ''};
}

function weekState(games, week) {
  const ctx = getCtx();
  if (!games?.length) return week < ctx.nflWeek || ctx.seasonOver ? 'final' : 'upcoming';
  if (games.some(g => g.state === 'in')) return 'live';
  if (games.every(g => g.state === 'post')) return 'final';
  return games.some(g => g.state === 'post') ? 'partial' : 'upcoming';
}

function bracketLabel(week, a, b) {
  const ctx = getCtx(), start = Number(ctx.league.settings?.playoff_week_start || 99);
  if (week < start) return '';
  const round = week - start + 1, pair = new Set([a, b]);
  const find = list => (list || []).find(m => Number(m.r) === round && pair.has(Number(m.t1)) && pair.has(Number(m.t2)));
  const w = find(ctx.winners), l = find(ctx.losers);
  if (w) return Number(w.p) === 1 ? 'Championship' : Number(w.p) === 3 ? '3rd place' : Number(w.p) === 5 ? '5th place' : `Playoffs · Rd ${round}`;
  if (l) return 'Consolation';
  return 'Playoff week';
}

async function buildModels(week) {
  const ctx = getCtx();
  const [games, proj] = await Promise.all([scoreboardFor(week), projectionsFor(week)]);
  const byTeam = gamesByTeam(games || []), state = weekState(games, week);
  const progress = id => {
    const team = playerTeam(id);
    if (!games) return week < ctx.nflWeek || ctx.seasonOver ? 1 : 0;
    const g = team ? byTeam.get(team) : null;
    return g ? g.fraction : 1; // bye weeks and free agents have nothing left to play
  };
  const hasProj = proj.size > 0;
  const models = pairsFor(entriesFor(week)).filter(p => p.entries.length === 2).map(({matchupId, entries}) => {
    const sides = entries.map(entry => {
      const id = Number(entry.roster_id), starters = startersOf(entry), points = entry.players_points || {};
      const s = ctx.season.teams.get(id);
      let live = lineupOutlook({starters, points, projections: proj, progress});
      let pre = lineupOutlook({starters, points: {}, projections: proj, progress: () => 0});
      if (!hasProj) {
        const avg = s?.weekly.length ? s.avg : ctx.season.leagueAvg || 110, sd = s?.weekly.length > 1 ? Math.max(15, s.sd) : 25;
        pre = teamModelOutlook(avg, sd);
        if (state === 'upcoming') live = pre;
      }
      const done = starters.filter(p => p && p !== '0').every(p => progress(p) >= 1);
      return {id, entry, starters, points, live, pre, done, team: ctx.teams.get(id) || {name: `Team ${id}`}, stats: s};
    });
    const [a, b] = sides;
    const actualA = Number(a.entry.custom_points ?? a.entry.points ?? a.live.actual), actualB = Number(b.entry.custom_points ?? b.entry.points ?? b.live.actual);
    const started = sides.some(x => x.live.playing || x.live.yetToPlay < x.starters.length) && state !== 'upcoming';
    const final = (state === 'final' || (a.done && b.done)) && started;
    const status = final ? 'final' : sides.some(x => x.live.playing) ? 'live' : started ? 'partial' : 'upcoming';
    const preProb = winProbability(a.pre, b.pre);
    const prob = final ? (actualA > actualB ? 1 : actualA < actualB ? 0 : 0.5) : status === 'upcoming' ? preProb : winProbability(a.live, b.live);
    const upset = final && ((actualA > actualB && preProb < 0.4) || (actualB > actualA && preProb > 0.6));
    return {matchupId, week, a, b, actualA, actualB, status, prob, preProb, upset, tossUp: isTossUp(final ? preProb : prob), label: bracketLabel(week, a.id, b.id), hasProj};
  });
  return {models, games: games || [], state, byTeam, hasProj};
}

// ---------------------------------------------------------------- week board
const recordLine = s => s && s.games ? `${recordText(s.wins, s.losses, s.ties)} (${s.winPct.toFixed(3).replace(/^0/, '')})` : '0-0';

function sideHtml(m, side, key) {
  const t = side.team, score = key === 'a' ? m.actualA : m.actualB, other = key === 'a' ? m.actualB : m.actualA;
  const result = m.status === 'final' ? (score > other ? 'winner' : score < other ? 'loser' : '') : '';
  const sub = m.status === 'upcoming' ? `proj ${fmt(side.pre.expected)}` : m.status === 'final' ? (side.pre.projected ? `proj ${fmt(side.pre.expected)}` : '') : `proj ${fmt(side.live.expected)}`;
  return `<div class="side ${result}">${avatar(t)}<div style="min-width:0"><div class="side-name">${esc(t.name)}</div><div class="side-meta">${esc(t.manager || '')} · ${recordLine(side.stats)}</div></div>
    <div class="side-score">${m.status === 'upcoming' ? `<b>${fmt(side.pre.expected)}</b><small>projected</small>` : `<b>${fmt(score)}</b><small>${sub}</small>`}</div></div>`;
}

function cardHtml(m) {
  const tags = [
    m.label ? `<span class="pill playoff">${esc(m.label)}</span>` : '',
    m.status === 'live' ? '<span class="pill live">Live</span>' : m.status === 'final' ? '<span class="pill final">Final</span>' : '',
    m.tossUp ? `<span class="pill toss" title="${m.status === 'final' ? 'Pregame odds were within 42–58%' : 'Win odds within 42–58%'}">🪙 Coin flip</span>` : '',
    m.upset ? '<span class="pill upset">Upset</span>' : ''
  ].join('');
  const left = [m.a, m.b].reduce((t, s) => t + s.live.yetToPlay + s.live.playing, 0);
  const when = m.status === 'final' ? `Margin ${fmt(Math.abs(m.actualA - m.actualB))}` : m.status === 'upcoming' ? '' : `${plural(left, 'starter')} left`;
  const oddsLabel = m.status === 'final' ? 'Result' : m.status === 'upcoming' ? 'Win odds' : 'Live win odds';
  const pa = Math.round(m.prob * 100), pb = 100 - pa;
  return `<article class="matchup ${m.tossUp ? 'toss-up' : ''} ${mu.pick === m.matchupId ? 'selected' : ''}" data-matchup="${m.matchupId}" tabindex="0" aria-label="${esc(m.a.team.name)} versus ${esc(m.b.team.name)}. Show play-by-play.">
    <div class="matchup-top"><div class="tags">${tags || '<span class="pill">Matchup ' + m.matchupId + '</span>'}</div><span class="when">${when}</span></div>
    ${sideHtml(m, m.a, 'a')}${sideHtml(m, m.b, 'b')}
    <div class="odds" aria-label="${oddsLabel}: ${esc(m.a.team.name)} ${pa}%, ${esc(m.b.team.name)} ${pb}%"><div class="odds-bar"><i class="a" style="width:${pa}%"></i><i class="b" style="width:${pb}%"></i></div>
      <div class="odds-labels"><span class="a">${pa}%</span><em>${oddsLabel}</em><span class="b">${pb}%</span></div></div>
    ${m.status === 'final' ? `<p class="pregame">Pregame odds: ${Math.round(m.preProb * 100)}% – ${100 - Math.round(m.preProb * 100)}%${m.upset ? ' · the underdog won' : ''}</p>` : ''}
  </article>`;
}

function summaryHtml(models, state) {
  if (!models.length) return '';
  const name = s => esc(s.team.name), tile = (label, big, small) => `<div class="mini-tile"><small>${label}</small><strong>${big}</strong><span>${small}</span></div>`;
  const favorite = m => m.prob >= 0.5 ? [m.a, m.prob] : [m.b, 1 - m.prob];
  if (state === 'final') {
    const sides = models.flatMap(m => [[m.a, m.actualA], [m.b, m.actualB]]).sort((x, y) => y[1] - x[1]);
    const closest = [...models].sort((x, y) => Math.abs(x.actualA - x.actualB) - Math.abs(y.actualA - y.actualB))[0];
    const upset = models.filter(m => m.upset).sort((x, y) => Math.abs(y.preProb - 0.5) - Math.abs(x.preProb - 0.5))[0];
    const blowout = [...models].sort((x, y) => Math.abs(y.actualA - y.actualB) - Math.abs(x.actualA - x.actualB))[0];
    return tile('High score', fmt(sides[0][1]), name(sides[0][0])) +
      tile('Closest finish', fmt(Math.abs(closest.actualA - closest.actualB)), `${name(closest.a)} vs ${name(closest.b)}`) +
      (upset ? tile('Biggest upset', `${Math.round(Math.min(upset.preProb, 1 - upset.preProb) * 100)}%`, `${name(upset.actualA > upset.actualB ? upset.a : upset.b)} won as the underdog`) : tile('Biggest blowout', fmt(Math.abs(blowout.actualA - blowout.actualB)), `${name(blowout.actualA > blowout.actualB ? blowout.a : blowout.b)} rolled`)) +
      tile('Low score', fmt(sides.at(-1)[1]), name(sides.at(-1)[0]));
  }
  const closest = [...models].sort((x, y) => Math.abs(x.prob - 0.5) - Math.abs(y.prob - 0.5))[0];
  const lock = [...models].sort((x, y) => Math.abs(y.prob - 0.5) - Math.abs(x.prob - 0.5))[0], [fav, favP] = favorite(lock);
  const top = models.flatMap(m => [m.a, m.b]).sort((x, y) => y.live.expected - x.live.expected)[0];
  const flips = models.filter(m => m.tossUp).length;
  return tile('Closest matchup', `${Math.round(Math.max(closest.prob, 1 - closest.prob) * 100)}–${Math.round(Math.min(closest.prob, 1 - closest.prob) * 100)}`, `${name(closest.a)} vs ${name(closest.b)}`) +
    tile('Biggest favorite', pct(favP), name(fav)) +
    tile(state === 'upcoming' ? 'Top projection' : 'On pace for most', fmt(top.live.expected), name(top)) +
    tile('Coin flips', String(flips), flips ? 'highlighted in gold below' : 'no games within 42–58%');
}

function weekLabel(week) {
  const ctx = getCtx(), start = Number(ctx.league.settings?.playoff_week_start || 99);
  const tag = week < ctx.defaultWeek ? 'Final' : week === ctx.defaultWeek ? 'Current' : week === ctx.nflWeek ? 'Up next' : 'Upcoming';
  return `Week ${week} · ${ctx.seasonOver ? 'Final' : tag}${week >= start ? ' · Playoffs' : ''}`;
}

export function renderWeekSelect() {
  const ctx = getCtx(), select = $('#weekSelect');
  select.innerHTML = Array.from({length: ctx.lastWeek}, (_, i) => i + 1).map(w => `<option value="${w}" ${w === mu.week ? 'selected' : ''}>${weekLabel(w)}</option>`).join('');
  $('#thisWeekBtn').hidden = mu.week === ctx.defaultWeek;
}

export async function openWeek(week, {fresh = false} = {}) {
  const ctx = getCtx();
  if (!ctx) return;
  mu.week = Math.min(ctx.lastWeek, Math.max(1, Number(week) || ctx.defaultWeek));
  renderWeekSelect();
  const request = ++mu.requestId;
  if (fresh) {
    await Promise.all([scoreboardFor(mu.week, true), loadMatchups(ctx.league.league_id, mu.week, {fresh: true}).then(e => mu.liveEntries.set(mu.week, e)).catch(() => {})]);
  }
  if (!mu.models.length || mu.models[0]?.week !== mu.week) $('#matchupGrid').innerHTML = '<div class="empty">Loading matchups…</div>';
  const built = await buildModels(mu.week);
  if (request !== mu.requestId) return;
  mu.models = built.models;
  mu.byTeam = built.byTeam;
  mu.state = built.state;
  mu.games = built.games;
  renderWeekBoard();
  // Sleeper reuses matchup numbers every week, so a new week always starts from its own best pick.
  if (mu.pickWeek !== mu.week || !mu.models.some(m => m.matchupId === mu.pick)) { mu.pick = defaultPick(); mu.pickWeek = mu.week; }
  renderPicker();
  await refreshFeed({fresh});
  schedule();
}

function defaultPick() {
  const live = mu.models.find(m => m.status === 'live');
  if (live) return live.matchupId;
  const flips = [...mu.models].sort((x, y) => Math.abs((x.status === 'final' ? x.preProb : x.prob) - 0.5) - Math.abs((y.status === 'final' ? y.preProb : y.prob) - 0.5));
  return flips[0]?.matchupId ?? null;
}

function renderWeekBoard() {
  const ctx = getCtx(), state = mu.state, stateText = {live: 'Games in progress', final: 'Final', partial: 'In progress', upcoming: 'Upcoming'}[state];
  $('#weekTitle').textContent = `Week ${mu.week} matchups`;
  const firstGame = (mu.games || []).filter(g => g.state === 'pre').sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
  $('#weekSub').textContent = state === 'upcoming' && firstGame ? `${stateText} · first kickoff ${kickoff(firstGame.date)}` : `${stateText}${state === 'final' ? ' · every game is in the books' : state === 'live' ? ' · odds and scores refresh automatically' : ''}`;
  const placeholder = mu.models.length && mu.models.every(m => m.label === 'Playoff week') && state === 'upcoming';
  if (placeholder) $('#weekSub').textContent = 'Playoff bracket not set yet · these are Sleeper\x27s placeholder pairings until the regular season ends';
  $('#weekSummary').innerHTML = summaryHtml(mu.models, state === 'final' ? 'final' : state);
  $('#matchupGrid').innerHTML = mu.models.length ? mu.models.map(cardHtml).join('') : `<div class="empty">No matchups scheduled for Week ${mu.week}${mu.week >= Number(ctx.league.settings?.playoff_week_start || 99) ? ' yet. Playoff pairings appear once the bracket is set.' : '.'}</div>`;
  const hasProj = mu.models[0]?.hasProj;
  $('#oddsNote').textContent = `🪙 Gold cards are coin flips: win odds between 42% and 58%${state === 'final' ? ' before kickoff' : ''}. ${hasProj ? 'Odds blend Sleeper player projections with live scores; each player\'s remaining projection shrinks as their NFL game clock runs.' : 'Sleeper projections are not out for this week yet, so odds use each team\'s season scoring.'}`;
}

// ---------------------------------------------------------------- play-by-play
function renderPicker() {
  $('#pbpPicker').innerHTML = mu.models.map(m => `<button type="button" role="tab" class="pick ${m.tossUp ? 'toss-up' : ''}" data-matchup="${m.matchupId}" aria-selected="${m.matchupId === mu.pick}">
    <span>${esc(m.a.team.name)} vs ${esc(m.b.team.name)}</span><small>${m.status === 'upcoming' ? `${Math.round(m.prob * 100)}% – ${100 - Math.round(m.prob * 100)}%` : `${fmt(m.actualA)} – ${fmt(m.actualB)}`}${m.status === 'live' ? ' · live' : ''}</small></button>`).join('');
}

const currentModel = () => mu.models.find(m => m.matchupId === mu.pick);

async function refreshFeed({fresh = false} = {}) {
  const m = currentModel(), ctx = getCtx();
  if (!m) { $('#pbpBody').innerHTML = '<div class="empty">No matchups this week.</div>'; return; }
  const key = `${m.week}:${m.matchupId}`;
  if (key !== mu.feedKey) { mu.feedKey = key; mu.feed = []; mu.feedGames = []; mu.seen = new Set(); mu.game = ''; mu.feedError = ''; }
  renderPbp();
  let players = ctx.players;
  if (!players) {
    players = await ctx.playersReady.catch(() => ({}));
    if (key !== mu.feedKey) return;
  }
  const starters = [...m.a.starters, ...m.b.starters];
  const tracked = trackPlayers(starters, players || {});
  const teams = new Set(tracked.map(t => t.team).filter(Boolean));
  const games = (mu.games || []).filter(g => (teams.has(g.home.abbr) || teams.has(g.away.abbr)) && g.state !== 'pre');
  mu.feedGames = games;
  if (!games.length) { mu.feedLoading = false; renderPbp(); return; }
  mu.feedLoading = !mu.feed.length;
  if (mu.feedLoading) renderPbp();
  const results = await Promise.allSettled(games.map(g => loadSummary(g.id, {fresh: fresh && g.state === 'in'})));
  if (key !== mu.feedKey) return;
  const items = [];
  let failed = 0;
  for (const r of results) {
    if (r.status !== 'fulfilled') { failed++; continue; }
    items.push(...fantasyFeed(r.value, tracked, ctx.league.scoring_settings).items);
  }
  items.sort((x, y) => (Date.parse(y.wallclock) || 0) - (Date.parse(x.wallclock) || 0) || y.seq - x.seq);
  const firstLoad = !mu.feed.length;
  mu.feed = items;
  mu.feedError = failed ? `${plural(failed, 'game feed')} could not be loaded.` : '';
  mu.feedLoading = false;
  mu.updatedAt = new Date();
  renderPbp(firstLoad);
}

function lineupHtml(m, side, key) {
  const ctx = getCtx(), slots = activeSlots(ctx.league.roster_positions), proj = mu.projections.get(m.week) || new Map();
  const rows = slots.map((slot, i) => {
    const id = side.starters[i];
    if (!id || id === '0') return `<div class="slot"><span class="slot-pos">${slotLabel(slot)}</span><span class="slot-name" style="color:var(--muted)">Empty</span><span class="slot-pts">0.0</span></div>`;
    const pts = Number(side.points[id] || 0), game = gameLine(playerTeam(id), mu.byTeam || new Map());
    const prevKey = `${m.week}:${id}`, prev = mu.shownPoints.get(prevKey);
    if (prev != null && prev !== pts) mu.flashUntil.set(prevKey, Date.now() + 1500);
    mu.shownPoints.set(prevKey, pts);
    const changed = (mu.flashUntil.get(prevKey) || 0) > Date.now();
    const injury = m.week >= ctx.nflWeek && !ctx.seasonOver ? INJURY[ctx.players?.[id]?.injury] : null;
    return `<div class="slot ${changed ? 'flash' : ''}"><span class="slot-pos">${slotLabel(slot)}</span><span style="min-width:0"><span class="slot-name" title="${esc(playerName(id))}">${esc(shortName(id))}${injury ? ` <small class="inj" title="${esc(ctx.players[id].injury)}">${injury}</small>` : ''}</span><span class="slot-game ${game.cls}">${esc(game.text)}</span></span><span class="slot-pts">${fmt(pts)}<small>${proj.has(id) ? `proj ${fmt(proj.get(id))}` : ''}</small></span></div>`;
  }).join('');
  return `<div class="lineup ${key}"><h4>${esc(side.team.name)}</h4>${rows}</div>`;
}

function feedHtml(m) {
  const side = new Map([...m.a.starters.map(id => [id, 'a']), ...m.b.starters.map(id => [id, 'b'])]);
  const gameName = g => `${g.away.abbr} @ ${g.home.abbr}`;
  let items = mu.feed;
  if (mu.game) items = items.filter(x => x.gameId === mu.game);
  if (mu.filter === 'points') items = items.filter(x => x.involvements.some(i => i.pts !== 0));
  if (mu.filter === 'big') items = items.filter(x => x.involvements.some(i => Math.abs(i.pts) >= 5));
  const gameSelect = mu.feedGames.length > 1 ? `<label class="select-label" for="pbpGame">Game<select id="pbpGame"><option value="">All games (${mu.feedGames.length})</option>${mu.feedGames.map(g => `<option value="${g.id}" ${g.id === mu.game ? 'selected' : ''}>${gameName(g)} · ${g.state === 'in' ? g.detail : 'Final'}</option>`).join('')}</select></label>` : '';
  const tools = `<div class="feed-tools"><div class="seg" role="group" aria-label="Filter plays">${[['all', 'All plays'], ['points', 'Points only'], ['big', 'Big plays']].map(([k, l]) => `<button type="button" data-filter="${k}" aria-pressed="${mu.filter === k}">${l}</button>`).join('')}</div>${gameSelect}</div>`;
  if (mu.feedLoading) return tools + '<div class="empty">Loading plays…</div>';
  if (!mu.feedGames.length) {
    const next = (mu.games || []).filter(g => g.state === 'pre').sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
    return tools + `<div class="empty">${m.status === 'upcoming' || next ? `No snaps yet. Plays show up here as soon as the first game with one of these starters kicks off${next ? ` (${kickoff(next.date)})` : ''}.` : 'No play data for this week.'}</div>`;
  }
  if (!items.length) return tools + '<div class="empty">No plays match this filter yet.</div>';
  const html = items.slice(0, 300).map(x => {
    const sides = new Set(x.involvements.map(i => side.get(i.playerId)));
    const cls = sides.size > 1 ? 'both' : [...sides][0] || '';
    const big = x.involvements.some(i => Math.abs(i.pts) >= 5);
    const fresh = mu.seen.size && !mu.seen.has(x.id);
    const score = x.home ? `${x.away} ${x.awayScore} – ${x.home} ${x.homeScore}` : '';
    return `<li class="play ${cls} ${big ? 'big' : ''} ${fresh ? 'fresh' : ''}"><div class="play-top"><span>${periodLabel(x.period)} ${esc(x.clock)} · ${esc(x.away)} @ ${esc(x.home)}</span><span>${esc(score)}</span></div>
      <p class="play-text">${esc(x.text)}</p><div class="play-tags">${x.involvements.map(i => `<span class="ptag ${side.get(i.playerId) || ''}"><b>${i.pts > 0 ? '+' : ''}${fmt(i.pts, i.pts % 1 && Math.abs(i.pts * 10 % 1) > 0.001 ? 2 : 1)}</b>${esc(shortName(i.playerId))} · ${esc(i.label)}</span>`).join('')}</div></li>`;
  }).join('');
  mu.feed.forEach(x => mu.seen.add(x.id));
  return `${tools}<ol class="feed" aria-label="Plays, newest first">${html}</ol>`;
}

function renderPbp(firstLoad = false) {
  const m = currentModel();
  if (!m) return;
  if (firstLoad) mu.feed.forEach(x => mu.seen.add(x.id));
  const pa = Math.round(m.prob * 100);
  const mid = m.status === 'upcoming' ? `<div class="sb-scores"><span class="a">${fmt(m.a.pre.expected)}</span><em>proj</em><span class="b">${fmt(m.b.pre.expected)}</span></div><small>Kickoff odds ${pa}% – ${100 - pa}%</small>`
    : `<div class="sb-scores"><span class="a">${fmt(m.actualA)}</span><em>${m.status === 'final' ? 'final' : 'to'}</em><span class="b">${fmt(m.actualB)}</span></div><small>${m.status === 'final' ? `Pregame ${Math.round(m.preProb * 100)}% – ${100 - Math.round(m.preProb * 100)}%` : `Win odds ${pa}% – ${100 - pa}% · proj ${fmt(m.a.live.expected)} – ${fmt(m.b.live.expected)}`}</small>`;
  const scroll = document.querySelector('#pbpBody .feed')?.scrollTop || 0;
  $('#pbpBody').innerHTML = `<div class="scoreboard"><div class="sb-team a">${avatar(m.a.team, 'lg')}<div><strong>${esc(m.a.team.name)}</strong><small>${esc(m.a.team.manager || '')}</small></div></div><div class="sb-mid">${mid}</div><div class="sb-team b">${avatar(m.b.team, 'lg')}<div><strong>${esc(m.b.team.name)}</strong><small>${esc(m.b.team.manager || '')}</small></div></div></div>
    <div class="pbp-layout"><div class="lineups">${lineupHtml(m, m.a, 'a')}${lineupHtml(m, m.b, 'b')}</div><div>${feedHtml(m)}</div></div>
    <p class="pbp-note">Play values are estimated from ESPN's play-by-play using this league's scoring; the lineup totals come straight from Sleeper and are official. D/ST points-allowed bonuses are only settled at the end of each game.${mu.feedError ? ` ${esc(mu.feedError)}` : ''}</p>`;
  const feed = document.querySelector('#pbpBody .feed');
  if (feed) feed.scrollTop = scroll;
  renderLiveStatus();
}

function renderLiveStatus() {
  const el = $('#liveStatus'), ctx = getCtx();
  const liveGames = (mu.scoreboards.get(ctx.nflWeek) || []).filter(g => g.state === 'in').length;
  const viewingLive = mu.week === ctx.nflWeek && liveGames;
  const time = mu.updatedAt ? mu.updatedAt.toLocaleTimeString([], {hour: 'numeric', minute: '2-digit', second: '2-digit'}) : '';
  el.innerHTML = viewingLive ? `<span class="dot"></span>${plural(liveGames, 'NFL game')} live · auto-refreshing every ${LIVE_POLL_MS / 1000}s${time ? ` · updated ${time}` : ''}` : time ? `Updated ${time}` : '';
}

// ---------------------------------------------------------------- live polling
function schedule() {
  clearTimeout(mu.timer);
  const ctx = getCtx();
  if (!ctx || document.hidden) return;
  const games = mu.scoreboards.get(ctx.nflWeek) || [], now = Date.now();
  const live = games.some(g => g.state === 'in');
  onLive(live);
  const soon = games.some(g => g.state === 'pre' && Date.parse(g.date) - now < 20 * 60_000);
  const today = games.some(g => g.state === 'pre' && Date.parse(g.date) - now < 12 * 3600_000);
  const delay = live ? LIVE_POLL_MS : soon ? 60_000 : today ? IDLE_POLL_MS : null;
  if (delay) mu.timer = setTimeout(tick, delay);
}

async function tick() {
  const ctx = getCtx();
  try {
    await scoreboardFor(ctx.nflWeek, true);
    if (isVisible() && mu.week === ctx.nflWeek) {
      const entries = await loadMatchups(ctx.league.league_id, mu.week, {fresh: true}).catch(() => null);
      if (entries?.length) mu.liveEntries.set(mu.week, entries);
      const built = await buildModels(mu.week);
      Object.assign(mu, {models: built.models, byTeam: built.byTeam, state: built.state, games: built.games});
      renderWeekBoard();
      renderPicker();
      await refreshFeed({fresh: true});
    }
  } catch (error) { console.warn('Live refresh failed', error); }
  finally { mu.updatedAt = new Date(); renderLiveStatus(); schedule(); }
}

// Called once the app knows the current NFL week, so the Live badge works from either tab.
export async function primeLive() {
  const ctx = getCtx();
  if (!ctx || ctx.seasonOver) return;
  await scoreboardFor(ctx.nflWeek, true);
  schedule();
}

// ---------------------------------------------------------------- events
export function initMatchups({context, visible, onLiveChange, onWeekChange}) {
  getCtx = context; isVisible = visible; onLive = onLiveChange;
  $('#weekSelect').addEventListener('change', e => { openWeek(Number(e.target.value)); onWeekChange(Number(e.target.value)); });
  $('#thisWeekBtn').addEventListener('click', () => { openWeek(getCtx().defaultWeek); onWeekChange(getCtx().defaultWeek); });
  const choose = id => {
    mu.pick = id;
    document.querySelectorAll('.matchup').forEach(el => el.classList.toggle('selected', Number(el.dataset.matchup) === id));
    renderPicker();
    refreshFeed();
  };
  $('#matchupGrid').addEventListener('click', e => { const card = e.target.closest('.matchup'); if (card) { choose(Number(card.dataset.matchup)); $('#playbyplay').scrollIntoView({behavior: 'smooth', block: 'start'}); } });
  $('#matchupGrid').addEventListener('keydown', e => { const card = e.target.closest('.matchup'); if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); choose(Number(card.dataset.matchup)); $('#playbyplay').scrollIntoView({behavior: 'smooth', block: 'start'}); } });
  $('#pbpPicker').addEventListener('click', e => { const b = e.target.closest('.pick'); if (b) choose(Number(b.dataset.matchup)); });
  $('#pbpBody').addEventListener('click', e => { const b = e.target.closest('[data-filter]'); if (b) { mu.filter = b.dataset.filter; renderPbp(); } });
  $('#pbpBody').addEventListener('change', e => { if (e.target.id === 'pbpGame') { mu.game = e.target.value; renderPbp(); $('#pbpGame')?.focus(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && getCtx()) tick(); else clearTimeout(mu.timer); });
}

export const selectedWeek = () => mu.week;
export function resetLiveCaches() { mu.scoreboards.clear(); mu.liveEntries.clear(); mu.projections.clear(); }
