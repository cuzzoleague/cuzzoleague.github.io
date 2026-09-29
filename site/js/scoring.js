// League scoring and lineup helpers shared by projections, win odds, and the move grader.
import {round2} from './util.js';

// Sleeper stat keys map 1:1 onto league scoring keys, so a dot product reproduces official points.
export function pointsFromStats(stats, scoring) {
  if (!stats) return 0;
  let total = 0;
  for (const [key, weight] of Object.entries(scoring || {})) {
    if (!weight) continue;
    let value = stats[key];
    // Projections omit this derived kicker stat; approximate it from total made-FG yardage.
    if (value == null && key === 'fgm_yds_over_30' && stats.fgm_yds != null) value = Math.max(0, stats.fgm_yds - 30 * (stats.fgm || 0));
    total += weight * Number(value || 0);
  }
  return round2(total);
}

export const BENCH_SLOTS = new Set(['BN', 'IR', 'TAXI']);
const SLOT_POSITIONS = {
  FLEX: ['RB', 'WR', 'TE'], WRRB_FLEX: ['WR', 'RB'], REC_FLEX: ['WR', 'TE'], SUPER_FLEX: ['QB', 'RB', 'WR', 'TE'],
  IDP_FLEX: ['DL', 'LB', 'DB', 'DE', 'DT', 'CB', 'S'], DL: ['DL', 'DE', 'DT'], DB: ['DB', 'CB', 'S']
};
export const slotPositions = slot => SLOT_POSITIONS[slot] || [slot];
export const eligible = (slot, positions) => slotPositions(slot).some(pos => positions.includes(pos));
export const activeSlots = rosterPositions => (rosterPositions || []).filter(slot => !BENCH_SLOTS.has(slot));
export const slotLabel = slot => ({FLEX: 'FLX', SUPER_FLEX: 'SF', WRRB_FLEX: 'W/R', REC_FLEX: 'W/T', DEF: 'DEF'}[slot] || slot);

export function positionsOf(id, players) {
  const p = players?.[id];
  if (p) return p.fpos?.length ? p.fpos : [p.pos];
  return /^[A-Z]{2,3}$/.test(String(id)) ? ['DEF'] : [];
}

// Best possible lineup from `candidates` ([{id, pts, positions}]). Restrictive slots are filled first,
// which is optimal for the usual QB/RB/WR/TE/K/DEF + FLEX layouts.
export function optimalLineup(candidates, rosterPositions) {
  const slots = activeSlots(rosterPositions).map((slot, index) => ({slot, index})).sort((a, b) => slotPositions(a.slot).length - slotPositions(b.slot).length || a.index - b.index);
  const pool = [...candidates].sort((a, b) => b.pts - a.pts), used = new Set(), picks = [];
  for (const {slot, index} of slots) {
    const pick = pool.find(c => !used.has(c.id) && eligible(slot, c.positions));
    if (pick) { used.add(pick.id); picks.push({slot, index, id: pick.id, pts: pick.pts}); }
  }
  return {total: round2(picks.reduce((total, p) => total + p.pts, 0)), picks: picks.sort((a, b) => a.index - b.index)};
}
