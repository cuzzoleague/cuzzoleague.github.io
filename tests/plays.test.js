import test from 'node:test';
import assert from 'node:assert/strict';
import {namePattern, trackPlayers, attributePlay, effectiveText, spotFoulYards, fantasyFeed} from '../site/js/plays.js';

// The league's half-PPR settings (subset that plays touch).
const scoring = {pass_yd: 0.04, pass_td: 4, pass_int: -2, rush_yd: 0.1, rush_td: 6, rec: 0.5, rec_yd: 0.1, rec_td: 6, fum_lost: -2,
  pass_2pt: 2, rec_2pt: 2, rush_2pt: 2, xpm: 1, xpmiss: -1, fgmiss: -1, fgm_0_19: 3, fgm_20_29: 3, fgm_30_39: 3, fgm_40_49: 3, fgm_50p: 3, fgm_yds_over_30: 0.1,
  sack: 1, int: 2, fum_rec: 2, def_td: 6, st_td: 6, safe: 2, blk_kick: 2, def_st_fum_rec: 1, def_st_ff: 1};
const players = {
  qb: {first: 'Jordan', last: 'Love', pos: 'QB', team: 'GB'},
  wr: {first: 'Christian', last: 'Watson', pos: 'WR', team: 'GB'},
  bijan: {first: 'Bijan', last: 'Robinson', pos: 'RB', team: 'ATL'},
  brian: {first: 'Brian', last: 'Robinson Jr.', pos: 'RB', team: 'ATL'},
  k: {first: 'Nick', last: 'Folk', pos: 'K', team: 'ATL'},
  stbrown: {first: 'Amon-Ra', last: 'St. Brown', pos: 'WR', team: 'DET'},
  GB: {first: 'Green Bay', last: 'Packers', pos: 'DEF', team: 'GB'},
  ATL: {first: 'Atlanta', last: 'Falcons', pos: 'DEF', team: 'ATL'}
};
const track = ids => trackPlayers(ids, players);
const pts = (results, id) => Math.round(results.filter(r => r.playerId === id).reduce((t, r) => t + r.pts, 0) * 100) / 100;

test('name patterns tell teammates with the same initial apart', () => {
  const bijan = new RegExp(namePattern(players.bijan)), brian = new RegExp(namePattern(players.brian));
  assert.ok(bijan.test('Bi.Robinson left tackle'));
  assert.ok(!bijan.test('Br.Robinson left tackle'));
  assert.ok(brian.test('Br.Robinson left guard'));
  assert.ok(new RegExp(namePattern(players.stbrown)).test('pass short left to A.St. Brown for 9 yards'));
});

test('touchdown pass credits passer, receiver, and the kicker on the extra point', () => {
  const r = attributePlay({text: 'J.Love pass short middle to C.Watson for 15 yards, TOUCHDOWN. T.Smack extra point is GOOD, Center-M.Orzech.', type: 'Passing Touchdown',
    possession: 'GB', scoringTeam: 'GB', tracked: track(['qb', 'wr']), scoring});
  assert.equal(pts(r, 'qb'), 4.6);   // 15 * 0.04 + 4
  assert.equal(pts(r, 'wr'), 8.0);   // 0.5 + 1.5 + 6
});

test('rushes, formation prefixes, and eligibility reports are handled', () => {
  const r = attributePlay({text: 'J.Taylor reported in as eligible.  (Shotgun) Bi.Robinson left guard for 7 yards, TOUCHDOWN. N.Folk extra point is GOOD.', type: 'Rushing Touchdown',
    possession: 'ATL', scoringTeam: 'ATL', tracked: track(['bijan', 'brian', 'k']), scoring});
  assert.equal(pts(r, 'bijan'), 6.7);
  assert.equal(pts(r, 'brian'), 0);
  assert.equal(pts(r, 'k'), 1);
});

