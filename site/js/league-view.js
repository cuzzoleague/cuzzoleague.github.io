// Renders the League tab. Every function takes the shared `ctx` built in app.js.
import {esc, fmt, signed, plural, recordText, pct, ordinal, mean} from './util.js';
import {managerTable, champions} from './history.js';

const $ = sel => document.querySelector(sel);
const ui = {selected: null, moveTeam: null, moveId: null, bumpFocus: null, historySort: 'legacy', historyDir: -1, historyYear: ''};
const SERIES = ['#2f6ad8', '#d45a22', '#1d8a52', '#9b4dca', '#c9a012', '#d6336c', '#0f9aa8', '#7a5c3e', '#5c6bc0', '#e8590c', '#2b8a3e', '#868e96'];

export const initials = name => String(name || '?').replace(/[^A-Za-z0-9 ]/g, '').split(/\s+/).filter(Boolean).slice(0, 2).map(w => w[0].toUpperCase()).join('') || '?';
export function avatar(team, cls = '') {
  if (team?.avatar) return `<img class="avatar ${cls}" src="${esc(team.avatar)}" alt="" loading="lazy" referrerpolicy="no-referrer">`;
  return `<span class="avatar ${cls}" aria-hidden="true">${esc(initials(team?.name))}</span>`;
}
const info = (key, label) => `<button class="info-btn" type="button" data-info="${key}" aria-label="How ${esc(label)} works">i</button>`;
// Simulated odds never print as a certainty unless every simulation agreed.
const oddsText = p => p >= 1 ? '100%' : p <= 0 ? '0%' : p > 0.995 ? '>99%' : p < 0.005 ? '<1%' : pct(p);
const byPower = ctx => [...ctx.season.teams.values()].sort((a, b) => a.powerRank - b.powerRank);
const teamOf = (ctx, id) => ctx.teams.get(Number(id)) || {name: `Team ${id}`, manager: ''};

export const METRIC_INFO = {
  allPlay: {title: 'All-play win rate', body: 'Each week your score is compared with every other team in the league, as if you played all of them. The share of those games you would have won is your all-play win rate; added up across weeks it becomes expected wins.', example: 'Scoring 3rd-highest in a 10-team league wins 7 of 9 all-play games that week, worth 0.78 expected wins.'},
  scoringStrength: {title: 'Scoring strength', body: 'Every weekly score is measured against that week\'s league average in standard deviations (a z-score), then averaged. This keeps big NFL scoring weeks from skewing things.', example: 'A season z-score of +1.0 means you usually score about one standard deviation above the league.'},
  recentForm: {title: 'Recent form', body: 'The same weekly z-scores, but the newest week counts most and each older week counts 30% less than the one after it.', example: 'Two huge recent weeks can lift a slow starter up the power rankings quickly.'},
  power: {title: 'Power score', body: 'Each of the three ingredients is turned into a 0–100 percentile across the league, then blended: 40% all-play win rate, 35% scoring strength, 25% recent form.', example: '100 means first in the league on the blended formula, not a perfect team.'},
  expectedWins: {title: 'Expected wins', body: 'How many games your scores would win against an average schedule: the sum of your weekly all-play win rates.', example: 'If you have 2 wins but 2.8 expected wins, your schedule has cost you almost a full game.'},
  luck: {title: 'Schedule luck', body: 'Actual wins minus expected wins. Positive means your opponents have been kind; negative means you have deserved better.', example: '+1.2 means about one extra win you probably would not have had against a typical schedule.'},
  consistency: {title: 'Consistency', body: 'The standard deviation of your weekly scores. Smaller numbers mean a steadier team.', example: '8 points of deviation is a metronome; 30 is a rollercoaster.'},
  playoffOdds: {title: 'Playoff odds', body: 'Thousands of simulations of the rest of the regular season using the real remaining schedule. Each team\'s future scores are drawn from its own scoring so far, blended with the league average so a few weeks don\'t overreact. Seeds use record, then points for.', example: 'Odds ignore injuries and trades; they only know how teams have scored.'},
  badBeats: {title: 'Heartbreaks', body: 'Losses in weeks where you still outscored at least half the league.', example: 'Second-highest score of the week, but you played the highest. Brutal.'},
  luckyWins: {title: 'Lucky wins', body: 'Wins in weeks where you scored below the league median.', example: 'A below-average week that still went in the W column.'},
  awardTopDog: {title: 'Top Dog', body: 'Goes to the team with the most weeks as the league\'s highest scorer. Ties go to whoever is higher in the power rankings.', example: 'Two weekly high scores beats one, even if the other team has scored more in total.'},
  awardHeater: {title: 'Heater', body: 'Goes to the team with the best recent form. Each weekly score is compared with that week\'s league average (a z-score); the newest week counts most, and each older week counts 30% less than the one after it.', example: 'A team that started slow but dropped two monster weeks in a row can take this.'},
  awardWizard: {title: 'Waiver Wizard', body: 'Goes to the team whose trades, waiver claims, and free-agent pickups have added the most points. Each move is graded for every completed week it was in effect: the best possible lineup with the move minus the best possible lineup without it, using real scores. A team\'s graded moves are added together.', example: 'Picking up a kicker who scores 12 when the one you dropped scored 3 adds 9 points that week. Every graded move is listed under Trade & waiver grades.'},
  awardSteady: {title: 'Steady Eddie', body: 'Goes to the most consistent team: the smallest standard deviation of weekly scores. Needs at least two weeks of games.', example: 'Scoring 120, 118, and 123 is steadier than 150, 90, and 121, even though both average about 120.'},
  awardHorseshoe: {title: 'Horseshoe', body: 'Goes to the team with the most lucky wins: wins in weeks when it scored below the league median.', example: 'Scoring 95 when most of the league topped 110, and still winning because your opponent scored 90.'},
  awardHeartbreak: {title: 'Heartbreak Hotel', body: 'Goes to the team with the most heartbreaks: losses in weeks when it still scored above the league median.', example: 'Putting up the second-highest score of the week and losing to the highest.'},
  awardGauntlet: {title: 'The Gauntlet', body: 'Goes to the team with the toughest schedule so far: the most total points scored against it by its actual opponents. Ties go to whoever is higher in the power rankings.', example: 'Facing a 150-point team week after week. It\'s the schedule, not you. Probably.'},
  awardWildRide: {title: 'Wild Ride', body: 'Goes to the least predictable team: the largest standard deviation of weekly scores. Needs at least two weeks of games.', example: 'Going 160, then 85, then 140. Nobody knows which version of this team shows up.'},
  awardIceCold: {title: 'Ice Cold', body: 'Goes to the team with the most weeks as the league\'s lowest scorer. Ties go to whoever is higher in the power rankings.', example: 'One week at the bottom is bad luck; three is a pattern.'},
  awardBench: {title: 'Bench Blunder', body: 'Goes to the team that has left the most points on its bench. For each completed week, the best legal lineup from the players on the roster (using their real scores) is compared with the lineup actually started, and the gaps are added up.', example: 'Starting a receiver who scored 4 while a 22-point receiver sat on the bench adds 18 points.'},
  bench: {title: 'Bench points', body: 'The gap between your best possible lineup (using actual scores) and the lineup you started, added up across completed weeks.', example: 'Leaving a 25-point receiver on the bench for a 5-point starter adds 20.'}
};

