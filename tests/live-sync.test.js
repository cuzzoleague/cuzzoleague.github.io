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
