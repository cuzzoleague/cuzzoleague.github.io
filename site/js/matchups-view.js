// Matchups tab: every matchup for a chosen week with live win odds, plus a play-by-play for any league
// matchup or NFL game.
import {esc, fmt, pct, recordText, plural} from './util.js';
import {loadWeekly, loadMatchups, isTeamId} from './sleeper.js';
import {loadScoreboard, loadSummary, gamesByTeam} from './espn.js';
import {pointsFromStats, activeSlots, slotLabel} from './scoring.js';
import {lineupOutlook, teamModelOutlook, winProbability, isTossUp} from './winprob.js';
import {trackPlayers, fantasyFeed, periodLabel} from './plays.js';
import {pairsFor} from './analytics.js';
import {avatar} from './league-view.js';
import {LIVE_POLL_MS, IDLE_POLL_MS} from './config.js';
import {POSITIONS, POSITION_NAMES, positionOf, fullName, shortName, photo, ownerIndex, ownerText, statLine, kickoffSlot} from './player-ui.js';

const $ = sel => document.querySelector(sel);
const INJURY = {Questionable: 'Q', Doubtful: 'D', Out: 'O', IR: 'IR', PUP: 'PUP', Sus: 'SUS', NA: 'NA', DNR: 'DNR', COV: 'COV'};
// pick is null until someone chooses: {kind: 'matchup', id: matchupId} or {kind: 'game', id: espnEventId}.
const mu = {week: null, pick: null, pickWeek: null, filter: 'all', game: '', gameTab: 'overview', gameCands: null, gameLoading: false, timer: null, updatedAt: null, requestId: 0,
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
  return `<article class="matchup ${m.tossUp ? 'toss-up' : ''} ${pickIs('matchup', m.matchupId) ? 'selected' : ''}" data-matchup="${m.matchupId}" tabindex="0" aria-label="${esc(m.a.team.name)} versus ${esc(m.b.team.name)}. Show play-by-play.">
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
  const tag = week < ctx.defaultWeek ? 'Final' : week === ctx.defaultWeek ? 'Current' : week === ctx.defaultWeek + 1 ? 'Up next' : 'Upcoming';
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
  // Nothing is preselected: a fresh load or a new week waits for the viewer to choose.
  if (mu.pickWeek !== mu.week) { mu.pick = null; mu.pickWeek = mu.week; }
  else if (mu.pick && !(currentModel() || currentGame())) mu.pick = null;
  renderPicker();
  await refreshFeed({fresh});
  schedule();
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

// ---------------------------------------------------------------- play-by-play: picker
const scoring = () => getCtx().league.scoring_settings;
const pickIs = (kind, id) => mu.pick?.kind === kind && String(mu.pick.id) === String(id);
const currentModel = () => mu.pick?.kind === 'matchup' ? mu.models.find(m => m.matchupId === mu.pick.id) : null;
const currentGame = () => mu.pick?.kind === 'game' ? (mu.games || []).find(g => g.id === mu.pick.id) : null;

function gameStatus(g) {
  if (g.state === 'pre') return kickoff(g.date);
  if (g.state === 'in') return `${g.detail} · ${g.away.score}–${g.home.score}`;
  return `Final ${g.away.score}–${g.home.score}`;
}

// How many Cuzzo starters play for each NFL team this week, so the picker shows which games matter.
function starterCounts() {
  const counts = new Map();
  for (const [pid, owner] of ownerIndex(getCtx(), mu.week)) {
    const team = owner.starter ? playerTeam(pid) : null;
    if (team) counts.set(team, (counts.get(team) || 0) + 1);
  }
  return counts;
}

// Chip numbers always read in matchup order (first team, then second). Scores are gray until someone
// scores; once games finish, green/red mark the actual winner/loser; before that, the projected ones.
export function chipNumbers(m) {
  const inProgress = m.status === 'live' || m.status === 'partial';
  const projA = inProgress ? m.a.live.expected : m.a.pre.expected, projB = inProgress ? m.b.live.expected : m.b.pre.expected;
  let toneA = 'z', toneB = 'z';
  if (m.actualA || m.actualB) {
    const aAhead = m.status === 'final' ? Math.sign(m.actualA - m.actualB) : (m.prob >= 0.5 ? 1 : -1);
    if (aAhead) [toneA, toneB] = aAhead > 0 ? ['g', 'r'] : ['r', 'g'];
  }
  return {projA, projB, toneA, toneB};
}

function renderPicker() {
  const matchups = mu.models.map(m => {
    const n = chipNumbers(m);
    return `<button type="button" class="pick league ${m.tossUp ? 'toss-up' : ''} ${m.status === 'live' ? 'is-live' : ''}" data-pick="matchup:${m.matchupId}" aria-pressed="${pickIs('matchup', m.matchupId)}">
    <span>${esc(m.a.team.name)} vs ${esc(m.b.team.name)}</span><small class="chip-line"><b class="chip-proj"><em>proj</em>${fmt(n.projA)} – ${fmt(n.projB)}</b><b class="chip-score"><i class="sc-${n.toneA}">${fmt(m.actualA)}</i> – <i class="sc-${n.toneB}">${fmt(m.actualB)}</i></b></small></button>`;
  }).join('');
  const counts = starterCounts(), slots = [];
  for (const g of [...(mu.games || [])].sort((a, b) => Date.parse(a.date) - Date.parse(b.date))) {
    const label = kickoffSlot(g.date);
    if (!slots.length || slots.at(-1).label !== label) slots.push({label, games: []});
    slots.at(-1).games.push(g);
  }
  const chip = g => {
    const cuzzo = (counts.get(g.away.abbr) || 0) + (counts.get(g.home.abbr) || 0);
    return `<button type="button" class="pick game ${g.state === 'in' ? 'is-live' : ''}" data-pick="game:${g.id}" aria-pressed="${pickIs('game', g.id)}"><span>${esc(g.away.abbr)} @ ${esc(g.home.abbr)}</span><small>${esc(gameStatus(g))}</small>${cuzzo ? `<em>${plural(cuzzo, 'Cuzzo starter')}</em>` : ''}</button>`;
  };
  $('#pbpPicker').innerHTML = `<div class="pick-group"><div class="pick-label">League matchups</div><div class="pick-row">${matchups || '<span class="pick-empty">No matchups this week</span>'}</div></div>
    <div class="pick-group"><div class="pick-label">NFL games · in kickoff order</div>${slots.length ? `<div class="game-slots">${slots.map(s => `<div class="game-slot"><span class="slot-title">${esc(s.label)}</span><div class="pick-row wrap">${s.games.map(chip).join('')}</div></div>`).join('')}</div>` : '<span class="pick-empty">The NFL schedule is unavailable right now.</span>'}</div>`;
}

function renderPrompt() {
  $('#pbpBody').innerHTML = `<div class="report-prompt"><span aria-hidden="true">👆</span><p><b>Nothing selected yet</b>Pick one of your league's matchups or any NFL game above to follow it play by play. Tap any player to see their fantasy history.</p></div>`;
  renderLiveStatus();
}