// ---------------------------------------------------------------- Rankings + report
export function renderRankings(ctx) {
  const list = $('#rankList'), rows = byPower(ctx);
  if (!ctx.season.playedWeeks.length) {
    list.innerHTML = `<li class="empty">Power rankings start after Week 1 is final.</li>`;
    $('#rankNote').textContent = '';
    renderReport(ctx);
    return;
  }
  if (!ctx.season.teams.has(ui.selected)) ui.selected = null;
  $('#rankNote').textContent = `Through Week ${ctx.season.playedWeeks.at(-1)}`;
  list.innerHTML = rows.map(s => {
    const t = teamOf(ctx, s.id), move = s.prevRank == null ? 0 : s.prevRank - s.powerRank;
    return `<li class="rank-row" role="button" tabindex="0" data-team="${s.id}" aria-pressed="${s.id === ui.selected}">
      <span class="rank-num">${s.powerRank}</span>
      <div class="rank-team">${avatar(t)}<div><div class="rank-name">${esc(t.name)}</div><div class="rank-meta">${esc(t.manager)} · ${recordText(s.wins, s.losses, s.ties)} · ${ordinal(s.seed)} seed</div></div></div>
      <div class="rank-stats"><span class="rank-stat">Exp W<b>${fmt(s.expectedWins, 2)}</b></span><span class="rank-stat hide-md">Avg<b>${fmt(s.avg)}</b></span><span class="rank-stat">Luck<b class="${s.luck > 0.25 ? 'good' : s.luck < -0.25 ? 'bad' : ''}">${signed(s.luck, 2)}</b></span></div>
      <div class="rank-power"><b>${fmt(s.power)}</b><small>Power</small><div class="power-bar"><i style="width:${Math.max(3, s.power)}%"></i></div></div>
      <span class="rank-move ${move > 0 ? 'up' : move < 0 ? 'down' : 'same'}" aria-label="${move > 0 ? `up ${move}` : move < 0 ? `down ${-move}` : 'no change'}">${move > 0 ? `▲${move}` : move < 0 ? `▼${-move}` : '—'}</span>
    </li>`;
  }).join('');
  renderReport(ctx);
}

export function bindRankings(ctx) {
  const pick = el => {
    ui.selected = Number(el.dataset.team);
    document.querySelectorAll('.rank-row').forEach(r => r.setAttribute('aria-pressed', String(r === el)));
    renderReport(ctx());
    // On narrower screens the report sits below the list, so bring it into view.
    if (matchMedia('(max-width: 1020px)').matches) $('#teamReport').closest('.report').scrollIntoView({behavior: 'smooth', block: 'start'});
  };
  $('#rankList').addEventListener('click', e => { const row = e.target.closest('.rank-row'); if (row && !e.target.closest('.info-btn')) pick(row); });
  $('#rankList').addEventListener('keydown', e => { const row = e.target.closest('.rank-row'); if (row && (e.key === 'Enter' || e.key === ' ')) { e.preventDefault(); pick(row); } });
}

function sparkline(s, leagueAvg) {
  const pts = s.weekly.map(r => r.pts);
  if (pts.length < 2) return '';
  const w = 300, h = 46, lo = Math.min(...pts, leagueAvg) - 5, hi = Math.max(...pts, leagueAvg) + 5;
  const x = i => 6 + i * (w - 12) / (pts.length - 1), y = v => h - 4 - (v - lo) / (hi - lo) * (h - 8);
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" preserveAspectRatio="none" aria-hidden="true"><line x1="0" x2="${w}" y1="${y(leagueAvg)}" y2="${y(leagueAvg)}"/><polyline points="${pts.map((v, i) => `${x(i)},${y(v)}`).join(' ')}"/>${pts.map((v, i) => `<circle cx="${x(i)}" cy="${y(v)}" r="3"/>`).join('')}</svg>`;
}

