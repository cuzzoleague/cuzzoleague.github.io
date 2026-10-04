import test from 'node:test';
import assert from 'node:assert/strict';
import {chipNumbers, gameTones} from '../site/js/matchups-view.js';

const side = (pre, live) => ({pre: {expected: pre}, live: {expected: live}});
const model = over => ({status: 'upcoming', prob: 0.68, actualA: 0, actualB: 0, a: side(130.7, 130.7), b: side(113.8, 113.8), ...over});

test('before kickoff the score is gray and the pregame projection shows', () => {
  assert.deepEqual(chipNumbers(model()), {projA: 130.7, projB: 113.8, toneA: 'z', toneB: 'z'});
});

test('during games the live projection shows and colors follow the projected winner', () => {
  const live = chipNumbers(model({status: 'live', prob: 0.61, actualA: 52.3, actualB: 61.8, a: side(130.7, 127.9), b: side(113.8, 118.3)}));
  assert.deepEqual(live, {projA: 127.9, projB: 118.3, toneA: 'g', toneB: 'r'});
  const underdog = chipNumbers(model({status: 'partial', prob: 0.3, actualA: 40, actualB: 20}));
  assert.equal(underdog.toneA, 'r');
  assert.equal(underdog.toneB, 'g');
});

test('finished NFL games color the winner green and the loser red', () => {
  const game = (state, away, home) => ({state, away: {score: away}, home: {score: home}});
  assert.deepEqual(gameTones(game('post', 35, 14)), {away: 'g', home: 'r', final: true});
  assert.deepEqual(gameTones(game('post', 7, 27)), {away: 'r', home: 'g', final: true});
  assert.deepEqual(gameTones(game('in', 21, 3)), {away: 'z', home: 'z', final: false});
  assert.deepEqual(gameTones(game('post', 20, 20)), {away: 'z', home: 'z', final: true});
});

test('final scores color the actual winner green, keeping the pregame projection', () => {
  const upset = chipNumbers(model({status: 'final', prob: 1 - 0.19, actualA: 102.4, actualB: 108.9, a: side(124.5, 102.4), b: side(95.5, 108.9)}));
  assert.deepEqual(upset, {projA: 124.5, projB: 95.5, toneA: 'r', toneB: 'g'});
  const tie = chipNumbers(model({status: 'final', actualA: 100, actualB: 100}));
  assert.deepEqual([tie.toneA, tie.toneB], ['z', 'z']);
});