async function refreshFeed({fresh = false} = {}) {
  if (!mu.pick) { mu.feedKey = ''; renderPrompt(); return; }
  return mu.pick.kind === 'game' ? refreshGame({fresh}) : refreshMatchup({fresh});
}

// ---------------------------------------------------------------- play-by-play: shared bits
const feedTools = (filters, extra = '') => `<div class="feed-tools"><div class="seg" role="group" aria-label="Filter plays">${filters.map(([k, l]) => `<button type="button" data-filter="${k}" aria-pressed="${mu.filter === k}">${l}</button>`).join('')}</div>${extra}</div>`;

function filterPlays(items, owners) {
  if (mu.game) items = items.filter(x => x.gameId === mu.game);
  if (mu.filter === 'points') return items.filter(x => x.involvements.some(i => i.pts !== 0));
  if (mu.filter === 'big') return items.filter(x => x.involvements.some(i => Math.abs(i.pts) >= 5));
  if (mu.filter === 'cuzzo') return items.filter(x => x.involvements.some(i => owners?.has(i.playerId)));
  return items;
}

// A player chip inside a play: photo, name, what they did, the points, and (in NFL game view) their Cuzzo owner.
function playTag(inv, cls, owner) {
  const players = getCtx().players, digits = Math.abs(inv.pts * 10 % 1) > 0.001 ? 2 : 1;
  const sub = owner === undefined ? '' : `<small>${esc(ownerText(owner))}</small>`;
  return `<button type="button" class="ptag ${cls}" data-player="${esc(inv.playerId)}">${photo(inv.playerId, players, 'xs')}<span class="ptag-who"><span>${esc(shortName(inv.playerId, players))} · ${esc(inv.label)}</span>${sub}</span><b>${inv.pts > 0 ? '+' : ''}${fmt(inv.pts, digits)}</b></button>`;
}

