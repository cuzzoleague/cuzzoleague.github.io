import test from 'node:test';
import assert from 'node:assert/strict';
import {lineupOutlook, winProbability, isTossUp} from '../site/js/winprob.js';
import {pointsFromStats, optimalLineup} from '../site/js/scoring.js';
import {gameFraction} from '../site/js/espn.js';

test('win odds are even for identical projections and certain once games end', () => {
  const projections = new Map([['a', 20], ['b', 20]]);
  const pre = id => lineupOutlook({starters: [id], projections, progress: () => 0});
  assert.ok(Math.abs(winProbability(pre('a'), pre('b')) - 0.5) < 1e-6);
  assert.ok(isTossUp(0.55) && !isTossUp(0.6));
  const done = (id, pts) => lineupOutlook({starters: [id], points: {[id]: pts}, projections, progress: () => 1});
  assert.equal(winProbability(done('a', 25), done('b', 10)), 1);
});

test('remaining projection shrinks as a game clock runs', () => {
  const projections = new Map([['a', 20]]);
  const half = lineupOutlook({starters: ['a'], points: {a: 4}, projections, progress: () => 0.5});
  assert.equal(half.expected, 14); // 4 so far + half of 20 still to come
  assert.equal(half.playing, 1);
  assert.equal(gameFraction({state: 'in', period: 3, clockSeconds: 450}), 0.625);
  assert.equal(gameFraction({state: 'post'}), 1);
});

test('league scoring reproduces stat-line points, including derived kicker yardage', () => {
  const scoring = {rec: 0.5, rec_yd: 0.1, rec_td: 6, fgm_40_49: 3, fgm_yds_over_30: 0.1};
  assert.equal(pointsFromStats({rec: 5, rec_yd: 62, rec_td: 1}, scoring), 14.7);
  assert.equal(pointsFromStats({fgm: 1, fgm_40_49: 1, fgm_yds: 44}, scoring), 4.4);
});

test('optimal lineup fills fixed slots before FLEX', () => {
  const c = (id, pts, pos) => ({id, pts, positions: [pos]});
  const best = optimalLineup([c('rb1', 20, 'RB'), c('rb2', 15, 'RB'), c('rb3', 12, 'RB'), c('wr1', 10, 'WR'), c('wr2', 3, 'WR')], ['RB', 'WR', 'FLEX', 'BN', 'BN']);
  assert.equal(best.total, 45);
  assert.deepEqual(best.picks.map(p => p.id), ['rb1', 'wr1', 'rb2']);
});