export function renderReport(ctx) {
  const holder = $('#teamReport'), s = ctx.season.teams.get(ui.selected);
  if (!ctx.season.playedWeeks.length) { holder.innerHTML = '<div class="empty">Team reports unlock once a week has been played.</div>'; return; }
  if (!s) {
    $('#reportSub').textContent = 'Select a team in the power rankings to see what\x27s behind its rank.';
    holder.innerHTML = '<div class="report-prompt"><span class="point-left" aria-hidden="true">👈</span><p><b>No team selected</b>Tap any team in the power rankings to open its report: expected wins, luck, playoff odds, and more.</p></div>';
    return;
  }
  const t = teamOf(ctx, s.id), gameLabel = g => g ? `Wk ${g.week} ${g.margin >= 0 ? 'W' : 'L'} by ${fmt(g.abs)} vs ${esc(teamOf(ctx, g.opp).name)}` : '—';
  const card = (label, value, extra = '', key = '', cls = '') => `<div class="stat-card ${cls}"><small>${label} ${key ? info(key, label) : ''}</small><strong>${value}</strong>${extra ? `<span>${extra}</span>` : ''}</div>`;
  const bench = ctx.bench?.get(s.id);
  $('#reportSub').textContent = `#${s.powerRank} in power · ${ordinal(s.seed)} in the standings`;
  holder.innerHTML = `<div class="report-hero">${avatar(t, 'lg')}<div><h3>${esc(t.name)}</h3><p>${esc(t.manager)} · ${recordText(s.wins, s.losses, s.ties)} · ${fmt(s.pf)} PF</p></div></div>
    <div class="stat-grid">
      ${card('Power score', fmt(s.power), `${fmt(s.parts.allPlay, 0)} / ${fmt(s.parts.scoring, 0)} / ${fmt(s.parts.form, 0)} pct`, 'power')}
      ${card('Playoff odds', oddsText(s.playoffOdds), `${s.byes ? `Bye ${oddsText(s.byeOdds)} · ` : ''}avg seed ${fmt(s.projectedSeed)}<div class="odds-meter"><i style="width:${s.playoffOdds * 100}%"></i></div>`, 'playoffOdds')}
      ${card('Expected wins', fmt(s.expectedWins, 2), `vs ${s.wins + s.ties / 2} actual`, 'expectedWins')}
      ${card('Schedule luck', `<span class="${s.luck > 0.25 ? 'good' : s.luck < -0.25 ? 'bad' : ''}">${signed(s.luck, 2)}</span>`, s.luck > 0.25 ? 'Schedule has helped' : s.luck < -0.25 ? 'Deserved better' : 'Right where you should be', 'luck')}
      ${card('All-play', recordText(s.allPlay.w, s.allPlay.l, s.allPlay.t), `#${s.allPlayRank} in the league`, 'allPlay')}
      ${card('Avg weekly finish', fmt(s.avgRank), `of ${ctx.season.teams.size} teams`)}
      ${card('Scoring', `${fmt(s.avg)} <span>avg</span>`, `${signed(s.scoringZ, 2)} z vs league`, 'scoringStrength')}
      ${card('Recent form', `${signed(s.formZ, 2)} z`, s.formZ > 0.5 ? 'Heating up' : s.formZ < -0.5 ? 'Cooling off' : 'Holding steady', 'recentForm')}
      ${card('Consistency', `${fmt(s.sd)} pts`, `σ of weekly scores`, 'consistency')}
      ${card('Heartbreaks / lucky', `${s.badBeats} / ${s.luckyWins}`, 'above-median losses / below-median wins', 'badBeats')}
      ${bench ? card('Bench points', fmt(bench.total), `left on the bench · worst: Wk ${bench.worst.week} (${fmt(bench.worst.gap)})`, 'bench') : ''}
      ${card('Points against', fmt(s.pa), `${fmt(s.games ? s.pa / s.games : 0)} per game`)}
      ${card('Closest game', gameLabel(s.closest), '', '', 'wide')}
      ${card('Biggest blowout', gameLabel(s.blowout), '', '', 'wide')}
      <div class="stat-card wide"><small>Weekly scores vs league average (dashed)</small>${sparkline(s, ctx.season.leagueAvg) || '<span>Needs two weeks of games.</span>'}</div>
    </div>
    <p class="report-note">Playoff odds come from ${ctx.sims.toLocaleString()} simulations of the remaining schedule.</p>`;
}

// ---------------------------------------------------------------- Awards
export function renderAwards(ctx) {
  const holder = $('#awardsGrid'), rows = byPower(ctx).filter(s => s.weekly.length);
  if (!rows.length) { holder.innerHTML = '<div class="empty">Awards are handed out after Week 1.</div>'; return; }
  const top = (score, filter = () => true) => { const pool = rows.filter(filter); return pool.length ? [...pool].sort((a, b) => score(b) - score(a) || a.powerRank - b.powerRank)[0] : null; };
  const multi = rows.filter(s => s.weekly.length > 1).length ? s => s.weekly.length > 1 : () => true;
  const byId = id => ctx.season.teams.get(id);
  const award = (s, detail) => s ? {s, detail: detail(s)} : {pending: 'Not awarded yet'};

  // Awards that need data loaded after the first render show a placeholder until it arrives.
  let wizard = {pending: ctx.movesError ? 'Move grades unavailable' : 'Grading moves…'};
  if (ctx.moves) {
    const totals = [...ctx.moves.entries()].map(([id, list]) => {
      const graded = list.filter(m => m.rows.length);
      return {id, total: graded.reduce((t, m) => t + m.impact, 0), count: graded.length};
    }).filter(t => t.count && byId(t.id)).sort((a, b) => b.total - a.total || byId(a.id).powerRank - byId(b.id).powerRank);
    wizard = totals[0]?.total > 0 ? {s: byId(totals[0].id), detail: `${signed(totals[0].total)} pts from ${plural(totals[0].count, 'graded move')}`} : {pending: 'No move has paid off yet'};
  }
  const benchKing = ctx.bench && [...ctx.bench.entries()].sort((a, b) => b[1].total - a[1].total)[0];
  const bench = !ctx.bench ? {pending: 'Checking lineups…'} : benchKing ? {s: byId(benchKing[0]), detail: `${fmt(benchKing[1].total)} pts left on the bench`} : {pending: 'Not awarded yet'};

  const awards = [
    ['👑', 'Top Dog', 'awardTopDog', award(top(s => s.highs), s => plural(s.highs, 'weekly high score'))],
    ['🔥', 'Heater', 'awardHeater', award(top(s => s.formZ), s => `${signed(s.formZ, 2)} z recent form`)],
    ['🧙', 'Waiver Wizard', 'awardWizard', wizard],
    ['📏', 'Steady Eddie', 'awardSteady', award(top(s => -s.sd, multi), s => `${fmt(s.sd)}-pt weekly swing`)],
    ['🍀', 'Horseshoe', 'awardHorseshoe', award(top(s => s.luckyWins), s => plural(s.luckyWins, 'below-median win'))],
    ['💔', 'Heartbreak Hotel', 'awardHeartbreak', award(top(s => s.badBeats), s => plural(s.badBeats, 'above-median loss', 'above-median losses'))],
    ['🥊', 'The Gauntlet', 'awardGauntlet', award(top(s => s.pa), s => `${fmt(s.pa)} pts against · ${fmt(s.games ? s.pa / s.games : 0)} a game`)],
    ['🎢', 'Wild Ride', 'awardWildRide', award(top(s => s.sd, multi), s => `${fmt(s.sd)}-pt weekly swing`)],
    ['🧊', 'Ice Cold', 'awardIceCold', award(top(s => s.lows), s => plural(s.lows, 'weekly low score'))],
    ['🪑', 'Bench Blunder', 'awardBench', bench]
  ];
  holder.innerHTML = awards.map(([icon, title, key, a]) => `<article class="award ${a.pending ? 'pending' : ''}"><div class="award-icon" aria-hidden="true">${icon}</div><h3>${title} ${info(key, title)}</h3><div class="award-team">${a.pending ? esc(a.pending) : esc(teamOf(ctx, a.s.id).name)}</div><div class="award-detail">${a.pending ? '&nbsp;' : a.detail}</div></article>`).join('');
}

// ---------------------------------------------------------------- Heatmap + schedule swap
// Grid labels share one look across the heatmap, schedule swap, and draft board.
const colHead = (text, title = text) => `<th scope="col" title="${esc(title)}"><span class="grid-label">${esc(text)}</span></th>`;
const rowHead = (text, title = text) => `<th scope="row" title="${esc(title)}"><span class="grid-label">${esc(text)}</span></th>`;

export function renderHeatmap(ctx) {
  const holder = $('#heatmapTable'), rows = byPower(ctx), played = ctx.season.playedWeeks, n = ctx.season.teams.size;
  if (!played.length) { holder.innerHTML = '<div class="empty">No completed weeks yet.</div>'; return; }
  const bucket = rank => Math.max(1, Math.min(5, Math.ceil((n > 1 ? 1 - (rank - 1) / (n - 1) : 1) * 5)));
  // The whole regular season is laid out; weeks still to come stay empty.
  const weeks = Array.from({length: Math.max(ctx.regularWeeks || 0, ...played)}, (_, i) => i + 1);
  holder.innerHTML = `<table class="data-table heat"><thead><tr>${colHead('Team')}${weeks.map(w => colHead(`Wk ${w}`, `Week ${w}`)).join('')}${colHead('Avg', 'Average')}</tr></thead><tbody>${rows.map(s => {
    const t = teamOf(ctx, s.id), byWeek = new Map(s.weekly.map(r => [r.week, r]));
    return `<tr>${rowHead(t.name)}${weeks.map(w => {
      const r = byWeek.get(w);
      if (!r) return `<td class="heat-future" aria-label="Week ${w}: ${played.includes(w) ? 'no score' : 'not played yet'}"></td>`;
      return `<td class="h${bucket(r.rank)}" title="Week ${w}: ${fmt(r.pts)} (#${r.rank})${r.result ? `, ${r.result} vs ${esc(teamOf(ctx, r.opp).name)}` : ''}">${fmt(r.pts)}<small>#${r.rank}${r.result ? ` · ${r.result}` : ''}</small></td>`;
    }).join('')}<td class="heat-avg"><b>${fmt(s.avg)}</b></td></tr>`;
  }).join('')}</tbody></table>`;
}