function playItem(x, cls, tags) {
  const big = x.involvements.some(i => Math.abs(i.pts) >= 5), fresh = mu.seen.size && !mu.seen.has(x.id);
  const score = x.home ? `${x.away} ${x.awayScore} – ${x.home} ${x.homeScore}` : '';
  return `<li class="play ${cls} ${big ? 'big' : ''} ${fresh ? 'fresh' : ''}"><div class="play-top"><span>${periodLabel(x.period)} ${esc(x.clock)} · ${esc(x.away)} @ ${esc(x.home)}</span><span>${esc(score)}</span></div>
    <p class="play-text">${esc(x.text)}</p><div class="play-tags">${tags}</div></li>`;
}

function keepFeedScroll(paint) {
  const scroll = document.querySelector('#pbpBody .feed')?.scrollTop || 0;
  paint();
  const feed = document.querySelector('#pbpBody .feed');
  if (feed) feed.scrollTop = scroll;
  renderLiveStatus();
}

// ---------------------------------------------------------------- play-by-play: league matchup
async function refreshMatchup({fresh = false} = {}) {
  const m = currentModel(), ctx = getCtx();
  if (!m) { mu.pick = null; renderPrompt(); return; }
  const key = `m:${m.week}:${m.matchupId}`;
  if (key !== mu.feedKey) Object.assign(mu, {feedKey: key, feed: [], feedGames: [], seen: new Set(), game: '', feedError: ''});
  renderMatchup();
  const players = ctx.players || await ctx.playersReady.catch(() => ({}));
  if (key !== mu.feedKey) return;
  const tracked = trackPlayers([...m.a.starters, ...m.b.starters], players || {});
  const teams = new Set(tracked.map(t => t.team).filter(Boolean));
  const games = (mu.games || []).filter(g => (teams.has(g.home.abbr) || teams.has(g.away.abbr)) && g.state !== 'pre');
  mu.feedGames = games;
  if (!games.length) { mu.feedLoading = false; renderMatchup(); return; }
  mu.feedLoading = !mu.feed.length;
  if (mu.feedLoading) renderMatchup();
  const results = await Promise.allSettled(games.map(g => loadSummary(g.id, {fresh: fresh && g.state === 'in'})));
  if (key !== mu.feedKey) return;
  const items = [];
  let failed = 0;
  for (const r of results) {
    if (r.status !== 'fulfilled') { failed++; continue; }
    items.push(...fantasyFeed(r.value, tracked, scoring()).items);
  }
  items.sort((x, y) => (Date.parse(y.wallclock) || 0) - (Date.parse(x.wallclock) || 0) || y.seq - x.seq);
  const firstLoad = !mu.feed.length;
  Object.assign(mu, {feed: items, feedError: failed ? `${plural(failed, 'game feed')} could not be loaded.` : '', feedLoading: false, updatedAt: new Date()});
  renderMatchup(firstLoad);
}

