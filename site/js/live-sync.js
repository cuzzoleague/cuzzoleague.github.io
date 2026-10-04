// One fantasy point total per player that every live view shows.
//
// Sleeper's numbers are official but lag the action; ESPN's play-by-play usually lands first. A player's
// shown total is Sleeper's latest number plus any ESPN plays Sleeper hasn't caught up with yet ("pending").
// When Sleeper's number moves, the oldest pending plays that explain the move are treated as counted.
// If Sleeper moves first, the unexplained change is held as "credit" so the matching ESPN play,
// when it arrives, isn't counted twice.
import {round2} from './util.js';

export function createLiveSync({clock = () => Date.now(), tolerance = 0.6, pendingTtl = 5 * 60_000, creditTtl = 3 * 60_000} = {}) {
  const players = new Map(), baselined = new Set(), seen = new Map();

  const get = key => {
    if (!players.has(key)) players.set(key, {sources: {}, official: null, pending: [], credit: []});
    return players.get(key);
  };
  const expire = s => {
    const now = clock();
    s.pending = s.pending.filter(p => now - p.at < pendingTtl);
    s.credit = s.credit.filter(c => now - c.at < creditTtl);
  };
  // Among Sleeper's feeds, the one that changed most recently is the freshest; first sightings tie at 0.
  const freshest = s => Object.values(s.sources).reduce((best, src) => !best || src.changedAt > best.changedAt || (src.changedAt === best.changedAt && src.value > best.value) ? src : best, null)?.value ?? null;

  // A Sleeper number for a player: source is 'matchup' (league lineups) or 'stats' (weekly stat lines).
  function official(week, id, source, value) {
    if (value == null || !Number.isFinite(value)) return;
    const s = get(`${week}:${id}`), prev = s.sources[source];
    if (prev && Math.abs(prev.value - value) < 0.005) return;
    s.sources[source] = {value, changedAt: prev ? clock() : 0};
    const before = s.official;
    s.official = freshest(s);
    if (before == null) return;
    let delta = s.official - before;
    if (Math.abs(delta) < 0.005) return;
    expire(s);
    while (s.pending.length) {
      const p = s.pending[0];
      if (Math.sign(p.pts) !== Math.sign(delta) || Math.abs(p.pts) > Math.abs(delta) + tolerance) break;
      delta -= p.pts;
      s.pending.shift();
    }
    if (Math.abs(delta) > tolerance) s.credit.push({pts: delta, at: clock()});
  }

  // ESPN plays for one game ({id, involvements: [{playerId, pts}]}). The first look at a game is a baseline:
  // those plays are assumed to be in Sleeper's numbers already.
  function plays(week, gameId, items) {
    const gameKey = `${week}:${gameId}`, first = !baselined.has(gameKey);
    baselined.add(gameKey);
    for (const item of items) {
      const perPlayer = new Map();
      for (const inv of item.involvements) perPlayer.set(inv.playerId, (perPlayer.get(inv.playerId) || 0) + inv.pts);
      for (const [playerId, pts] of perPlayer) {
        const key = `${week}:${item.id}:${playerId}`, prev = seen.get(key);
        seen.set(key, pts);
        if (first || (prev != null && Math.abs(prev - pts) < 0.005)) continue;
        const delta = pts - (prev ?? 0); // a replay reversal can change what a play was worth
        if (Math.abs(delta) < 0.005) continue;
        const s = get(`${week}:${playerId}`);
        expire(s);
        const credit = s.credit.find(c => Math.sign(c.pts) === Math.sign(delta) && Math.abs(c.pts) >= Math.abs(delta) - tolerance);
        if (credit) {
          credit.pts -= delta;
          if (Math.abs(credit.pts) <= tolerance) s.credit.splice(s.credit.indexOf(credit), 1);
          continue;
        }
        s.pending.push({pts: delta, at: clock()});
      }
    }
  }

  function value(week, id) {
    const s = players.get(`${week}:${id}`);
    if (!s) return null;
    expire(s);
    if (s.official == null && !s.pending.length) return null;
    return round2((s.official ?? 0) + s.pending.reduce((t, p) => t + p.pts, 0));
  }

  return {official, plays, value};
}
