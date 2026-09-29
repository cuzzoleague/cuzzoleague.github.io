// Win probability for a fantasy matchup. Each starter contributes their projection for the part of
// their NFL game still to be played; uncertainty shrinks as games finish.
import {normCdf} from './util.js';

export const TOSS_UP = 0.08; // matchups within 42–58% are flagged as coin flips

export const playerSd = projection => projection > 0 ? 0.5 * projection + 1.5 : 0;

// starters: [player ids]; points: {id: live pts}; projections: Map<id, pts>; progress(id) -> 0..1 of game played.
export function lineupOutlook({starters = [], points = {}, projections, progress = () => 0}) {
  let actual = 0, projected = 0, remaining = 0, variance = 0, yetToPlay = 0, playing = 0;
  for (const id of starters) {
    if (!id || id === '0') continue;
    const now = Number(points[id] || 0), proj = Number(projections?.get(id) ?? 0), done = Math.min(1, Math.max(0, progress(id)));
    actual += now; projected += proj;
    remaining += proj * (1 - done);
    variance += playerSd(proj) ** 2 * (1 - done);
    if (done === 0) yetToPlay++; else if (done < 1) playing++;
  }
  return {actual, projected, expected: actual + remaining, remaining, sd: Math.sqrt(variance), yetToPlay, playing};
}

// Fallback when no player projections exist: a team-level model from season scoring.
export const teamModelOutlook = (avg, sd) => ({actual: 0, projected: avg, expected: avg, remaining: avg, sd, yetToPlay: 0, playing: 0});

export function winProbability(a, b) {
  const diff = a.expected - b.expected, spread = Math.sqrt(a.sd ** 2 + b.sd ** 2);
  if (spread < 0.05) return diff > 0 ? 1 : diff < 0 ? 0 : 0.5;
  return normCdf(diff / spread);
}

export const isTossUp = probability => Math.abs(probability - 0.5) <= TOSS_UP;