function lineupHtml(m, side, key) {
  const ctx = getCtx(), players = ctx.players, slots = activeSlots(ctx.league.roster_positions), proj = mu.projections.get(m.week) || new Map();
  const rows = slots.map((slot, i) => {
    const id = side.starters[i];
    if (!id || id === '0') return `<div class="slot"><span class="slot-pos">${slotLabel(slot)}</span><span class="slot-name" style="color:var(--muted)">Empty</span><span class="slot-pts">0.0</span></div>`;
    const pts = Number(side.points[id] || 0), game = gameLine(playerTeam(id), mu.byTeam || new Map());
    const prevKey = `${m.week}:${id}`, prev = mu.shownPoints.get(prevKey);
    if (prev != null && prev !== pts) mu.flashUntil.set(prevKey, Date.now() + 1500);
    mu.shownPoints.set(prevKey, pts);
    const changed = (mu.flashUntil.get(prevKey) || 0) > Date.now();
    const injury = m.week >= ctx.nflWeek && !ctx.seasonOver ? INJURY[players?.[id]?.injury] : null;
    return `<div class="slot ${changed ? 'flash' : ''}"><span class="slot-pos">${slotLabel(slot)}</span><button type="button" class="slot-who" data-player="${esc(id)}" title="${esc(fullName(id, players))}">${photo(id, players, 'xs')}<span><span class="slot-name">${esc(shortName(id, players))}${injury ? ` <small class="inj" title="${esc(players[id].injury)}">${injury}</small>` : ''}</span><span class="slot-game ${game.cls}">${esc(game.text)}</span></span></button><span class="slot-pts">${fmt(pts)}<small>${proj.has(id) ? `proj ${fmt(proj.get(id))}` : ''}</small></span></div>`;
  }).join('');
  return `<div class="lineup ${key}"><h4>${esc(side.team.name)}</h4>${rows}</div>`;
}

function matchupFeedHtml(m) {
  const side = new Map([...m.a.starters.map(id => [id, 'a']), ...m.b.starters.map(id => [id, 'b'])]);
  const gameSelect = mu.feedGames.length > 1 ? `<label class="select-label" for="pbpGame">Game<select id="pbpGame"><option value="">All games (${mu.feedGames.length})</option>${mu.feedGames.map(g => `<option value="${g.id}" ${g.id === mu.game ? 'selected' : ''}>${g.away.abbr} @ ${g.home.abbr} · ${g.state === 'in' ? g.detail : 'Final'}</option>`).join('')}</select></label>` : '';
  const tools = feedTools([['all', 'All plays'], ['points', 'Points only'], ['big', 'Big plays']], gameSelect);
  if (mu.feedLoading) return tools + '<div class="empty">Loading plays…</div>';
  if (!mu.feedGames.length) {
    const next = (mu.games || []).filter(g => g.state === 'pre').sort((a, b) => Date.parse(a.date) - Date.parse(b.date))[0];
    return tools + `<div class="empty">${m.status === 'upcoming' || next ? `No snaps yet. Plays show up here as soon as the first game with one of these starters kicks off${next ? ` (${kickoff(next.date)})` : ''}.` : 'No play data for this week.'}</div>`;
  }
  const items = filterPlays(mu.feed);
  if (!items.length) return tools + '<div class="empty">No plays match this filter yet.</div>';
  const html = items.slice(0, 300).map(x => {
    const sides = new Set(x.involvements.map(i => side.get(i.playerId)));
    return playItem(x, sides.size > 1 ? 'both' : [...sides][0] || '', x.involvements.map(i => playTag(i, side.get(i.playerId) || '')).join(''));
  }).join('');
  mu.feed.forEach(x => mu.seen.add(x.id));
  return `${tools}<ol class="feed" aria-label="Plays, newest first">${html}</ol>`;
}

