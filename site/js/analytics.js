// Season analytics built from Sleeper weekly matchups: power scores, all-play, luck, awards inputs,
// schedule swaps, and simulated playoff odds.
import {mean, std, median, percentileRanks, recencyWeighted, seededRandom, gaussian, round2} from './util.js';

export const POWER_WEIGHTS = {allPlay: 0.40, scoring: 0.35, form: 0.25};
export const entryPoints = entry => Number(entry?.custom_points ?? entry?.points ?? 0);

export function pairsFor(entries) {
  const groups = new Map();
  for (const entry of entries || []) {
    if (entry.matchup_id == null) continue;
    const key = String(entry.matchup_id);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(entry);
  }
  return [...groups.entries()].sort((a, b) => Number(a[0]) - Number(b[0])).map(([id, list]) => ({matchupId: Number(id), entries: list}));
}

function blank() {
  return {weekly: [], wins: 0, losses: 0, ties: 0, pf: 0, pa: 0, expectedWins: 0, allPlay: {w: 0, l: 0, t: 0},
    badBeats: 0, luckyWins: 0, highs: 0, lows: 0, defPoints: 0, defStarts: 0, closest: null, blowout: null, history: []};
}

function powerTable(ids, stats, upto) {
  const exp = {}, scoring = {}, form = {};
  for (const id of ids) {
    const rows = stats.get(id).weekly.slice(0, upto);
    exp[id] = mean(rows.map(r => r.expected));
    scoring[id] = mean(rows.map(r => r.z));
    form[id] = recencyWeighted(rows.map(r => r.z));
  }
  const ep = percentileRanks(exp), sp = percentileRanks(scoring), fp = percentileRanks(form);
  const table = ids.map(id => ({id, power: POWER_WEIGHTS.allPlay * ep[id] + POWER_WEIGHTS.scoring * sp[id] + POWER_WEIGHTS.form * fp[id],
    pf: stats.get(id).weekly.slice(0, upto).reduce((t, r) => t + r.pts, 0)}));
  table.sort((a, b) => b.power - a.power || b.pf - a.pf);
  return {table, parts: {ep, sp, fp}, raw: {exp, scoring, form}};
}

export function analyzeSeason({rosterIds, weeks, completedWeeks, remainingWeeks = [], rosterPositions = [], playoffTeams = 6, seed = 'cuzzo', sims = 4000}) {
  const ids = rosterIds.map(Number), stats = new Map(ids.map(id => [id, blank()]));
  const defSlots = rosterPositions.map((slot, i) => slot === 'DEF' ? i : -1).filter(i => i >= 0);
  const played = [];
  for (const week of completedWeeks) {
    const entries = (weeks.get(week) || []).filter(e => stats.has(Number(e.roster_id)));
    if (entries.length < 2) continue;
    played.push(week);
    const scores = entries.map(entryPoints), avg = mean(scores), spread = std(scores), med = median(scores), n = scores.length;
    for (const entry of entries) {
      const id = Number(entry.roster_id), s = stats.get(id), pts = entryPoints(entry);
      const beat = scores.filter(x => pts > x).length, tied = scores.filter(x => x === pts).length - 1, rank = 1 + scores.filter(x => x > pts).length;
      const expected = (beat + 0.5 * tied) / (n - 1);
      s.weekly.push({week, pts, rank, z: spread ? (pts - avg) / spread : 0, expected, median: med, leagueAvg: avg, opp: null, oppPts: null, result: null});
      s.expectedWins += expected; s.allPlay.w += beat; s.allPlay.t += tied; s.allPlay.l += n - 1 - beat - tied;
      if (rank === 1) s.highs++;
      if (rank === n) s.lows++;
      for (const i of defSlots) {
        const pid = entry.starters?.[i];
        if (!pid || pid === '0') continue;
        const value = entry.starters_points?.[i] ?? entry.players_points?.[pid];
        if (value != null && Number.isFinite(Number(value))) { s.defPoints += Number(value); s.defStarts++; }
      }
    }
    for (const {entries: pair} of pairsFor(entries)) {
      if (pair.length !== 2) continue;
      const [a, b] = pair;
      for (const [me, them] of [[a, b], [b, a]]) {
        const s = stats.get(Number(me.roster_id)), pts = entryPoints(me), opp = entryPoints(them), margin = pts - opp;
        const row = s.weekly.at(-1);
        row.opp = Number(them.roster_id); row.oppPts = opp; row.result = margin > 0 ? 'W' : margin < 0 ? 'L' : 'T';
        if (margin > 0) s.wins++; else if (margin < 0) s.losses++; else s.ties++;
        s.pf += pts; s.pa += opp;
        if (margin < 0 && pts > med) s.badBeats++;
        if (margin > 0 && pts < med) s.luckyWins++;
        const game = {week, margin, abs: Math.abs(margin), opp: Number(them.roster_id)};
        if (!s.closest || game.abs < s.closest.abs) s.closest = game;
        if (!s.blowout || game.abs > s.blowout.abs) s.blowout = game;
      }
    }
  }

  // Power score after each completed week drives the movement chart and the up/down arrows.
  for (let k = 1; k <= played.length; k++) {
    const {table} = powerTable(ids, stats, k);
    table.forEach((row, index) => stats.get(row.id).history.push({week: played[k - 1], rank: index + 1, power: row.power}));
  }
  const final = powerTable(ids, stats, played.length);
  final.table.forEach((row, index) => {
    const s = stats.get(row.id);
    Object.assign(s, {power: played.length ? row.power : 0, powerRank: index + 1, prevRank: s.history.at(-2)?.rank ?? null,
      expectedRate: final.raw.exp[row.id], scoringZ: final.raw.scoring[row.id], formZ: final.raw.form[row.id],
      parts: {allPlay: final.parts.ep[row.id], scoring: final.parts.sp[row.id], form: final.parts.fp[row.id]}});
  });
  for (const [id, s] of stats) {
    const pts = s.weekly.map(r => r.pts);
    s.id = id; s.games = s.wins + s.losses + s.ties;
    s.avg = mean(pts); s.sd = std(pts); s.floor = pts.length ? Math.min(...pts) : 0; s.ceiling = pts.length ? Math.max(...pts) : 0;
    s.avgRank = mean(s.weekly.map(r => r.rank));
    s.luck = s.wins + 0.5 * s.ties - s.expectedWins;
    s.winPct = s.games ? (s.wins + 0.5 * s.ties) / s.games : 0;
  }
  const allPlayScore = s => s.allPlay.w + 0.5 * s.allPlay.t;
  for (const s of stats.values()) s.allPlayRank = 1 + [...stats.values()].filter(o => allPlayScore(o) > allPlayScore(s)).length;

  const standings = [...stats.values()].sort((a, b) => b.winPct - a.winPct || b.wins - a.wins || b.pf - a.pf);
  standings.forEach((s, i) => { s.seed = i + 1; });

  const odds = simulatePlayoffs({ids, stats, weeks, remainingWeeks, playoffTeams, seed, sims});
  for (const [id, s] of stats) Object.assign(s, odds[id]);
  return {teams: stats, playedWeeks: played, schedule: scheduleSwaps(ids, weeks, played), leagueAvg: mean([...stats.values()].flatMap(s => s.weekly.map(r => r.pts)))};
}

