// Player card: bio, league owner, and a week-by-week fantasy game log for any season.
import {esc, fmt} from './util.js';
import {loadPlayerLog, loadSchedule, isTeamId} from './sleeper.js';
import {pointsFromStats} from './scoring.js';
import {photo, fullName, positionOf, ownerIndex} from './player-ui.js';

const $ = sel => document.querySelector(sel);
const WEEKS = 18;
let getCtx = () => null, current = {id: null, season: null};

const val = (st, key) => typeof key === 'function' ? key(st) : Number(st?.[key] || 0);
const ypc = st => (st?.rush_att ? st.rush_yd / st.rush_att : 0);
const COLUMNS = {
  QB: [['Passing', [['ATT', 'pass_att'], ['CMP', 'pass_cmp'], ['YD', 'pass_yd'], ['TD', 'pass_td'], ['INT', 'pass_int']]], ['Rushing', [['ATT', 'rush_att'], ['YD', 'rush_yd'], ['TD', 'rush_td']]], ['Fumble', [['LOST', 'fum_lost']]]],
  RB: [['Rushing', [['ATT', 'rush_att'], ['YD', 'rush_yd'], ['YPC', ypc, 1], ['TD', 'rush_td']]], ['Receiving', [['TGT', 'rec_tgt'], ['REC', 'rec'], ['YD', 'rec_yd'], ['TD', 'rec_td']]], ['Fumble', [['LOST', 'fum_lost']]]],
  WR: [['Receiving', [['TGT', 'rec_tgt'], ['REC', 'rec'], ['YD', 'rec_yd'], ['TD', 'rec_td']]], ['Rushing', [['ATT', 'rush_att'], ['YD', 'rush_yd'], ['TD', 'rush_td']]], ['Fumble', [['LOST', 'fum_lost']]]],
  K: [['Field goals', [['FGM', 'fgm'], ['FGA', 'fga'], ['50+', 'fgm_50p']]], ['Extra points', [['XPM', 'xpm'], ['XPA', 'xpa']]]],
  DEF: [['Defense', [['PA', 'pts_allow'], ['YDS', 'yds_allow'], ['SACK', 'sack'], ['INT', 'int'], ['FR', 'fum_rec'], ['TD', 'def_td']]]]
};
COLUMNS.TE = COLUMNS.WR;

function height(inches) {
  const h = Number(inches);
  return h ? `${Math.floor(h / 12)}'${h % 12}"` : null;
}