function renderMatchup(firstLoad = false) {
  const m = currentModel();
  if (!m) return;
  if (firstLoad) mu.feed.forEach(x => mu.seen.add(x.id));
  const pa = Math.round(m.prob * 100);
  const mid = m.status === 'upcoming' ? `<div class="sb-scores"><span class="a">${fmt(m.a.pre.expected)}</span><em>proj</em><span class="b">${fmt(m.b.pre.expected)}</span></div><small>Kickoff odds ${pa}% – ${100 - pa}%</small>`
    : `<div class="sb-scores"><span class="a">${fmt(m.actualA)}</span><em>${m.status === 'final' ? 'final' : 'to'}</em><span class="b">${fmt(m.actualB)}</span></div><small>${m.status === 'final' ? `Pregame ${Math.round(m.preProb * 100)}% – ${100 - Math.round(m.preProb * 100)}%` : `Win odds ${pa}% – ${100 - pa}% · proj ${fmt(m.a.live.expected)} – ${fmt(m.b.live.expected)}`}</small>`;
  keepFeedScroll(() => {
    $('#pbpBody').innerHTML = `<div class="scoreboard"><div class="sb-team a">${avatar(m.a.team, 'lg')}<div><strong>${esc(m.a.team.name)}</strong><small>${esc(m.a.team.manager || '')}</small></div></div><div class="sb-mid">${mid}</div><div class="sb-team b">${avatar(m.b.team, 'lg')}<div><strong>${esc(m.b.team.name)}</strong><small>${esc(m.b.team.manager || '')}</small></div></div></div>
      <div class="pbp-layout"><div class="lineups">${lineupHtml(m, m.a, 'a')}${lineupHtml(m, m.b, 'b')}</div><div>${matchupFeedHtml(m)}</div></div>
      <p class="pbp-note">Play values are estimated from ESPN's play-by-play using this league's scoring; the lineup totals come straight from Sleeper and are official. D/ST points-allowed bonuses are only settled at the end of each game. Tap a player for their fantasy history.${mu.feedError ? ` ${esc(mu.feedError)}` : ''}</p>`;
  });
}

// ---------------------------------------------------------------- play-by-play: NFL game
const CAP = {QB: 3, RB: 5, WR: 6, TE: 4, K: 2, DEF: 1};

// Everyone worth showing for a game: players with stats, players projected for points, and both defenses.
function gameCandidates(g, stats, players) {
  const proj = mu.projections.get(mu.week) || new Map(), teams = [g.away.abbr, g.home.abbr], ids = new Set(teams);
  for (const [id, row] of stats) if (teams.includes(row.team)) ids.add(id);
  for (const [id, pts] of proj) if (pts >= 0.5 && teams.includes(mu.projTeams.get(id))) ids.add(id);
  const active = st => st && ['pass_att', 'rush_att', 'rec_tgt', 'rec', 'fga', 'xpa'].some(k => Number(st[k]) > 0);
  return [...ids].map(id => {
    const row = stats.get(id);
    return {id, pos: positionOf(id, players, row?.player?.position), team: isTeamId(id) ? id : row?.team || mu.projTeams.get(id) || players?.[id]?.team,
      pts: row ? pointsFromStats(row.stats, scoring()) : null, proj: proj.has(id) ? proj.get(id) : null, stats: row?.stats || null};
  }).filter(c => POSITIONS.includes(c.pos) && teams.includes(c.team) && (c.pos === 'DEF' || c.pts || active(c.stats) || (c.proj ?? 0) >= 0.5));
}

