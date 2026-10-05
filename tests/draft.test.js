import test from 'node:test';
import assert from 'node:assert/strict';
import {draftBoard, percentileAmong, qualityTier} from '../site/js/draft.js';
import {swapTone} from '../site/js/league-view.js';

const pick = (round, pickNo, rosterId, playerId, position, first, last, slot = rosterId) =>
  ({round, pick_no: pickNo, roster_id: rosterId, player_id: playerId, draft_slot: slot, metadata: {first_name: first, last_name: last, position}});

// Two teams, two rounds, snake order: team 2 picks first.
const draft = {season: '2026', type: 'snake', last_picked: 1000, slot_to_roster_id: {1: 2, 2: 1}, settings: {rounds: 2}, metadata: {name: 'Test draft'}};
const picks = [
  pick(1, 1, 2, 'rb1', 'RB', 'Jahmyr', 'Gibbs', 1), pick(1, 2, 1, 'rb2', 'RB', 'Bijan', 'Robinson', 2),
  pick(2, 3, 1, 'wr1', 'WR', 'Puka', 'Nacua', 2), pick(2, 4, 2, 'rb3', 'RB', 'Kyren', 'Williams', 1)
];
const rosters = [{roster_id: 1, owner_id: 'a', players: ['rb2', 'wr1']}, {roster_id: 2, owner_id: 'b', players: ['rb1']}];
const weeks = new Map([
  [1, [{roster_id: 1, starters: ['rb2', 'wr1'], players_points: {rb2: 20, wr1: 10}}, {roster_id: 2, starters: ['rb1', 'rb3'], players_points: {rb1: 30, rb3: 5}}]],
  [2, [{roster_id: 1, starters: ['rb2'], players_points: {rb2: 10, wr1: 12, rb3: 8}}, {roster_id: 2, starters: ['rb1'], players_points: {rb1: 25}}]],
  [3, [{roster_id: 1, starters: ['rb2'], players_points: {rb2: 99}}]] // not completed yet
]);
const transactions = [
  {type: 'trade', status: 'complete', status_updated: 2000, drops: {rb3: 2}, adds: {rb3: 1}},
  {type: 'free_agent', status: 'complete', status_updated: 500, drops: {wr1: 1}} // before the draft ended: ignored
];
const board = draftBoard({draft, picks, rosters, weeks, completedWeeks: [1, 2], transactions});
const byId = id => board.picks.find(p => p.playerId === id);

test('draft board columns follow draft slots and rows cover every round', () => {
  assert.deepEqual(board.columns.map(c => [c.rosterId, c.slot]), [[2, 1], [1, 2]]);
  assert.deepEqual(board.rounds.map(r => r.round), [1, 2]);
  assert.equal(board.rounds[0].cells[2][0].playerId, 'rb1');
  assert.equal(board.name, 'Test draft');
});

test('picks track production on any league roster, starts, and points per start', () => {
  assert.deepEqual([byId('rb2').starts, byId('rb2').points, byId('rb2').perStart], [2, 30, 15]);
  assert.deepEqual([byId('wr1').starts, byId('wr1').points], [1, 22]);       // benched week 2 still counts as points
  assert.deepEqual([byId('rb3').starts, byId('rb3').points, byId('rb3').perStart], [1, 13, 5]); // after the trade too
});

test('a pick no longer on its drafting team is labeled traded or dropped', () => {
  assert.equal(byId('rb1').retained, true);
  assert.equal(byId('rb3').retained, false);
  assert.equal(byId('rb3').departure, 'Traded');
  assert.equal(byId('wr1').departure, null);
});

test('grades rank points per start within each position', () => {
  // RBs per start: rb1 27.5, rb2 15, rb3 5 -> top, middle, bottom
  assert.equal(byId('rb1').quality, 1);
  assert.equal(byId('rb2').quality, 0.5);
  assert.equal(byId('rb3').quality, 0);
  assert.equal(byId('wr1').quality, null);  // only drafted WR: nothing to compare with
  assert.deepEqual([byId('rb1').tier, byId('rb2').tier, byId('rb3').tier, byId('wr1').tier], [5, 3, 1, null]);
  assert.equal(percentileAmong(3, [3, 3, 9]), 0.25);
  assert.equal(qualityTier(0.99), 5);
});

test('slots fall back to the pre-draft order when the draft record has no slot map', () => {
  const fallback = draftBoard({draft: {...draft, slot_to_roster_id: null, draft_order: {a: 1, b: 2}}, picks, rosters, weeks, completedWeeks: [1]});
  assert.deepEqual(fallback.columns.map(c => [c.rosterId, c.slot]), [[1, 1], [2, 2]]);
});

test('schedule swap colors compare with the real record, ties worth half a win', () => {
  const actual = {w: 2, l: 1, t: 1};
  assert.equal(swapTone({w: 3, l: 1, t: 0}, actual), 'better');
  assert.equal(swapTone({w: 2, l: 2, t: 0}, actual), 'worse');
  assert.equal(swapTone({w: 2, l: 1, t: 1}, actual), 'same');
  assert.equal(swapTone({w: 1, l: 0, t: 3}, actual), 'same');
});