// A borrowed schedule's record against the team's real one; a tie counts as half a win.
export function swapTone(record, actual) {
  const score = r => r.w + (r.t || 0) / 2;
  return score(record) > score(actual) ? 'better' : score(record) < score(actual) ? 'worse' : 'same';
}

export function renderSwaps(ctx) {
  const holder = $('#swapTable'), rows = byPower(ctx), records = ctx.season.schedule;
  if (!ctx.season.playedWeeks.length) { holder.innerHTML = '<div class="empty">No completed weeks yet.</div>'; return; }
  const short = name => name.length > 11 ? `${name.slice(0, 10)}…` : name;
  holder.innerHTML = `<table class="data-table swap"><thead><tr>${colHead('Scores ↓ / Schedule →', 'Row = scores, column = schedule')}${rows.map(s => colHead(short(teamOf(ctx, s.id).name), teamOf(ctx, s.id).name)).join('')}</tr></thead><tbody>${rows.map(s => {
    const actual = records[s.id][s.id];
    return `<tr>${rowHead(teamOf(ctx, s.id).name)}${rows.map(o => {
      const r = records[s.id][o.id];
      return `<td class="${swapTone(r, actual)}${s.id === o.id ? ' actual' : ''}" title="${esc(teamOf(ctx, s.id).name)} with ${esc(teamOf(ctx, o.id).name)}'s schedule">${recordText(r.w, r.l, r.t)}</td>`;
    }).join('')}</tr>`;
  }).join('')}</tbody></table><p class="table-note">Green beats the team's real record, red is worse, and gray matches it (a tie counts as half a win). Outlined cells are real records. If you borrow the schedule of a team you actually played, you face that team instead.</p>`;
}

// ---------------------------------------------------------------- Draft postmortem
const pickName = p => p.position === 'DEF' ? `${p.playerId} D/ST` : p.name.replace(/^(\S)\S*\s+/, '$1. ');