test('offensive holding downfield only credits yards up to the foul spot', () => {
  const text = 'Bi.Robinson up the middle to GB 5 for 87 yards (J.Battle).PENALTY on ATL-D.Metcalf, Offensive Holding, 7 yards, enforced at ATL 14.';
  assert.equal(spotFoulYards(text, 'ATL', 92, 87), 6); // line of scrimmage ATL 8 -> spot ATL 14
  const r = attributePlay({text, type: 'Rush', possession: 'ATL', lineOfScrimmage: 92, tracked: track(['bijan']), scoring});
  assert.equal(pts(r, 'bijan'), 0.6);
});

test('replay reversals use the final ruling and nullified touchdowns do not count', () => {
  assert.equal(effectiveText('X.Y pass for 2 yards, TOUCHDOWN.The play was REVERSED.(Shotgun) J.Love pass incomplete short middle to C.Watson.'), '(Shotgun) J.Love pass incomplete short middle to C.Watson.');
  const r = attributePlay({text: '(Shotgun) J.Love scrambles left end for 45 yards, TOUCHDOWN NULLIFIED by Penalty.PENALTY on GB-J.Doe, Offensive Holding, 10 yards, enforced at ATL 10.',
    type: 'Rush', possession: 'GB', lineOfScrimmage: 45, tracked: track(['qb']), scoring});
  assert.equal(pts(r, 'qb'), 3.5); // 35 yards to the spot, no touchdown
  assert.deepEqual(attributePlay({text: 'J.Love pass short to C.Watson for 20 yards. PENALTY on GB-X.Y, Holding, 10 yards, enforced at GB 30 - No Play.', type: 'Pass Reception', possession: 'GB', tracked: track(['qb', 'wr']), scoring}), []);
});

test('interceptions, sacks, and fumbles feed team defenses', () => {
  const pick = attributePlay({text: 'J.Love pass short middle intended for C.Watson INTERCEPTED by X.Watts at ATL 3. X.Watts to ATL 20 for 17 yards.', type: 'Pass Interception Return',
    possession: 'GB', tracked: track(['qb', 'wr', 'ATL', 'GB']), scoring});
  assert.equal(pts(pick, 'qb'), -2);
  assert.equal(pts(pick, 'ATL'), 2);
  assert.equal(pts(pick, 'GB'), 0);
  const strip = attributePlay({text: '(Shotgun) J.Love sacked at GB 3 for -9 yards (D.Deablo). FUMBLES (D.Deablo), RECOVERED by ATL-C.Henderson at GB 17.', type: 'Sack Opp Fumble Recovery',
    possession: 'GB', tracked: track(['qb', 'ATL']), scoring});
  assert.equal(pts(strip, 'qb'), -2);
  assert.equal(pts(strip, 'ATL'), 3); // sack + fumble recovery
});

test('field goals score by distance and two-point tries are credited', () => {
  const fg = attributePlay({text: 'N.Folk 44 yard field goal is GOOD, Center-L.McCullough.', type: 'Field Goal Good', possession: 'ATL', tracked: track(['k']), scoring});
  assert.equal(pts(fg, 'k'), 4.4);
  const miss = attributePlay({text: 'N.Folk 52 yard field goal is No Good, Wide Left.', type: 'Field Goal Missed', possession: 'ATL', tracked: track(['k']), scoring});
  assert.equal(pts(miss, 'k'), -1);
  const two = attributePlay({text: 'J.Love pass short left to C.Watson for 8 yards, TOUCHDOWN. TWO-POINT CONVERSION ATTEMPT. J.Love pass to C.Watson is complete. ATTEMPT SUCCEEDS.', type: 'Passing Touchdown',
    possession: 'GB', scoringTeam: 'GB', tracked: track(['qb', 'wr']), scoring});
  assert.equal(pts(two, 'qb'), 6.32); // 0.32 + 4 + 2
  assert.equal(pts(two, 'wr'), 9.3);  // 0.5 + 0.8 + 6 + 2
});

