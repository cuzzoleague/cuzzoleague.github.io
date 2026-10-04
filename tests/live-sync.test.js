import test from 'node:test';
import assert from 'node:assert/strict';
import {createLiveSync} from '../site/js/live-sync.js';

const setup = () => {
  let now = 0;
  const sync = createLiveSync({clock: () => now});
  return {sync, tick: ms => { now += ms; }};
};
const play = (id, playerId, pts) => ({id, involvements: [{playerId, pts}]});

test('an ESPN play shows up before Sleeper catches up, and is not counted twice', () => {
  const {sync, tick} = setup();
  sync.official(5, 'p', 'matchup', 10);
  sync.plays(5, 'g', [play('a', 'p', 3)]);        // baseline: already counted
  assert.equal(sync.value(5, 'p'), 10);
  tick(1000);
  sync.plays(5, 'g', [play('a', 'p', 3), play('b', 'p', 6.5)]);
  assert.equal(sync.value(5, 'p'), 16.5);          // ESPN was first
  tick(20_000);
  sync.official(5, 'p', 'matchup', 16.6);          // Sleeper catches up (tiny estimate difference)
  assert.equal(sync.value(5, 'p'), 16.6);
});

test('when Sleeper is first, the later ESPN play is absorbed by credit', () => {
  const {sync, tick} = setup();
  sync.official(5, 'p', 'stats', 8);
  sync.plays(5, 'g', []);
  tick(1000);
  sync.official(5, 'p', 'stats', 14);              // Sleeper first
  assert.equal(sync.value(5, 'p'), 14);
  tick(5000);
  sync.plays(5, 'g', [play('c', 'p', 6)]);         // same play from ESPN
  assert.equal(sync.value(5, 'p'), 14);
});

test('Sleeper feeds: the most recently changed one wins', () => {
  const {sync, tick} = setup();
  sync.official(5, 'p', 'matchup', 4);
  sync.official(5, 'p', 'stats', 4);
  tick(1000);
  sync.official(5, 'p', 'stats', 9);               // stats updated, lineup feed still stale
  assert.equal(sync.value(5, 'p'), 9);
  tick(1000);
  sync.official(5, 'p', 'matchup', 9);
  assert.equal(sync.value(5, 'p'), 9);
});

test('a reversed play adjusts the pending amount, and stale pending expires', () => {
  const {sync, tick} = setup();
  sync.official(5, 'p', 'matchup', 0);
  sync.plays(5, 'g', []);
  tick(1000);
  sync.plays(5, 'g', [play('d', 'p', 6.2)]);
  assert.equal(sync.value(5, 'p'), 6.2);
  tick(1000);
  sync.plays(5, 'g', [play('d', 'p', 0.2)]);       // touchdown overturned
  assert.equal(sync.value(5, 'p'), 0.2);
  tick(6 * 60_000);                                // Sleeper never counted it: trust Sleeper again
  assert.equal(sync.value(5, 'p'), 0);
});

test('negative plays (interceptions, fumbles) flow the same way', () => {
  const {sync, tick} = setup();
  sync.official(5, 'qb', 'matchup', 12);
  sync.plays(5, 'g', []);
  tick(1000);
  sync.plays(5, 'g', [play('e', 'qb', -2)]);
  assert.equal(sync.value(5, 'qb'), 10);
  tick(15_000);
  sync.official(5, 'qb', 'matchup', 10);
  assert.equal(sync.value(5, 'qb'), 10);
});

test('Sleeper first on a small yardage play: the ESPN copy is not added on top', () => {
  // Seen live: a 3-yard run (0.3) and an 8-yard completion (0.32) showed up twice.
  const {sync, tick} = setup();
  sync.official(4, 'rb', 'matchup', 0);
  sync.official(4, 'qb', 'stats', -2);
  sync.plays(4, 'g', []);
  tick(30_000);
  sync.official(4, 'rb', 'stats', 0.3);
  sync.official(4, 'qb', 'stats', -1.68);
  tick(30_000);
  sync.plays(4, 'g', [play('run', 'rb', 0.3), play('catch', 'qb', 0.32)]);
  assert.equal(sync.value(4, 'rb'), 0.3);
  assert.equal(sync.value(4, 'qb'), -1.68);
});