function pickHtml(p) {
  const tone = !p.retained ? 'gone' : p.tier ? `h${p.tier}` : 'ungraded';
  const rate = p.perStart == null ? 'no starts yet' : `${fmt(p.perStart)} points per start`;
  const grade = p.quality == null ? 'grade pending' : `${ordinal(Math.round(p.quality * 100))} percentile among drafted ${p.position}s`;
  const label = [`${p.name}, ${p.position}, pick ${p.pickNo}`, p.retained ? '' : `${p.departure} by the drafting team`, plural(p.starts, 'start'), `${fmt(p.points)} points`, rate, grade].filter(Boolean).join(' · ');
  return `<button type="button" class="draft-pick ${tone}" data-player="${esc(p.playerId)}" title="${esc(label)}" aria-label="${esc(label)}"><b>${esc(pickName(p))}</b><small>${esc(p.position)} · #${p.pickNo}${p.perStart != null ? ` · ${fmt(p.perStart)}/start` : ''}</small>${p.retained ? '' : `<em class="${p.departure === 'Traded' ? 'traded' : 'dropped'}">${esc(p.departure)}</em>`}</button>`;
}

export function renderDraft(ctx) {
  const holder = $('#draftBoard'), board = ctx.draft;
  if (!holder) return;
  if (!board) { holder.innerHTML = ctx.draftError ? `<div class="empty">Couldn't load the draft from Sleeper. ${esc(ctx.draftError)}</div>` : '<div class="empty">Loading the draft board…</div>'; return; }
  if (!board.picks.length) { holder.innerHTML = '<div class="empty">No draft picks yet. The board fills in after the draft.</div>'; return; }
  const kept = id => board.picks.filter(p => p.rosterId === id && p.retained).length, made = id => board.picks.filter(p => p.rosterId === id).length;
  const head = board.columns.map(c => {
    const t = teamOf(ctx, c.rosterId);
    return `<th scope="col" title="${esc(t.name)}: ${kept(c.rosterId)} of ${made(c.rosterId)} picks still on the roster"><span class="grid-label draft-team"><small>${c.slot ? `Pick ${c.slot} · ` : ''}${kept(c.rosterId)}/${made(c.rosterId)} kept</small><b>${esc(t.name)}</b></span></th>`;
  }).join('');
  const body = board.rounds.map(({round, cells}) => `<tr>${rowHead(`Rd ${round}`, `Round ${round}`)}${board.columns.map(c => {
    const picks = cells[c.rosterId] || [];
    return `<td>${picks.length ? picks.map(pickHtml).join('') : '<span class="draft-none" aria-label="No pick">—</span>'}</td>`;
  }).join('')}</tr>`).join('');
  holder.innerHTML = `<div class="draft-scroll" tabindex="0" role="region" aria-label="Draft board. Scrolls sideways for more teams and down for more rounds."><table class="data-table draft"><thead><tr>${colHead('Round')}${head}</tr></thead><tbody>${body}</tbody></table></div>`;
}

// ---------------------------------------------------------------- Scoring ranges
export function renderProfiles(ctx) {
  const holder = $('#profileChart'), rows = [...ctx.season.teams.values()].filter(s => s.weekly.length).sort((a, b) => b.avg - a.avg);
  if (!rows.length) { holder.innerHTML = '<div class="empty">No completed weeks yet.</div>'; return; }
  const all = rows.flatMap(s => s.weekly.map(r => r.pts)), league = mean(all);
  const high = rows.flatMap(s => s.weekly.map(r => ({s, ...r}))).sort((a, b) => b.pts - a.pts)[0];
  const steady = rows.filter(s => s.weekly.length > 1).sort((a, b) => a.sd - b.sd)[0] || rows[0];
  const lo = Math.max(0, Math.floor((Math.min(...all) - 10) / 10) * 10), hi = Math.ceil((Math.max(...all) + 10) / 10) * 10;
  const W = 960, left = 190, right = 40, rowH = 44, top = 10, H = top + rows.length * rowH + 40;
  const x = v => left + (v - lo) / (hi - lo) * (W - left - right), step = hi - lo > 120 ? 25 : hi - lo > 60 ? 20 : 10;
  let svg = '';
  for (let v = Math.ceil(lo / step) * step; v <= hi; v += step) svg += `<line class="grid" x1="${x(v)}" x2="${x(v)}" y1="${top}" y2="${top + rows.length * rowH}"/><text x="${x(v)}" y="${top + rows.length * rowH + 20}" text-anchor="middle">${v}</text>`;
  rows.forEach((s, i) => {
    const y = top + i * rowH + rowH / 2, name = teamOf(ctx, s.id).name;
    svg += `<g><title>${esc(name)}: floor ${fmt(s.floor)}, average ${fmt(s.avg)}, ceiling ${fmt(s.ceiling)}</title><text class="team-label" x="${left - 14}" y="${y + 4}" text-anchor="end">${esc(name.length > 22 ? `${name.slice(0, 21)}…` : name)}</text>
      <line class="range" x1="${x(s.floor)}" x2="${x(s.ceiling)}" y1="${y}" y2="${y}"/><circle class="end" cx="${x(s.floor)}" cy="${y}" r="5"/><circle class="end" cx="${x(s.ceiling)}" cy="${y}" r="5"/>
      <circle class="avg" cx="${x(s.avg)}" cy="${y}" r="7"/><text class="val" x="${x(s.avg)}" y="${y - 12}" text-anchor="middle">${fmt(s.avg)}</text>
      <text class="val" x="${x(s.floor) - 10}" y="${y + 4}" text-anchor="end">${fmt(s.floor, 0)}</text><text class="val" x="${x(s.ceiling) + 10}" y="${y + 4}">${fmt(s.ceiling, 0)}</text></g>`;
  });
  svg += `<line class="league" x1="${x(league)}" x2="${x(league)}" y1="${top - 4}" y2="${top + rows.length * rowH}"/>`;
  holder.innerHTML = `<div class="profile-summary">
      <div class="mini-tile"><small>League average</small><strong>${fmt(league)}</strong><span>points per team per week (gold line)</span></div>
      <div class="mini-tile"><small>Best single week</small><strong>${fmt(high.pts)}</strong><span>${esc(teamOf(ctx, high.s.id).name)} · Week ${high.week}</span></div>
      <div class="mini-tile"><small>Steadiest</small><strong>${fmt(steady.sd)} σ</strong><span>${esc(teamOf(ctx, steady.id).name)}</span></div></div>
    <div class="scroll-x"><svg class="chart-svg" viewBox="0 0 ${W} ${H}" role="img" aria-label="Scoring range for each team: lowest, average, and highest weekly score" style="min-width:560px">${svg}</svg></div>`;
}