// What each team's record would be if it had played another team's schedule.
export function scheduleSwaps(ids, weeks, played) {
  const records = Object.fromEntries(ids.map(i => [i, Object.fromEntries(ids.map(j => [j, {w: 0, l: 0, t: 0}]))]));
  for (const week of played) {
    const entries = (weeks.get(week) || []).filter(e => ids.includes(Number(e.roster_id)));
    const byId = new Map(entries.map(e => [Number(e.roster_id), entryPoints(e)])), opponent = new Map();
    for (const {entries: pair} of pairsFor(entries)) {
      if (pair.length !== 2) continue;
      const a = Number(pair[0].roster_id), b = Number(pair[1].roster_id);
      opponent.set(a, b); opponent.set(b, a);
    }
    for (const i of ids) {
      if (!byId.has(i)) continue;
      for (const j of ids) {
        let opp = opponent.get(j);
        if (opp === i && j !== i) opp = j; // borrowing the schedule of the team you actually played: face them instead
        if (opp == null || !byId.has(opp)) continue;
        const cell = records[i][j], mine = byId.get(i), theirs = byId.get(opp);
        if (mine > theirs) cell.w++; else if (mine < theirs) cell.l++; else cell.t++;
      }
    }
  }
  return records;
}

// Monte Carlo of the rest of the regular season. Each team's scoring is modeled as a normal distribution
// whose mean and spread are shrunk toward the league so three-week samples do not dominate.
export function simulatePlayoffs({ids, stats, weeks, remainingWeeks, playoffTeams, seed, sims = 4000}) {
  const all = [...stats.values()].flatMap(s => s.weekly.map(r => r.pts));
  const leagueMean = all.length ? mean(all) : 110, leagueSd = all.length > 3 ? std(all) : 25, prior = 3;
  const model = new Map(ids.map(id => {
    const pts = stats.get(id).weekly.map(r => r.pts), n = pts.length;
    const mu = (pts.reduce((t, x) => t + x, 0) + prior * leagueMean) / (n + prior);
    const variance = (n * std(pts) ** 2 + prior * leagueSd ** 2) / (n + prior);
    return [id, {mu, sd: Math.sqrt(variance)}];
  }));
  const schedule = remainingWeeks.map(week => pairsFor(weeks.get(week) || []).filter(p => p.entries.length === 2).map(p => p.entries.map(e => Number(e.roster_id))));
  const byes = Math.max(0, 2 ** Math.ceil(Math.log2(Math.max(1, playoffTeams))) - playoffTeams);
  const counts = Object.fromEntries(ids.map(id => [id, {playoffs: 0, bye: 0, first: 0, seedSum: 0}]));
  const rng = seededRandom(`${seed}:${remainingWeeks.join(',')}`), cut = Math.min(playoffTeams, ids.length);
  for (let sim = 0; sim < sims; sim++) {
    const table = new Map(ids.map(id => { const s = stats.get(id); return [id, {id, wins: s.wins + 0.5 * s.ties, pf: s.pf}]; }));
    for (const pairs of schedule) for (const [a, b] of pairs) {
      if (!table.has(a) || !table.has(b)) continue;
      const ma = model.get(a), mb = model.get(b);
      const pa = ma.mu + ma.sd * gaussian(rng), pb = mb.mu + mb.sd * gaussian(rng);
      table.get(a).pf += pa; table.get(b).pf += pb;
      if (pa > pb) table.get(a).wins++; else if (pb > pa) table.get(b).wins++; else { table.get(a).wins += 0.5; table.get(b).wins += 0.5; }
    }
    const order = [...table.values()].sort((x, y) => y.wins - x.wins || y.pf - x.pf);
    order.forEach((row, i) => {
      const c = counts[row.id];
      c.seedSum += i + 1;
      if (i < cut) c.playoffs++;
      if (i < byes) c.bye++;
      if (i === 0) c.first++;
    });
  }
  return Object.fromEntries(ids.map(id => [id, {playoffOdds: counts[id].playoffs / sims, byeOdds: counts[id].bye / sims, topSeedOdds: counts[id].first / sims,
    projectedSeed: round2(counts[id].seedSum / sims), byes}]));
}