test('fantasyFeed walks drives, tracks possession, and skips games without tracked players', () => {
  const summary = {
    header: {id: '1', competitions: [{competitors: [{homeAway: 'home', team: {id: '9', abbreviation: 'GB'}}, {homeAway: 'away', team: {id: '1', abbreviation: 'ATL'}}], status: {type: {state: 'post'}}}]},
    drives: {previous: [{team: {id: '1'}, plays: [
      {id: 'a', sequenceNumber: '1', text: 'Bi.Robinson left tackle to ATL 34 for 4 yards (D.Wyatt).', type: {text: 'Rush'}, homeScore: 0, awayScore: 0, start: {team: {id: '1'}, yardsToEndzone: 70}, period: {number: 1}, clock: {displayValue: '14:55'}},
      {id: 'b', sequenceNumber: '2', text: 'N.Folk 31 yard field goal is GOOD.', type: {text: 'Field Goal Good'}, homeScore: 0, awayScore: 3, start: {team: {id: '1'}}, period: {number: 1}, clock: {displayValue: '9:00'}}
    ]}]}
  };
  const {items} = fantasyFeed(summary, track(['bijan', 'k']), scoring);
  assert.equal(items.length, 2);
  assert.equal(items[0].involvements[0].pts, 0.4);
  assert.equal(items[1].involvements[0].pts, 3.1);
  assert.equal(fantasyFeed(summary, track(['stbrown']), scoring).items.length, 0);
});

// Week 4, 2026 plays whose totals disagreed with Sleeper's box score.
test('a direct snap after a formation note is still a run', () => {
  const r = attributePlay({text: '(Shotgun) Direct snap to C.Watson.  C.Watson up the middle to TB 6 for 3 yards (J.Trotter).', type: 'Rush',
    possession: 'GB', tracked: track(['wr']), scoring});
  assert.equal(pts(r, 'wr'), 0.3);
});

test('a lateral receiver gets only the lateral yards, not the catch', () => {
  const r = attributePlay({text: '(Shotgun) J.Love pass short right to Bi.Robinson to DAL 25 for 2 yards. Lateral to C.Watson pushed ob at DAL 6 for 19 yards (D.Winters).',
    type: 'Pass Reception', possession: 'GB', tracked: trackPlayers(['qb', 'wr', 'bijan'], {...players, bijan: {...players.bijan, team: 'GB'}}), scoring});
  assert.equal(pts(r, 'qb'), 0.84);  // 21 passing yards
  assert.equal(pts(r, 'bijan'), 0.7); // the catch: 0.5 + 2 yards
  assert.equal(pts(r, 'wr'), 1.9);   // 19 lateral yards, no reception
});

test('a recovered fumbled snap that turns into a pass counts the pass, not the fumble yardage', () => {
  const r = attributePlay({text: 'J.Love to NE 43 for -1 yards. FUMBLES, and recovers at NE 43. J.Love pass short left to C.Watson pushed ob at BUF 36 for 20 yards (C.Gardner-Johnson).',
    type: 'Fumble Recovery (Own)', possession: 'GB', tracked: track(['qb', 'wr']), scoring});
  assert.equal(pts(r, 'qb'), 0.8);
  assert.equal(pts(r, 'wr'), 2.5);
  const aborted = attributePlay({text: '(Shotgun) J.Love Aborted. G.Barton FUMBLES at TB 6, recovered by GB-J.Love at TB 3. J.Love to TB 1 for -2 yards (B.Cox).',
    type: 'Fumble Recovery (Own)', possession: 'GB', tracked: track(['qb']), scoring});
  assert.equal(pts(aborted, 'qb'), 0);
});

test('a muffed punt recovered by the kicking team is a recovery but not a forced fumble', () => {
  const muff = attributePlay({text: 'J.Doe punts 45 yards to ATL 23, Center-C.Stoll. D.Davis MUFFS catch, touched at ATL 23, RECOVERED by GB-K.Smith at ATL 20.',
    type: 'Punt', possession: 'GB', tracked: track(['GB']), scoring});
  assert.equal(pts(muff, 'GB'), 1);
  const stripped = attributePlay({text: 'J.Doe punts 45 yards to ATL 23, Center-C.Stoll. D.Davis to ATL 30 for 7 yards (K.Smith). FUMBLES (K.Smith), RECOVERED by GB-K.Smith at ATL 30.',
    type: 'Punt', possession: 'GB', tracked: track(['GB']), scoring});
  assert.equal(pts(stripped, 'GB'), 2);
});
