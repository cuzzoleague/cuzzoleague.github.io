// Boots the site: loads league data from Sleeper, runs the analytics, and wires up tabs and controls.
import {LEAGUE_ID} from './config.js';
import {loadLeagueCore, loadAllMatchups, loadTransactions, loadPlayers, loadWeekly, sleeper, avatarUrl} from './sleeper.js';
import {analyzeSeason, entryPoints} from './analytics.js';
import {gradeMoves, weeklyPointsLookup} from './moves.js';
import {loadHistory, readHistoryCache, writeHistoryCache, buildSeason, champions} from './history.js';
import {pointsFromStats, optimalLineup, positionsOf} from './scoring.js';
import {esc, clamp, recordText} from './util.js';
import {fantasyWeekAt, nextRollover} from './weeks.js';
import * as League from './league-view.js';
import * as Matchups from './matchups-view.js';

const $ = sel => document.querySelector(sel);
const SIMS = 4000, STALE_MS = 15 * 60_000;
let ctx = null, tab = 'league', loadedAt = 0, loading = null, rolloverTimer = null;

// ---------------------------------------------------------------- chrome: theme, toast, info, menu
function currentTheme() {
  const set = document.documentElement.dataset.theme;
  return set || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
}
$('#themeToggle').addEventListener('click', () => {
  const next = currentTheme() === 'dark' ? 'light' : 'dark';
  document.documentElement.dataset.theme = next;
  try { localStorage.setItem('cuzzo-theme', next); } catch { /* private mode */ }
});

function toast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer = setTimeout(() => el.classList.remove('show'), 2600);
}

document.addEventListener('click', event => {
  const button = event.target.closest('.info-btn');
  if (!button) return;
  event.preventDefault();
  event.stopPropagation();
  const info = League.METRIC_INFO[button.dataset.info];
  if (!info) return;
  $('#infoTitle').textContent = info.title;
  $('#infoBody').textContent = info.body;
  $('#infoExample').textContent = info.example;
  $('#infoDialog').showModal();
});

const jumpMenu = $('#jumpMenu'), jumpToggle = $('#jumpToggle');
function setJump(open) { jumpMenu.hidden = !open; jumpToggle.setAttribute('aria-expanded', String(open)); }
jumpToggle.addEventListener('click', e => { e.stopPropagation(); setJump(jumpMenu.hidden); });
document.addEventListener('click', e => { if (!e.target.closest('.jump-wrap')) setJump(false); });
document.addEventListener('keydown', e => { if (e.key === 'Escape' && !jumpMenu.hidden) { setJump(false); jumpToggle.focus(); } });
jumpMenu.addEventListener('click', e => {
  const link = e.target.closest('a');
  if (!link) return;
  e.preventDefault();
  setJump(false);
  document.getElementById(link.dataset.target)?.scrollIntoView({behavior: 'smooth', block: 'start'});
});
function buildJumpMenu() {
  const sections = [...document.querySelectorAll(`[data-view="${tab}"] [data-section]`)];
  jumpMenu.innerHTML = sections.map(s => `<a href="#${s.id}" data-target="${s.id}">${esc(s.dataset.section)}</a>`).join('');
}

