import test from 'node:test';
import assert from 'node:assert/strict';
import {analyzeSeason, medianStandings} from '../site/js/analytics.js';
import {countMoves} from '../site/js/moves.js';

// Lineup: QB, K, DEF. Points come from the starting slots.
const entry = (roster_id, matchup_id, points, k = 0, def = 0) =>
  ({roster_id, matchup_id, points, starters: [`qb${roster_id}`, `k${roster_id}`, `def${roster_id}`], starters_points: [points - k - def, k, def]});
const weeks = new Map([
  [1, [entry(1, 1, 120, 9), entry(2, 1, 100, 4), entry(3, 2, 90, 12), entry(4, 2, 110)]],
  [2, [entry(1, 1, 130, 7), entry(3, 1, 95, 5), entry(2, 2, 90, 0), entry(4, 2, 140, 3)]],
  [3, [entry(1, 1, 80), entry(4, 1, 80), entry(2, 2, 100), entry(3, 2, 120)]]
]);
const season = analyzeSeason({rosterIds: [1, 2, 3, 4], weeks, completedWeeks: [1, 2, 3], rosterPositions: ['QB', 'K', 'DEF', 'BN'], playoffTeams: 2, sims: 200});
const t = id => season.teams.get(id);

test('started kicker points and starts are totaled from the K slot', () => {
  assert.deepEqual([t(1).kPoints, t(1).kStarts], [16, 3]);
  assert.deepEqual([t(3).kPoints, t(3).kStarts], [17, 3]);
});

test('teams tied for the lowest weekly score both count as the low', () => {
  // Week 3: teams 1 and 4 tie at 80, the lowest.
  assert.equal(t(1).lows, 1);
  assert.equal(t(4).lows, 1);
  assert.equal(t(2).lows, 1); // week 2's 90
});

test('median standings add a weekly game against the league median', () => {
  const rows = medianStandings(season.teams.values()), row = id => rows.find(r => r.id === id);
  // Medians: week 1 105, week 2 112.5, week 3 90.
  assert.deepEqual([row(1).medianWins, row(1).medianLosses], [2, 1]);
  assert.deepEqual([row(3).medianWins, row(3).medianLosses], [1, 2]);
  assert.equal(row(1).totalWins, row(1).wins + 2);
  assert.deepEqual(rows.map(r => r.rank), [1, 2, 3, 4]);
  for (const r of rows) assert.equal(r.change, r.actualRank - r.rank);
});

test('transactions count once per team: add/drops once, trades for both sides', () => {
  const counts = countMoves([
    {transaction_id: 'a', type: 'waiver', status: 'complete', roster_ids: [1]},
    {transaction_id: 'a', type: 'waiver', status: 'complete', roster_ids: [1]},          // same transaction listed twice
    {transaction_id: 'b', type: 'free_agent', status: 'complete', roster_ids: [1, 1]},
    {transaction_id: 'c', type: 'trade', status: 'complete', roster_ids: [1, 2]},
    {transaction_id: 'd', type: 'waiver', status: 'failed', roster_ids: [2]},
    {transaction_id: 'e', type: 'commissioner', status: 'complete', roster_ids: [3]}
  ]);
  assert.deepEqual(Object.fromEntries(counts), {1: 3, 2: 1});
});
