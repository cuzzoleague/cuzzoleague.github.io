// Grades trades and waiver moves in hindsight: for every completed week a move was in effect, compare the
// best possible lineup with the move against the best possible lineup without it.
import {optimalLineup, positionsOf} from './scoring.js';
import {round2} from './util.js';
import {entryPoints} from './analytics.js';

const moveTime = tx => Number(tx.status_updated || tx.created || 0);

export function describeMove(tx, rosterId) {
  const received = Object.entries(tx.adds || {}).filter(([, owner]) => Number(owner) === rosterId).map(([id]) => String(id));
  const sent = Object.entries(tx.drops || {}).filter(([, owner]) => Number(owner) === rosterId).map(([id]) => String(id));
  const picks = (tx.draft_picks || []).filter(p => Number(p.owner_id) === rosterId || Number(p.previous_owner_id) === rosterId);
  const faab = (tx.waiver_budget || []).reduce((total, item) => total + (Number(item.receiver) === rosterId ? Number(item.amount || 0) : Number(item.sender) === rosterId ? -Number(item.amount || 0) : 0), 0);
  const bid = tx.type === 'waiver' ? Number(tx.settings?.waiver_bid || 0) : 0;
  return {received, sent, picks, faab, bid};
}

// pointsFor(week, playerId) -> fantasy points that player scored that week (0 if they did not play).
export function gradeMoves({transactions, weeks, completedWeeks, rosterPositions, players, pointsFor}) {
  const done = new Set(completedWeeks);
  const moves = (transactions || []).filter(tx => tx?.status === 'complete' && ['trade', 'waiver', 'free_agent'].includes(tx.type)).sort((a, b) => moveTime(a) - moveTime(b));
  const byRoster = new Map();
  const candidates = (ids, week) => ids.map(id => ({id, pts: pointsFor(week, id), positions: positionsOf(id, players)}));

  moves.forEach((tx, index) => {
    for (const raw of tx.roster_ids || []) {
      const rosterId = Number(raw), move = describeMove(tx, rosterId);
      if (!move.received.length && !move.sent.length && !move.picks.length && !move.faab) continue;
      const assets = new Set([...move.received, ...move.sent]);
      const next = moves.slice(index + 1).find(later => [...Object.entries(later.adds || {}), ...Object.entries(later.drops || {})].some(([id, owner]) => Number(owner) === rosterId && assets.has(String(id))));
      const startWeek = Number(tx.leg || 1), endWeek = next ? Number(next.leg || startWeek) : Infinity;
      const rows = [];
      if (assets.size) for (const week of [...done].sort((a, b) => a - b)) {
        if (week < startWeek || (week >= endWeek && endWeek > startWeek)) continue;
        const entries = weeks.get(week) || [], entry = entries.find(e => Number(e.roster_id) === rosterId);
        if (!entry || !Array.isArray(entry.players)) continue;
        const roster = new Set(entry.players.map(String));
        if (!move.received.some(id => roster.has(id)) && !move.sent.some(id => !roster.has(id))) continue; // move not in effect yet
        const without = new Set([...roster].filter(id => !move.received.includes(id)));
        move.sent.forEach(id => without.add(id));
        const withBest = optimalLineup(candidates([...roster], week), rosterPositions);
        const withoutBest = optimalLineup(candidates([...without], week), rosterPositions);
        const impact = round2(withBest.total - withoutBest.total);
        const opponent = entries.find(e => e.matchup_id != null && e.matchup_id === entry.matchup_id && Number(e.roster_id) !== rosterId);
        const actual = entryPoints(entry), oppPts = opponent ? entryPoints(opponent) : null, alt = round2(actual - impact);
        const result = oppPts == null ? null : Math.sign(actual - oppPts), altResult = oppPts == null ? null : Math.sign(alt - oppPts);
        const started = new Set((entry.starters || []).map(String));
        rows.push({week, impact, withBest: withBest.total, withoutBest: withoutBest.total, actual, alt, oppPts,
          swing: result == null ? 0 : (result - altResult) / 2,
          startedIn: round2(move.received.filter(id => started.has(id)).reduce((t, id) => t + pointsFor(week, id), 0)),
          sentScored: round2(move.sent.reduce((t, id) => t + pointsFor(week, id), 0))});
      }
      const out = {id: `${tx.transaction_id}:${rosterId}`, rosterId, type: tx.type, week: startWeek, time: moveTime(tx), partners: (tx.roster_ids || []).map(Number).filter(id => id !== rosterId),
        ...move, rows, impact: round2(rows.reduce((t, r) => t + r.impact, 0)), swing: rows.reduce((t, r) => t + r.swing, 0),
        startedIn: round2(rows.reduce((t, r) => t + r.startedIn, 0)), capped: Boolean(next), unrated: !assets.size};
      if (!byRoster.has(rosterId)) byRoster.set(rosterId, []);
      byRoster.get(rosterId).push(out);
    }
  });
  for (const list of byRoster.values()) list.sort((a, b) => b.time - a.time);
  return byRoster;
}

// Merge league-rostered points with full weekly stat lines so players who left the league still count.
export function weeklyPointsLookup(weeks, statsByWeek, scoringFn) {
  const cache = new Map();
  return (week, id) => {
    const key = `${week}:${id}`;
    if (cache.has(key)) return cache.get(key);
    let pts = null;
    for (const entry of weeks.get(week) || []) if (entry.players_points && id in entry.players_points) { pts = Number(entry.players_points[id]); break; }
    if (pts == null) pts = scoringFn(statsByWeek.get(week)?.get(id)?.stats);
    cache.set(key, pts || 0);
    return pts || 0;
  };
}