// ---------------------------------------------------------------- Moves
const playerName = (ctx, id) => ctx.players?.[id]?.name || (/^[A-Z]{2,3}$/.test(id) ? `${id} D/ST` : `Player ${id}`);
function moveTitle(ctx, m) {
  const names = ids => ids.map(id => playerName(ctx, id)).join(', ');
  if (m.received.length && m.sent.length) return `${names(m.received)} for ${names(m.sent)}`;
  if (m.received.length) return `Added ${names(m.received)}`;
  if (m.sent.length) return `Dropped ${names(m.sent)}`;
  return m.picks.length ? 'Draft picks swapped' : 'FAAB exchanged';
}
const playerLink = (ctx, id) => `<button type="button" class="linkish" data-player="${esc(id)}">${esc(playerName(ctx, id))}</button>`;
const moveKind = m => m.type === 'trade' ? 'Trade' : m.type === 'waiver' ? 'Waiver claim' : 'Free agent';

export function renderMoves(ctx) {
  const holder = $('#movesReport');
  if (ctx.movesError) { holder.innerHTML = `<div class="empty">Couldn't grade moves: ${esc(ctx.movesError)}</div>`; return; }
  if (!ctx.moves) { holder.innerHTML = '<div class="empty">Grading trades and waiver moves…</div>'; return; }
  const all = [...ctx.moves.values()].flat(), graded = all.filter(m => m.rows.length);
  const order = byPower(ctx).map(s => s.id).filter(id => ctx.moves.has(id)).concat([...ctx.teams.keys()].filter(id => !ctx.moves.has(id)));
  if (!order.includes(ui.moveTeam)) ui.moveTeam = null;
  const moves = ctx.moves.get(ui.moveTeam) || [];
  if (!moves.some(m => m.id === ui.moveId)) ui.moveId = null;
  const best = [...graded].sort((a, b) => b.impact - a.impact)[0], worst = [...graded].sort((a, b) => a.impact - b.impact)[0];
  const tile = (label, m) => m ? `<div class="mini-tile"><small>${label}</small><strong class="${m.impact > 0 ? 'good' : m.impact < 0 ? 'bad' : ''}">${signed(m.impact)} pts</strong><span>${esc(teamOf(ctx, m.rosterId).name)} · ${esc(moveTitle(ctx, m))}</span></div>` : '';
  const summary = graded.length ? `<div class="profile-summary">${tile('Best move in the league', best)}${tile('Biggest regret', worst)}<div class="mini-tile"><small>Moves graded</small><strong>${graded.length}</strong><span>of ${all.length} trades, claims &amp; pickups</span></div></div>` : '';
  const controls = `<div class="controls-row"><label class="select-label" for="moveTeam">Team<select id="moveTeam">${ui.moveTeam == null ? '<option value="" selected disabled>Select a team…</option>' : ''}${order.map(id => `<option value="${id}" ${id === ui.moveTeam ? 'selected' : ''}>${esc(teamOf(ctx, id).name)} (${ctx.moves.get(id)?.length || 0})</option>`).join('')}</select></label></div>`;
  if (ui.moveTeam == null) { holder.innerHTML = summary + controls + '<div class="report-prompt"><span aria-hidden="true">👆</span><p><b>No team selected</b>Pick a team above to see every trade, waiver claim, and pickup it has made, and how each one graded.</p></div>'; return; }
  if (!moves.length) { holder.innerHTML = summary + controls + '<div class="empty">No completed trades or pickups for this team yet.</div>'; return; }
  const list = `<div class="move-list" role="listbox" aria-label="Moves">${moves.map(x => `<button type="button" class="move-mini" data-move="${esc(x.id)}" aria-pressed="${x.id === ui.moveId}"><span>${moveKind(x)} · Wk ${x.week} · ${esc(moveTitle(ctx, x))}</span><b class="${x.impact > 0 ? 'good' : x.impact < 0 ? 'bad' : ''}">${x.rows.length ? signed(x.impact) : '—'}</b></button>`).join('')}</div>`;
  const layout = inner => `${summary}${controls}<div class="pbp-layout" style="grid-template-columns:minmax(0,1fr) minmax(0,2fr);margin-top:0">${list}${inner}</div>`;
  const m = moves.find(x => x.id === ui.moveId);
  if (!m) { holder.innerHTML = layout(`<div class="report-prompt"><span class="point-left" aria-hidden="true">👈</span><p><b>No move selected</b>Pick one of ${esc(teamOf(ctx, ui.moveTeam).name)}'s ${plural(moves.length, 'move')} to see how it graded week by week.</p></div>`); return; }
  const partner = m.type === 'trade' && m.partners.length ? ` · with ${m.partners.map(id => esc(teamOf(ctx, id).name)).join(', ')}` : '';
  const extras = [m.bid ? `$${m.bid} FAAB bid` : '', m.picks.length ? plural(m.picks.length, 'draft pick') + ' (not graded)' : ''].filter(Boolean).join(' · ');
  const rows = m.rows.map(r => {
    const res = (a, b) => b == null ? '—' : a > b ? 'W' : a < b ? 'L' : 'T';
    return `<tr><td>Week ${r.week}</td><td>${fmt(r.withBest)}</td><td>${fmt(r.withoutBest)}</td><td class="${r.impact > 0 ? 'good' : r.impact < 0 ? 'bad' : ''}"><b>${signed(r.impact)}</b></td><td>${fmt(r.actual)} vs ${r.oppPts == null ? '—' : fmt(r.oppPts)}</td><td>${res(r.alt, r.oppPts)} → ${res(r.actual, r.oppPts)}</td></tr>`;
  }).join('');
  holder.innerHTML = layout(`
    <article class="move-card">
      <div class="move-head"><div><div class="move-kicker">${moveKind(m)} · Week ${m.week}${partner}${extras ? ` · ${extras}` : ''}</div><h3>${esc(moveTitle(ctx, m))}</h3>
        <div class="move-swap">${m.received.length ? `<span class="in"><b>In</b>${m.received.map(id => playerLink(ctx, id)).join(', ')}</span>` : ''}${m.sent.length ? `<span class="out"><b>Out</b>${m.sent.map(id => playerLink(ctx, id)).join(', ')}</span>` : ''}</div></div>
        <div class="verdict"><strong class="${m.impact > 0 ? 'good' : m.impact < 0 ? 'bad' : ''}">${m.rows.length ? `${signed(m.impact)}` : m.unrated ? 'N/A' : 'TBD'}</strong><span>${m.rows.length ? `pts over ${plural(m.rows.length, 'week')}` : m.unrated ? 'Only picks or FAAB moved' : 'No completed weeks yet'}</span></div></div>
      ${m.rows.length ? `<div class="move-tiles"><div class="mini-tile"><small>Wins it changed</small><strong class="${m.swing > 0 ? 'good' : m.swing < 0 ? 'bad' : ''}">${signed(m.swing, m.swing % 1 ? 1 : 0)}</strong><span>same opponents, same week</span></div><div class="mini-tile"><small>Started points</small><strong>${fmt(m.startedIn)}</strong><span>from players brought in</span></div><div class="mini-tile"><small>Departed players scored</small><strong>${fmt(m.rows.reduce((t, r) => t + r.sentScored, 0))}</strong><span>wherever they ended up</span></div></div>
      <div class="scroll-x"><table class="move-weeks"><thead><tr><th>Week</th><th>Best with</th><th>Best without</th><th>Impact</th><th>Actual</th><th>Result w/o → with</th></tr></thead><tbody>${rows}</tbody></table></div>` : ''}
      <p class="history-note">Impact compares the best possible lineup each week with and without the move, using real scores. "Wins it changed" subtracts that impact from what you actually scored.${m.capped ? ' Grading stops when one of these players moves again.' : ''}</p>
    </article>`);
}
export function bindMoves(ctx) {
  const holder = $('#movesReport');
  holder.addEventListener('change', e => { if (e.target.id === 'moveTeam') { ui.moveTeam = Number(e.target.value); ui.moveId = null; renderMoves(ctx()); $('#moveTeam').focus(); } });
  holder.addEventListener('click', e => {
    const b = e.target.closest('.move-mini');
    if (!b) return;
    ui.moveId = b.dataset.move;
    renderMoves(ctx());
    holder.querySelector(`[data-move="${CSS.escape(ui.moveId)}"]`)?.focus({preventScroll: true});
    // Below 1020px the details stack under the list, so bring them into view.
    if (matchMedia('(max-width: 1020px)').matches) holder.querySelector('.move-card')?.scrollIntoView({behavior: 'smooth', block: 'start'});
  });
}