async function refreshGame({fresh = false} = {}) {
  const ctx = getCtx(), g = currentGame();
  if (!g) { mu.pick = null; renderPrompt(); return; }
  const key = `g:${mu.week}:${g.id}`;
  if (key !== mu.feedKey) Object.assign(mu, {feedKey: key, feed: [], seen: new Set(), game: '', feedError: '', gameCands: null, gameLoading: true, gameTab: g.state === 'in' ? 'plays' : 'overview'});
  renderGame();
  const players = ctx.players || await ctx.playersReady.catch(() => ({}));
  if (key !== mu.feedKey) return;
  const live = fresh && g.state === 'in';
  const [stats, summary] = await Promise.all([
    loadWeekly('stats', ctx.league.season, mu.week, {fresh: live}).catch(() => new Map()),
    g.state === 'pre' ? Promise.resolve(null) : loadSummary(g.id, {fresh: live}).catch(() => null)
  ]);
  if (key !== mu.feedKey) return;
  const firstLoad = !mu.feed.length;
  mu.gameCands = gameCandidates(g, stats, players || {});
  const tracked = trackPlayers(mu.gameCands.map(c => c.id), players || {});
  mu.feed = summary ? fantasyFeed(summary, tracked, scoring()).items.sort((x, y) => y.seq - x.seq) : [];
  Object.assign(mu, {feedError: g.state !== 'pre' && !summary ? "ESPN's play-by-play for this game could not be loaded." : '', gameLoading: false, updatedAt: new Date()});
  renderGame(firstLoad);
}

function gameBoard(g) {
  const team = (s, side) => `<div class="gb-team ${side}">${s.logo ? `<img src="${esc(s.logo)}" alt="" loading="lazy">` : ''}<div><strong>${esc(s.abbr)}</strong><small>${esc(s.record || '')}</small></div><b class="gb-score">${g.state === 'pre' ? '' : s.score}</b></div>`;
  const status = g.state === 'in' ? `<span class="pill live">${esc(g.detail)}</span>` : g.state === 'post' ? `<span class="pill final">${esc(g.detail || 'Final')}</span>` : `<span class="pill">${esc(kickoff(g.date))}</span>`;
  return `<div class="game-board">${team(g.away, 'away')}<div class="gb-mid">${status}</div>${team(g.home, 'home')}</div>`;
}

function overviewHtml(g, cands, owners) {
  const players = getCtx().players, order = (a, b) => (b.pts ?? -99) - (a.pts ?? -99) || (b.proj ?? 0) - (a.proj ?? 0);
  const cell = (c, side) => c ? `<button type="button" class="ov-cell ${side} ${owners.get(c.id) ? 'owned' : ''}" data-player="${esc(c.id)}">${photo(c.id, players, 'sm')}
      <span class="ov-who"><span class="ov-name">${esc(shortName(c.id, players))}</span><span class="ov-owner">${esc(ownerText(owners.get(c.id)))}</span><span class="ov-line">${esc(statLine(c.stats, c.pos))}</span></span>
      <span class="ov-pts"><b>${c.pts == null ? '–' : fmt(c.pts, 2)}</b><small>${c.proj == null ? '–' : fmt(c.proj, 2)}</small></span></button>` : '<span class="ov-cell empty"></span>';
  const html = POSITIONS.map(pos => {
    const away = cands.filter(c => c.pos === pos && c.team === g.away.abbr).sort(order).slice(0, CAP[pos]);
    const home = cands.filter(c => c.pos === pos && c.team === g.home.abbr).sort(order).slice(0, CAP[pos]);
    if (!away.length && !home.length) return '';
    return `<section class="ov-group"><h5>${POSITION_NAMES[pos]}</h5>${Array.from({length: Math.max(away.length, home.length)}, (_, i) => `<div class="ov-row">${cell(away[i], 'away')}${cell(home[i], 'home')}</div>`).join('')}</section>`;
  }).join('');
  return html || '<div class="empty">No player data for this game yet.</div>';
}

