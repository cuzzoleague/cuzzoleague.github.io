import test from 'node:test';
import assert from 'node:assert/strict';
import {bracketPlaces, buildSeason, managerTable, champions} from '../site/js/history.js';
import {gradeMoves} from '../site/js/moves.js';

const users = [1, 2, 3, 4].map(n => ({user_id: `u${n}`, display_name: `Manager ${n}`}));
const rosters = [[1, 10, 2, 480], [2, 6, 6, 440], [3, 8, 4, 460], [4, 0, 12, 400]].map(([id, w, l, pf]) => ({roster_id: id, owner_id: `u${id}`, settings: {wins: w, losses: l, fpts: pf}}));
const winners = [{r: 1, m: 1, t1: 1, t2: 3, w: 1, l: 3, p: 1}];
const losers = [{r: 1, m: 2, t1: 2, t2: 4, w: 2, l: 4, p: 1}];

test('bracket placements include the consolation bracket', () => {
  assert.deepEqual([...bracketPlaces(winners, losers, 2)].sort(), [[1, 1], [2, 3], [3, 2], [4, 4]]);
});

test('completed seasons earn legacy points and titles', () => {
  const season = buildSeason({league: {league_id: 'L1', season: '2025', status: 'complete', settings: {playoff_teams: 2}}, users, rosters, winners, losers});
  assert.ok(season.ranked);
  const champ = season.teams.find(t => t.userId === 'u1');
  assert.equal(champ.finish, 1);
  assert.equal(champ.legacy, 100); // first place, best record, most points
  const table = managerTable({seasons: [season]});
  assert.equal(table.find(r => r.userId === 'u1').titles, 1);
  assert.equal(champions({seasons: [season]})[0].champ.manager, 'Manager 1');
});

test('seasons in progress count records but not finishes', () => {
  const season = buildSeason({league: {league_id: 'L2', season: '2026', status: 'in_season', settings: {playoff_teams: 2}}, users, rosters, winners: [], losers: []});
  assert.equal(season.ranked, false);
  const row = managerTable({seasons: [season]}).find(r => r.userId === 'u1');
  assert.equal(row.avgFinish, null);
  assert.equal(row.wins, 10);
});

test('move grades compare best lineups with and without the move', () => {
  const players = {a: {pos: 'RB', fpos: ['RB']}, b: {pos: 'RB', fpos: ['RB']}, c: {pos: 'RB', fpos: ['RB']}};
  const weeks = new Map([[2, [
    {roster_id: 1, matchup_id: 1, points: 30, players: ['a', 'c'], starters: ['a'], players_points: {a: 30, c: 5}},
    {roster_id: 2, matchup_id: 1, points: 25, players: ['x'], starters: ['x'], players_points: {x: 25}}
  ]]]);
  const transactions = [{transaction_id: 't1', type: 'free_agent', status: 'complete', leg: 2, status_updated: 1, roster_ids: [1], adds: {a: 1}, drops: {b: 1}}];
  const points = {a: 30, b: 12, c: 5};
  const graded = gradeMoves({transactions, weeks, completedWeeks: [2], rosterPositions: ['RB', 'BN'], players, pointsFor: (w, id) => points[id] || 0});
  const move = graded.get(1)[0];
  assert.equal(move.impact, 18);   // best with = 30 (a), best without = 12 (b)
  assert.equal(move.swing, 1);     // 30 beat 25; without the move 12 would have lost
  assert.equal(move.startedIn, 30);
});
