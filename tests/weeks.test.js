import test from 'node:test';
import assert from 'node:assert/strict';
import {fantasyWeekAt, nextRollover, zonedTimeToUtc} from '../site/js/weeks.js';

const START = '2026-09-09'; // Sleeper's season_start_date for 2026 (the Wednesday before kickoff)

test('the week flips at exactly Tuesday 8:00 AM Pacific', () => {
  assert.equal(fantasyWeekAt(START, Date.parse('2026-09-29T14:59:59Z')), 3); // 7:59:59 AM PDT
  assert.equal(fantasyWeekAt(START, Date.parse('2026-09-29T15:00:00Z')), 4); // 8:00 AM PDT
  assert.equal(fantasyWeekAt(START, Date.parse('2026-09-28T23:00:00Z')), 3); // Monday night game
});

test('before and at the start of the season it is Week 1', () => {
  assert.equal(fantasyWeekAt(START, Date.parse('2026-08-20T12:00:00Z')), 1);
  assert.equal(fantasyWeekAt(START, Date.parse('2026-09-11T00:15:00Z')), 1);
  assert.equal(fantasyWeekAt(START, Date.parse('2026-09-15T15:00:00Z')), 2);
});

test('daylight saving time ends without shifting the 8 AM rollover', () => {
  // DST ends Sunday Nov 1, 2026, so Tuesday Nov 3 at 8 AM PST is 16:00 UTC.
  assert.equal(zonedTimeToUtc(2026, 11, 3, 8), Date.parse('2026-11-03T16:00:00Z'));
  assert.equal(fantasyWeekAt(START, Date.parse('2026-11-03T15:30:00Z')), 8);
  assert.equal(fantasyWeekAt(START, Date.parse('2026-11-03T16:00:00Z')), 9);
});

test('nextRollover points at the coming Tuesday morning', () => {
  assert.equal(nextRollover(START, Date.parse('2026-09-30T03:14:00Z')), Date.parse('2026-10-06T15:00:00Z'));
});
