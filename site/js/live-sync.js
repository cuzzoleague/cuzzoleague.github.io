// One fantasy point total per player that every live view shows.
//
// Sleeper's numbers are official but usually lag the action; ESPN's play-by-play often lands first, though
// sometimes Sleeper does. A player's shown total is Sleeper's latest number plus any ESPN plays Sleeper hasn't
// caught up with yet ("pending"). When Sleeper's number moves, the run of oldest pending plays whose total best
// explains the move is treated as counted. A move the pending plays don't explain means Sleeper was first: it
// is held as "credit" so the matching ESPN play, when it arrives, isn't counted twice.
import {round2} from './util.js';

export function createLiveSync({clock = () => Date.now(), slack = 0.25, skew = 20_000, pendingTtl = 5 * 60_000, creditTtl = 3 * 60_000} = {}) {
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
  // ESPN's play text and Sleeper's stats can disagree by a yard or two; bigger plays get a little more room.
  const room = pts => Math.max(slack, 0.15 * Math.abs(pts));
  // Sleeper's weekly stat lines update within seconds; league lineup points trail them by a minute or more.
  // Use the stat line once a player has one.
  const leading = s => s.sources.stats ?? s.sources.matchup ?? Object.values(s.sources)[0] ?? null;

  // A Sleeper number for a player: source is 'stats' (weekly stat lines) or 'matchup' (league lineups).
  function official(week, id, source, value) {
    if (value == null || !Number.isFinite(value)) return;
    const s = get(`${week}:${id}`), prev = s.sources[source];
    if (prev != null && Math.abs(prev - value) < 0.005) return;
    s.sources[source] = value;
    const before = s.official;
    s.official = leading(s);
    // A player's first Sleeper number only needs reconciling if ESPN plays were already shown for them.
    if (before == null && !s.pending.length) return;
    const delta = s.official - (before ?? 0); // a stat line replacing lineup points reconciles the same way
    if (Math.abs(delta) < 0.005) return;
    expire(s);
    // Sleeper's update covers the oldest pending plays: take the run whose total comes closest (ties take more).
    let take = 0, gap = Math.abs(delta), sum = 0;
    s.pending.forEach((p, i) => {
      sum += p.pts;
      if (Math.abs(delta - sum) <= gap + 0.005) { take = i + 1; gap = Math.abs(delta - sum); }
    });
    const rest = delta - s.pending.slice(0, take).reduce((t, p) => t + p.pts, 0);
    s.pending = s.pending.slice(take);
    // What the plays don't explain is Sleeper being first. After a match, small leftovers are just yardage noise.
    if (take ? Math.sign(rest) === Math.sign(delta) && Math.abs(rest) > room(rest) : Math.abs(rest) >= 0.005) {
      // A Sleeper number that bounces back (0.3 → 0.4 → 0.3) cancels its own credit.
      const undo = s.credit.findIndex(c => Math.abs(c.pts + rest) < 0.05);
      if (undo >= 0) s.credit.splice(undo, 1);
      else s.credit.push({pts: rest, at: clock()});
    }
  }

  // ESPN plays for one game ({id, wallclock, involvements: [{playerId, pts}]}). The first look at a game is a
  // baseline: those plays are assumed to be in Sleeper's numbers already.
  function plays(week, gameId, items) {
    const gameKey = `${week}:${gameId}`, first = !baselined.has(gameKey);
    baselined.add(gameKey);
    for (const item of items) {
      const happened = Date.parse(item.wallclock || '');
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
        // Credit only covers plays that happened before Sleeper's move was seen, so a stale credit can't
        // swallow the plays that follow it.
        const credit = s.credit.find(c => Math.sign(c.pts) === Math.sign(delta) && Math.abs(delta) <= Math.abs(c.pts) + room(delta) && !(happened > c.at + skew));
        if (credit) {
          credit.pts -= delta;
          if (Math.abs(credit.pts) < 0.05 || Math.sign(credit.pts) !== Math.sign(delta)) s.credit.splice(s.credit.indexOf(credit), 1);
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