function header(ctx, id) {
  const p = ctx.players?.[id] || {}, pos = positionOf(id, ctx.players), team = isTeamId(id) ? id : p.team;
  const owner = ownerIndex(ctx, ctx.defaultWeek).get(String(id));
  const bio = isTeamId(id) ? [] : [
    p.age ? `Age ${p.age}` : null, height(p.ht), p.wt ? `${p.wt} lbs` : null,
    p.exp != null ? (Number(p.exp) === 0 ? 'Rookie' : `${p.exp} yr${Number(p.exp) === 1 ? '' : 's'} exp`) : null, p.college || null
  ].filter(Boolean);
  return `<div class="pd-head">${photo(id, ctx.players, 'xl')}<div class="pd-id">
      <h3 id="playerTitle">${esc(fullName(id, ctx.players))}</h3>
      <p class="pd-pos"><span class="pill">${esc(pos || '—')}</span> ${esc(team || 'Free agent')}${p.num != null && !isTeamId(id) ? ` · #${esc(p.num)}` : ''}${p.injury ? ` · <span class="bad">${esc(p.injury)}</span>` : ''}</p>
      ${bio.length ? `<p class="pd-bio">${bio.map(esc).join(' · ')}</p>` : ''}
      <p class="pd-owner">${owner ? `On <b>${esc(owner.name)}</b> (${esc(owner.manager)})${owner.starter ? '' : ' · on the bench this week'}` : 'Free agent in the Cuzzo League'}</p>
    </div><button class="icon-btn pd-close" type="button" data-close aria-label="Close">✕</button></div>`;
}

function gameLog(ctx, id, season, log, schedule) {
  const pos = positionOf(id, ctx.players), groups = COLUMNS[pos] || COLUMNS.WR, scoring = ctx.league.scoring_settings;
  const showSnaps = !['K', 'DEF'].includes(pos);
  const cols = groups.flatMap(([, list]) => list);
  const fallbackTeam = isTeamId(id) ? id : ctx.players?.[id]?.team;
  const totals = cols.map(() => 0); // by column position: passing and rushing both have ATT/YD/TD
  let fptsTotal = 0, games = 0, best = null;
  const rows = Array.from({length: WEEKS}, (_, i) => i + 1).map(week => {
    const stat = log.stats?.[week], proj = log.proj?.[week];
    const team = stat?.team || proj?.team || fallbackTeam;
    const game = (schedule || []).find(g => Number(g.week) === week && (g.home === team || g.away === team));
    const opp = game ? (game.home === team ? game.away : `@${game.home}`) : (schedule?.length && team ? 'BYE' : (stat?.opponent || proj?.opponent || '—'));
    if (opp === 'BYE') return `<tr class="bye"><td>${week}</td><td>BYE</td><td colspan="${3 + cols.length}"></td></tr>`;
    const fpts = stat ? pointsFromStats(stat.stats, scoring) : null;
    const projPts = proj ? pointsFromStats(proj.stats, scoring) : null;
    if (fpts != null) {
      fptsTotal += fpts; games++;
      if (!best || fpts > best.fpts) best = {week, fpts};
      cols.forEach(([, key], i) => { totals[i] += val(stat.stats, key); });
    }
    const snaps = stat?.stats?.tm_off_snp ? `${Math.round(100 * (stat.stats.off_snp || 0) / stat.stats.tm_off_snp)}%` : '–';
    const cells = cols.map(([, key, digits]) => { const v = val(stat?.stats, key); return `<td>${stat && v ? fmt(v, digits || 0) : '–'}</td>`; }).join('');
    return `<tr><td>${week}</td><td>${esc(opp)}</td><td class="proj">${projPts == null ? '–' : fmt(projPts, 2)}</td><td class="fpts">${fpts == null ? '–' : fmt(fpts, 2)}</td>${showSnaps ? `<td>${stat ? snaps : '–'}</td>` : ''}${cells}</tr>`;
  }).join('');
  const head = `<tr class="grp"><th colspan="2"></th><th colspan="${showSnaps ? 3 : 2}">Fantasy</th>${groups.map(([name, list]) => `<th colspan="${list.length}">${esc(name)}</th>`).join('')}</tr>
    <tr><th>WK</th><th>OPP</th><th>PROJ</th><th>FPTS</th>${showSnaps ? '<th>SNP%</th>' : ''}${cols.map(([label]) => `<th>${label}</th>`).join('')}</tr>`;
  const rushTotals = Object.values(log.stats || {}).reduce((t, row) => ({att: t.att + val(row?.stats, 'rush_att'), yd: t.yd + val(row?.stats, 'rush_yd')}), {att: 0, yd: 0});
  const foot = games ? `<tr class="total"><td colspan="2">Total</td><td></td><td class="fpts">${fmt(fptsTotal, 2)}</td>${showSnaps ? '<td></td>' : ''}${cols.map(([, key, digits], i) => `<td>${key === ypc ? (rushTotals.att ? fmt(rushTotals.yd / rushTotals.att, 1) : '–') : fmt(totals[i], digits || 0)}</td>`).join('')}</tr>` : '';
  const tiles = `<div class="pd-tiles"><div class="mini-tile"><small>Fantasy points</small><strong>${fmt(fptsTotal, 1)}</strong><span>${season} · league scoring</span></div>
    <div class="mini-tile"><small>Per game</small><strong>${games ? fmt(fptsTotal / games, 1) : '–'}</strong><span>${games} game${games === 1 ? '' : 's'} played</span></div>
    <div class="mini-tile"><small>Best week</small><strong>${best ? fmt(best.fpts, 1) : '–'}</strong><span>${best ? `Week ${best.week}` : 'No games yet'}</span></div></div>`;
  return `${tiles}<div class="scroll-x pd-scroll"><table class="pd-log"><thead>${head}</thead><tbody>${rows}</tbody><tfoot>${foot}</tfoot></table></div>
    <p class="history-note">Fantasy points use this league's scoring settings for every season. Stats and projections come from Sleeper.</p>`;
}

async function render() {
  const ctx = getCtx(), {id, season} = current;
  if (!ctx || !id) return;
  const seasons = [0, 1, 2].map(k => String(Number(ctx.league.season) - k));
  const body = $('#playerBody');
  body.innerHTML = `${header(ctx, id)}<div class="seg pd-seasons" role="group" aria-label="Season">${seasons.map(s => `<button type="button" data-season="${s}" aria-pressed="${s === season}">${s}</button>`).join('')}</div><div id="playerLog"><div class="empty">Loading game log…</div></div>`;
  const [log, schedule] = await Promise.all([loadPlayerLog(id, season), loadSchedule(season)]);
  if (current.id !== id || current.season !== season) return;
  $('#playerLog').innerHTML = gameLog(ctx, id, season, log, schedule);
}

export function openPlayer(id) {
  const ctx = getCtx();
  if (!ctx || !id) return;
  current = {id: String(id), season: String(ctx.league.season)};
  const dialog = $('#playerDialog');
  if (!dialog.open) dialog.showModal();
  render();
}

export function initPlayerModal(context) {
  getCtx = context;
  const dialog = $('#playerDialog');
  document.addEventListener('click', event => {
    const el = event.target.closest('[data-player]');
    if (!el) return;
    event.preventDefault();
    event.stopPropagation();
    openPlayer(el.dataset.player);
  });
  dialog.addEventListener('click', event => {
    const season = event.target.closest('[data-season]');
    if (season) { current.season = season.dataset.season; render(); return; }
    if (event.target.closest('[data-close]') || event.target === dialog) dialog.close();
  });
}