// ---------------------------------------------------------------- tabs + routing
function parseHash() {
  const [name, week] = location.hash.replace(/^#/, '').split('/');
  return {name: name === 'matchups' ? 'matchups' : 'league', week: Number((week || '').replace('week-', '')) || null};
}
function setTab(name, {week = null} = {}) {
  tab = name;
  document.querySelectorAll('.view').forEach(v => { v.hidden = v.dataset.view !== name; });
  document.querySelectorAll('.tab').forEach(t => { if (t.dataset.tabLink === name) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current'); });
  document.title = name === 'matchups' ? 'Matchups · Cuzzo League' : 'Cuzzo League';
  buildJumpMenu();
  if (name === 'matchups' && ctx) Matchups.openWeek(week || Matchups.selectedWeek() || ctx.defaultWeek);
}
window.addEventListener('hashchange', () => { const route = parseHash(); setTab(route.name, route); });
document.querySelectorAll('[data-tab-link]').forEach(link => link.addEventListener('click', e => {
  const name = link.dataset.tabLink;
  if (name === tab && !location.hash.includes('/')) { e.preventDefault(); window.scrollTo({top: 0, behavior: 'smooth'}); }
}));

// ---------------------------------------------------------------- data loading
function teamDirectory(users, rosters) {
  const people = new Map(users.map(u => [String(u.user_id), u]));
  return new Map(rosters.map(r => {
    const user = people.get(String(r.owner_id)) || {};
    const manager = user.display_name || user.username || 'Open team';
    return [Number(r.roster_id), {rosterId: Number(r.roster_id), userId: String(r.owner_id || ''), manager, name: user.metadata?.team_name?.trim() || manager, avatar: avatarUrl(user)}];
  }));
}

function renderHero() {
  const {league, defaultWeek, lastWeek, seasonOver, preseason, season, teams} = ctx;
  $('#heroEyebrow').textContent = seasonOver ? `${league.season} season · final` : preseason ? `${league.season} season · draft day is coming` : `${league.season} season · Week ${defaultWeek} of ${lastWeek}`;
  const leader = [...season.teams.values()].sort((a, b) => a.seed - b.seed)[0];
  const top = [...season.teams.values()].sort((a, b) => a.powerRank - b.powerRank)[0];
  const champ = champions(ctx.history).find(c => c.year !== String(league.season) || seasonOver);
  const chips = [
    `<span class="hero-chip"><b>${teams.size}</b> teams</span>`,
    season.playedWeeks.length && leader ? `<span class="hero-chip">1st place <b>${esc(teams.get(leader.id)?.name)}</b> ${recordText(leader.wins, leader.losses, leader.ties)}</span>` : '',
    season.playedWeeks.length && top && top.id !== leader?.id ? `<span class="hero-chip">#1 in power <b>${esc(teams.get(top.id)?.name)}</b></span>` : '',
    champ?.champ ? `<span class="hero-chip">🏆 ${champ.year} champ <b>${esc(champ.champ.manager)}</b></span>` : '',
    `<span class="hero-chip">Playoffs start <b>Week ${Number(league.settings?.playoff_week_start || 15)}</b></span>`
  ];
  $('#heroChips').innerHTML = chips.join('');
}

function renderLeague() {
  League.renderRankings(ctx);
  League.renderAwards(ctx);
  League.renderHeatmap(ctx);
  League.renderSwaps(ctx);
  League.renderProfiles(ctx);
  League.renderMoves(ctx);
  League.renderBump(ctx);
  League.renderHistory(ctx);
}

function benchPoints() {
  const out = new Map(), slots = ctx.league.roster_positions;
  for (const week of ctx.season.playedWeeks) for (const entry of ctx.weeks.get(week) || []) {
    const id = Number(entry.roster_id), pts = entry.players_points || {};
    const best = optimalLineup((entry.players || []).map(p => ({id: String(p), pts: Number(pts[p] || 0), positions: positionsOf(String(p), ctx.players)})), slots).total;
    const gap = Math.max(0, best - entryPoints(entry));
    const row = out.get(id) || {total: 0, worst: {week, gap: -1}};
    row.total += gap;
    if (gap > row.worst.gap) row.worst = {week, gap};
    out.set(id, row);
  }
  return out;
}

async function loadSecondary(current) {
  // All-time history: prior seasons never change, so they're cached; the current season is always rebuilt.
  const historyJob = (async () => {
    const {league, users, rosters, winners, losers} = current;
    const cached = readHistoryCache(String(league.league_id));
    const now = buildSeason({league, users, rosters, winners, losers});
    if (cached) return {...cached, seasons: [now, ...cached.seasons.filter(s => s.leagueId !== now.leagueId)]};
    const history = await loadHistory(league, users, rosters, {winners, losers}, sleeper);
    writeHistoryCache(history);
    return history;
  })().then(history => { if (ctx === current) { ctx.history = history; League.renderHistory(ctx); renderHero(); } })
    .catch(error => { if (ctx === current) { ctx.historyError = error.message; League.renderHistory(ctx); } });

  const playersJob = current.playersReady.then(players => {
    if (ctx !== current) return;
    ctx.players = players;
    ctx.bench = benchPoints();
    League.renderAwards(ctx);
    League.renderReport(ctx);
  }).catch(error => console.warn('Player directory unavailable', error));

  const movesJob = (async () => {
    const [transactions, players] = await Promise.all([loadTransactions(LEAGUE_ID, current.lastWeek), current.playersReady]);
    const statsByWeek = new Map(await Promise.all(current.season.playedWeeks.map(async w => [w, await loadWeekly('stats', current.league.season, w).catch(() => new Map())])));
    const pointsFor = weeklyPointsLookup(current.weeks, statsByWeek, stats => pointsFromStats(stats, current.league.scoring_settings));
    return gradeMoves({transactions, weeks: current.weeks, completedWeeks: current.season.playedWeeks, rosterPositions: current.league.roster_positions, players, pointsFor});
  })().then(moves => { if (ctx === current) { ctx.moves = moves; League.renderMoves(ctx); League.renderAwards(ctx); } })
    .catch(error => { console.error(error); if (ctx === current) { ctx.movesError = error.message || 'Sleeper data unavailable'; League.renderMoves(ctx); League.renderAwards(ctx); } });

  await Promise.allSettled([historyJob, playersJob, movesJob]);
}

async function load({quiet = false} = {}) {
  if (loading) return loading;
  const button = $('#refreshBtn');
  button.classList.add('spinning');
  loading = (async () => {
    try {
      const {state, league, users, rosters, winners, losers} = await loadLeagueCore(LEAGUE_ID);
      const playoffStart = Number(league.settings?.playoff_week_start || 15), playoffTeams = Number(league.settings?.playoff_teams || 6);
      const rounds = Math.max(Math.ceil(Math.log2(Math.max(2, playoffTeams))), ...winners.map(m => Number(m.r) || 0));
      const regularWeeks = playoffStart - 1, lastWeek = regularWeeks + rounds;
      const sameSeason = String(state.season) === String(league.season);
      const seasonOver = league.status === 'complete' || Number(state.season) > Number(league.season);
      const preseason = !seasonOver && (['pre_draft', 'drafting'].includes(league.status) || (sameSeason && state.season_type === 'pre'));
      // The site's "current" week turns over every Tuesday at 8 AM Pacific (see weeks.js), rather than
      // waiting for Sleeper's app, which holds the old week until waivers run. Sleeper's own week is the fallback.
      const rollWeek = sameSeason && state.season_start_date ? fantasyWeekAt(state.season_start_date) : null;
      const nflWeek = seasonOver ? lastWeek : preseason ? 1 : clamp(Math.max(Number(state.week || 1), rollWeek || 0), 1, lastWeek);
      const defaultWeek = seasonOver ? lastWeek : preseason ? 1 : clamp(rollWeek ?? Number(state.display_week || state.week || 1), 1, lastWeek);
      const weeks = await loadAllMatchups(LEAGUE_ID, lastWeek);
      const completed = [], remaining = [];
      for (let w = 1; w <= regularWeeks; w++) (seasonOver || (!preseason && w < nflWeek) ? completed : remaining).push(w);
      const teams = teamDirectory(users, rosters);
      const season = analyzeSeason({rosterIds: [...teams.keys()], weeks, completedWeeks: completed, remainingWeeks: remaining, rosterPositions: league.roster_positions, playoffTeams, seed: `${league.league_id}:${completed.length}`, sims: SIMS});
      const previous = ctx, players = previous?.players || null;
      ctx = {state, league, users, rosters, winners, losers, weeks, teams, season, nflWeek, defaultWeek, lastWeek, seasonOver, preseason, sims: SIMS,
        players, playersReady: players ? Promise.resolve(players) : loadPlayers(), moves: null, movesError: '', history: previous?.history || null, historyError: '', bench: null};
      const current = ctx;
      current.playersReady.then(p => { current.players = p; }).catch(() => {});
      if (players) ctx.bench = benchPoints();
      loadedAt = Date.now();
      renderHero();
      renderLeague();
      loadSecondary(current);
      // Anyone parked on the old current week moves along with the rollover; a week they picked stays put.
      const picked = parseHash().week || (previous && Matchups.selectedWeek() !== previous.defaultWeek ? Matchups.selectedWeek() : null);
      if (tab === 'matchups') await Matchups.openWeek(picked || defaultWeek, {fresh: Boolean(previous)});
      clearTimeout(rolloverTimer);
      const rollAt = !seasonOver && sameSeason && state.season_start_date ? nextRollover(state.season_start_date) : null;
      if (rollAt && rollAt - Date.now() < 2 ** 31 - 1) rolloverTimer = setTimeout(() => load({quiet: true}), rollAt - Date.now() + 5000);
      Matchups.primeLive();
      if (!quiet) toast('League synced from Sleeper');
    } catch (error) {
      console.error(error);
      toast(error.message || 'Could not reach Sleeper');
      if (!ctx) {
        const msg = `<li class="empty">Couldn't load the league from Sleeper. ${esc(error.message || '')} Try the refresh button.</li>`;
        $('#rankList').innerHTML = msg;
        $('#matchupGrid').innerHTML = msg.replace('<li', '<div').replace('</li>', '</div>');
      }
    } finally {
      button.classList.remove('spinning');
      loading = null;
    }
  })();
  return loading;
}

$('#refreshBtn').addEventListener('click', () => { Matchups.resetLiveCaches(); load(); });
document.addEventListener('visibilitychange', () => { if (!document.hidden && ctx && Date.now() - loadedAt > STALE_MS) load({quiet: true}); });

League.bindRankings(() => ctx);
League.bindMoves(() => ctx);
League.bindBump();
League.bindHistory(() => ctx);
Matchups.initMatchups({
  context: () => ctx,
  visible: () => tab === 'matchups' && !document.hidden,
  onLiveChange: live => { $('#tabLive').hidden = !live; },
  onWeekChange: week => { history.replaceState(null, '', week === ctx.defaultWeek ? '#matchups' : `#matchups/week-${week}`); }
});

setTab(parseHash().name, parseHash());
load({quiet: true});