// ---------------------------------------------------------------- Power movement (bump chart)
export function renderBump(ctx) {
  const holder = $('#bumpChart'), rows = byPower(ctx).filter(s => s.history.length), weeks = ctx.season.playedWeeks;
  if (!rows.length) { holder.innerHTML = '<div class="empty">Power movement appears after Week 1.</div>'; return; }
  const n = rows.length, W = 980, left = 40, right = 170, top = 20, H = top + (n - 1) * 40 + 50;
  const x = i => weeks.length === 1 ? (left + W - right) / 2 : left + i * (W - left - right) / (weeks.length - 1), y = r => top + (r - 1) * 40;
  let svg = '';
  for (let r = 1; r <= n; r++) svg += `<line class="grid" x1="${left}" x2="${W - right}" y1="${y(r)}" y2="${y(r)}" stroke="var(--line)"/><text x="${left - 14}" y="${y(r) + 4}" text-anchor="end">${r}</text>`;
  weeks.forEach((w, i) => { svg += `<text x="${x(i)}" y="${H - 12}" text-anchor="middle">Wk ${w}</text>`; });
  svg += rows.map((s, i) => {
    const color = SERIES[i % SERIES.length], pts = s.history.map((h, j) => `${x(j)},${y(h.rank)}`).join(' '), last = s.history.at(-1), name = teamOf(ctx, s.id).name;
    return `<g class="series ${ui.bumpFocus === s.id ? 'on' : ''}" data-team="${s.id}" style="--c:${color}"><polyline points="${pts}"/><polyline class="hit" points="${pts}"/>${s.history.map((h, j) => `<circle cx="${x(j)}" cy="${y(h.rank)}" r="4.5"><title>${esc(name)} · Week ${h.week}: #${h.rank} (${fmt(h.power)} power)</title></circle>`).join('')}<text x="${W - right + 14}" y="${y(last.rank) + 4}">${esc(name.length > 18 ? `${name.slice(0, 17)}…` : name)}</text></g>`;
  }).join('');
  holder.innerHTML = `<div class="bump-scroll"><svg class="chart-svg bump ${ui.bumpFocus ? 'focusing' : ''}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Power rank of every team after each week; rank 1 at the top">${svg}</svg></div>
    <div class="bump-keys">${rows.map((s, i) => `<button type="button" class="bump-key" data-team="${s.id}" style="--c:${SERIES[i % SERIES.length]}" aria-pressed="${ui.bumpFocus === s.id}"><i></i>${esc(teamOf(ctx, s.id).name)}</button>`).join('')}</div>`;
}
export function bindBump() {
  const holder = $('#bumpChart');
  const apply = id => {
    const svg = holder.querySelector('.bump');
    if (!svg) return;
    svg.classList.toggle('focusing', id != null);
    svg.querySelectorAll('.series').forEach(g => g.classList.toggle('on', Number(g.dataset.team) === id));
    holder.querySelectorAll('.bump-key').forEach(b => b.setAttribute('aria-pressed', String(Number(b.dataset.team) === ui.bumpFocus)));
  };
  holder.addEventListener('click', e => {
    const el = e.target.closest('[data-team]');
    if (!el) return;
    const id = Number(el.dataset.team);
    ui.bumpFocus = ui.bumpFocus === id ? null : id;
    apply(ui.bumpFocus);
  });
  holder.addEventListener('mouseover', e => { const g = e.target.closest('.series'); if (g) apply(Number(g.dataset.team)); });
  holder.addEventListener('mouseout', e => { if (e.target.closest('.series')) apply(ui.bumpFocus); });
}

