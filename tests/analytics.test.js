import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeSeason, pairsFor, scheduleSwaps} from '../site/js/analytics.js';
import {percentileRanks, normCdf, recencyWeighted} from '../site/js/util.js';

const e = (roster_id, matchup_id, points) => ({roster_id, matchup_id, points});
// Four teams, two played weeks, two to go.
const weeks = new Map([
  [1, [e(1, 1, 120), e(2, 1, 100), e(3, 2, 90), e(4, 2, 110)]],
  [2, [e(1, 1, 130), e(3, 1, 95), e(2, 2, 105), e(4, 2, 140)]],
  [3, [e(1, 1, 0), e(4, 1, 0), e(2, 2, 0), e(3, 2, 0)]],
  [4, [e(1, 1, 0), e(2, 1, 0), e(3, 2, 0), e(4, 2, 0)]]
]);
const season = analyzeSeason({rosterIds: [1, 2, 3, 4], weeks, completedWeeks: [1, 2], remainingWeeks: [3, 4], playoffTeams: 2, sims: 2000});
const t = id => season.teams.get(id);

test('records, all-play, and expected wins come from weekly scores', () => {
  assert.deepEqual([t(1).wins, t(1).losses], [2, 0]);
  assert.deepEqual([t(4).wins, t(4).losses], [2, 0]);
  // Week 1: team 1 beats all 3 (1.0), week 2: beats 2 of 3 (0.667)
  assert.equal(t(1).expectedWins.toFixed(3), '1.667');
  assert.deepEqual(t(1).allPlay, {w: 5, l: 1, t: 0});
  assert.equal(t(1).luck.toFixed(3), '0.333');
  assert.equal(t(1).highs, 1);
  assert.equal(t(4).highs, 1);
});

test('bad beats and lucky wins use the weekly median', () => {
  // Week 1 median is 105: team 4 scored 110 (above) and won; week 2 median 117.5: team 2 lost with 105 (below).
  assert.equal(t(4).badBeats, 0);
  assert.equal(t(1).luckyWins, 0);
  assert.equal(season.playedWeeks.length, 2);
});

test('power ranks every team and keeps weekly history', () => {
  const ranks = [...season.teams.values()].map(s => s.powerRank).sort();
  assert.deepEqual(ranks, [1, 2, 3, 4]);
  assert.equal(t(1).powerRank, 1);
  assert.equal(t(1).history.length, 2);
  assert.ok(t(1).power > t(3).power);
});

test('playoff odds add up to the number of playoff spots', () => {
  const total = [...season.teams.values()].reduce((sum, s) => sum + s.playoffOdds, 0);
  assert.ok(Math.abs(total - 2) < 1e-9);
  assert.ok(t(1).playoffOdds > t(3).playoffOdds);
});

test('schedule swaps keep real records on the diagonal', () => {
  const swap = scheduleSwaps([1, 2, 3, 4], weeks, [1, 2]);
  assert.deepEqual(swap[1][1], {w: 2, l: 0, t: 0});
  // Team 3 with team 1's schedule: faces 2 (90 v 100 L) then itself -> plays team 1 instead (95 v 130 L)
  assert.deepEqual(swap[3][1], {w: 0, l: 2, t: 0});
});

test('helpers behave', () => {
  assert.equal(pairsFor(weeks.get(1)).length, 2);
  assert.ok(Math.abs(normCdf(0) - 0.5) < 1e-7);
  assert.ok(Math.abs(normCdf(1.96) - 0.975) < 1e-3);
  assert.deepEqual(percentileRanks({a: 1, b: 1, c: 3}), {a: 25, b: 25, c: 100});
  assert.equal(recencyWeighted([0, 1], 0.5).toFixed(3), '0.667');
});