test('several plays landing in the same poll are matched one by one', () => {
  const {sync, tick} = setup();
  sync.official(4, 'p', 'stats', 2);
  sync.plays(4, 'g', []);
  tick(30_000);
  sync.official(4, 'p', 'stats', 3.1);             // Sleeper's update covers three plays at once
  sync.plays(4, 'g', [play('a', 'p', 0.4), play('b', 'p', 0.2), play('c', 'p', 0.5)]);
  assert.equal(sync.value(4, 'p'), 3.1);
});

test('when ESPN over-credits a play, Sleeper catching up still clears it', () => {
  // A lateral that the play-by-play attributes twice (0.7 + 1.9) while Sleeper counts 1.9.
  const {sync, tick} = setup();
  sync.official(4, 'p', 'matchup', 4);
  sync.plays(4, 'g', []);
  tick(10_000);
  sync.plays(4, 'g', [{id: 'lat', involvements: [{playerId: 'p', pts: 0.7}]}, {id: 'lat2', involvements: [{playerId: 'p', pts: 1.9}]}]);
  assert.equal(sync.value(4, 'p'), 6.6);
  tick(30_000);
  sync.official(4, 'p', 'matchup', 5.9);
  assert.equal(sync.value(4, 'p'), 5.9);
});

test('Sleeper only covering the first of two pending plays keeps the second one', () => {
  const {sync, tick} = setup();
  sync.official(4, 'p', 'matchup', 1);
  sync.plays(4, 'g', []);
  tick(10_000);
  sync.plays(4, 'g', [play('a', 'p', 0.3), play('b', 'p', 0.6)]);
  tick(30_000);
  sync.official(4, 'p', 'matchup', 1.3);
  assert.equal(sync.value(4, 'p'), 1.9);
});

test('credit only covers plays that happened before Sleeper moved', () => {
  let now = Date.parse('2026-10-04T20:00:00Z');
  const sync = createLiveSync({clock: () => now});
  const at = (id, pts, wallclock) => ({id, wallclock, involvements: [{playerId: 'p', pts}]});
  sync.official(4, 'p', 'stats', 5);
  sync.plays(4, 'g', []);
  now += 30_000;
  sync.official(4, 'p', 'stats', 5.5);             // Sleeper first on a 5-yard run at 19:59:50
  now += 60_000;
  sync.plays(4, 'g', [at('later', 0.4, '2026-10-04T20:01:20Z')]); // a newer play can't be that run
  assert.equal(sync.value(4, 'p'), 5.9);
  sync.plays(4, 'g', [at('later', 0.4, '2026-10-04T20:01:20Z'), at('run', 0.5, '2026-10-04T19:59:50Z')]);
  assert.equal(sync.value(4, 'p'), 5.9);
});

test('a Sleeper number that bounces back does not swallow the next play', () => {
  const {sync, tick} = setup();
  sync.official(4, 'p', 'matchup', 0.3);
  sync.official(4, 'p', 'stats', 0.3);
  sync.plays(4, 'g', []);
  tick(10_000);
  sync.official(4, 'p', 'matchup', 0.4);
  tick(10_000);
  sync.official(4, 'p', 'matchup', 0.3);
  tick(10_000);
  sync.plays(4, 'g', [play('next', 'p', 0.3)]);
  assert.equal(sync.value(4, 'p'), 0.6);
});

test('a defense losing points-allowed credit still gets its sack from ESPN once', () => {
  const {sync, tick} = setup();
  sync.official(4, 'def', 'matchup', 10);
  sync.plays(4, 'g', []);
  tick(10_000);
  sync.official(4, 'def', 'matchup', 7);           // opponent scored: points-allowed tier drops (no ESPN play)
  tick(10_000);
  sync.official(4, 'def', 'matchup', 8);           // Sleeper first on a sack
  tick(10_000);
  sync.plays(4, 'g', [play('sack', 'def', 1)]);
  assert.equal(sync.value(4, 'def'), 8);
});

test("a player's first Sleeper number absorbs ESPN plays already shown", () => {
  const {sync, tick} = setup();
  sync.plays(4, 'g', []);
  tick(10_000);
  sync.plays(4, 'g', [play('a', 'wr', 1.3)]);      // not on a Cuzzo roster, no Sleeper stat line yet
  assert.equal(sync.value(4, 'wr'), 1.3);
  tick(30_000);
  sync.official(4, 'wr', 'stats', 1.3);
  assert.equal(sync.value(4, 'wr'), 1.3);
});