// ---------------------------------------------------------------- All-time
const HISTORY_COLS = [
  ['seasons', 'Seasons'], ['titles', 'Titles'], ['record', 'Record'], ['winPct', 'Win %'], ['ppg', 'Pts / game'], ['avgFinish', 'Avg finish'], ['legacy', 'Legacy']
];
export function renderHistory(ctx) {
  const holder = $('#historyBoard'), history = ctx.history;
  if (ctx.historyError && !history) { holder.innerHTML = `<div class="empty">Couldn't load past seasons: ${esc(ctx.historyError)}</div>`; return; }
  if (!history) { holder.innerHTML = '<div class="empty">Loading past seasons…</div>'; return; }
  const years = history.seasons.map(s => s.year);
  if (ui.historyYear && !years.includes(ui.historyYear)) ui.historyYear = '';
  const rows = managerTable(history, ui.historyYear);
  const key = ui.historySort, dir = ui.historyDir;
  const value = r => key === 'record' ? r.winPct : key === 'avgFinish' ? (r.avgFinish ?? 99) : key === 'titles' ? r.titles * 100 + r.runnerUps : r[key];
  rows.sort((a, b) => dir * (value(a) - value(b)) || b.legacy - a.legacy || b.winPct - a.winPct);
  const champs = champions(history);
  const strip = champs.length ? `<div class="champs">${champs.map(c => `<div class="champ"><small>🏆 ${c.year} champion</small><strong>${esc(c.champ?.manager || '—')}</strong><span>${esc(c.champ?.teamName || '')}${c.runnerUp ? `${c.champ?.teamName ? ' · ' : ''}beat ${esc(c.runnerUp.manager)} in the final` : ''}</span></div>`).join('')}</div>` : '';
  const season = history.seasons.find(s => s.year === ui.historyYear);
  holder.innerHTML = `${strip}<div class="controls-row"><label class="select-label" for="historyYear">Seasons<select id="historyYear"><option value="">All seasons (${years.at(-1)}–${years[0]})</option>${history.seasons.map(s => `<option value="${s.year}" ${s.year === ui.historyYear ? 'selected' : ''}>${s.year}${s.complete ? '' : ' · in progress'}</option>`).join('')}</select></label></div>
    <div class="scroll-x"><table class="lb"><thead><tr><th scope="col"><button type="button" disabled>#</button></th><th scope="col"><button type="button" disabled>Manager</button></th>${HISTORY_COLS.map(([k, label]) => `<th scope="col" ${k === key ? `aria-sort="${dir < 0 ? 'descending' : 'ascending'}"` : ''}><button type="button" data-sort="${k}">${label}</button></th>`).join('')}</tr></thead>
    <tbody>${rows.map((r, i) => `<tr><td class="place">${i + 1}</td><td><div class="who">${avatar({name: r.manager, avatar: r.avatar ? `https://sleepercdn.com/avatars/thumbs/${r.avatar}` : ''})}<div>${esc(r.manager)}<small>${esc(r.teamName || '')}${r.teamName ? ' · ' : ''}${r.years.length > 1 ? `${r.years.at(-1)}–${r.years[0]}` : r.years[0]}</small></div></div></td>
      <td>${r.seasons}</td><td class="trophies" title="${r.titles} titles, ${r.runnerUps} runner-up">${r.titles ? '🏆'.repeat(r.titles) : r.runnerUps ? '🥈' : '—'}</td><td>${recordText(r.wins, r.losses, r.ties)}</td><td>${pct(r.winPct, 1)}</td><td>${fmt(r.ppg)}</td><td>${r.avgFinish == null ? '—' : ui.historyYear ? ordinal(r.avgFinish) : fmt(r.avgFinish)}</td><td><b>${r.completed ? fmt(r.legacy) : '—'}</b></td></tr>`).join('')}</tbody></table></div>
    <p class="history-note">Legacy score: each finished season is worth up to 100 points: 50 for final place (champion down to last), 30 for regular-season win %, 20 for points scored, each scaled within that season. Records and points include the season in progress; finishes and legacy only count completed seasons.${season && !season.complete ? ' This season is still being played.' : ''}${history.error ? ` Some older seasons could not be loaded (${esc(history.error)}).` : ''}</p>`;
}
export function bindHistory(ctx) {
  const holder = $('#historyBoard');
  holder.addEventListener('change', e => { if (e.target.id === 'historyYear') { ui.historyYear = e.target.value; renderHistory(ctx()); $('#historyYear').focus(); } });
  holder.addEventListener('click', e => {
    const b = e.target.closest('[data-sort]');
    if (!b) return;
    const k = b.dataset.sort;
    if (ui.historySort === k) ui.historyDir *= -1; else { ui.historySort = k; ui.historyDir = k === 'avgFinish' ? 1 : -1; }
    renderHistory(ctx());
    holder.querySelector(`[data-sort="${k}"]`)?.focus();
  });
}