function gameFeedHtml(g, owners) {
  const tools = feedTools([['all', 'All plays'], ['points', 'Points only'], ['big', 'Big plays'], ['cuzzo', 'Cuzzo players']]);
  if (g.state === 'pre') return tools + `<div class="empty">Kickoff is ${esc(kickoff(g.date))}. Fantasy plays stream in here live once the game starts.</div>`;
  const items = filterPlays(mu.feed, owners);
  if (!items.length) return tools + `<div class="empty">${mu.feed.length ? 'No plays match this filter yet.' : 'No fantasy plays yet.'}</div>`;
  const html = items.slice(0, 400).map(x => {
    const owned = x.involvements.some(i => owners.has(i.playerId));
    return playItem(x, owned ? 'owned' : '', x.involvements.map(i => playTag(i, owners.has(i.playerId) ? 'owned' : '', owners.get(i.playerId) || null)).join(''));
  }).join('');
  mu.feed.forEach(x => mu.seen.add(x.id));
  return `${tools}<ol class="feed" aria-label="Plays, newest first">${html}</ol>`;
}

function renderGame(firstLoad = false) {
  const g = currentGame();
  if (!g) return;
  if (firstLoad) mu.feed.forEach(x => mu.seen.add(x.id));
  const owners = ownerIndex(getCtx(), mu.week);
  const tabs = `<div class="seg game-tabs" role="group" aria-label="Game view">${[['overview', 'Overview'], ['plays', 'Plays']].map(([k, l]) => `<button type="button" data-gtab="${k}" aria-pressed="${mu.gameTab === k}">${l}</button>`).join('')}</div>`;
  const body = mu.gameLoading ? '<div class="empty">Loading game…</div>'
    : mu.gameTab === 'overview' ? `<p class="ov-key"><span>${esc(g.away.abbr)}</span><span>Fantasy points · <small>projection</small></span><span>${esc(g.home.abbr)}</span></p>${overviewHtml(g, mu.gameCands || [], owners)}`
    : gameFeedHtml(g, owners);
  keepFeedScroll(() => {
    $('#pbpBody').innerHTML = `${gameBoard(g)}${tabs}<div class="game-body">${body}</div>
      <p class="pbp-note">Fantasy points use this league's scoring on Sleeper's stats; play values are estimated from ESPN's play-by-play. Under each name is the Cuzzo team that rosters the player ("bench" if they aren't starting this week). Tap any player for their fantasy history.${mu.feedError ? ` ${esc(mu.feedError)}` : ''}</p>`;
  });
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
  const choose = (kind, id) => {
    mu.pick = {kind, id: kind === 'matchup' ? Number(id) : String(id)};
    mu.filter = 'all';
    document.querySelectorAll('.matchup').forEach(el => el.classList.toggle('selected', kind === 'matchup' && Number(el.dataset.matchup) === Number(id)));
    renderPicker();
    refreshFeed();
  };
  const openCard = card => { choose('matchup', card.dataset.matchup); $('#playbyplay').scrollIntoView({behavior: 'smooth', block: 'start'}); };
  $('#matchupGrid').addEventListener('click', e => { const card = e.target.closest('.matchup'); if (card) openCard(card); });
  $('#matchupGrid').addEventListener('keydown', e => { const card = e.target.closest('.matchup'); if (card && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); openCard(card); } });
  $('#pbpPicker').addEventListener('click', e => {
    const b = e.target.closest('[data-pick]');
    if (!b) return;
    const [kind, id] = b.dataset.pick.split(':');
    choose(kind, id);
  });
  const rerender = () => (currentGame() ? renderGame() : renderMatchup());
  $('#pbpBody').addEventListener('click', e => {
    const filter = e.target.closest('[data-filter]');
    if (filter) { mu.filter = filter.dataset.filter; rerender(); return; }
    const tab = e.target.closest('[data-gtab]');
    if (tab) { mu.gameTab = tab.dataset.gtab; renderGame(); }
  });
  $('#pbpBody').addEventListener('change', e => { if (e.target.id === 'pbpGame') { mu.game = e.target.value; rerender(); $('#pbpGame')?.focus(); } });
  document.addEventListener('visibilitychange', () => { if (!document.hidden && getCtx()) tick(); else clearTimeout(mu.timer); });
}

export const selectedWeek = () => mu.week;
export function resetLiveCaches() { mu.scoreboards.clear(); mu.liveEntries.clear(); mu.projections.clear(); }
