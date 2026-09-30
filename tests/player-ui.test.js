import test from 'node:test';
import assert from 'node:assert/strict';
import {statLine, ownerIndex, ownerText, shortName} from '../site/js/player-ui.js';
import {trackPlayers, attributePlay} from '../site/js/plays.js';

test('stat lines read like Sleeper box scores', () => {
  assert.equal(statLine({pass_att: 25, pass_cmp: 18, pass_yd: 256, pass_td: 1, pass_int: 1, rush_att: 2, rush_yd: -2, pass_2pt: 1}, 'QB'), '18/25 CMP, 256 YD, 1 TD, 1 INT, 2 CAR, -2 YD, 1 2-PT CONV');
  assert.equal(statLine({rush_att: 29, rush_yd: 194, rush_td: 2, rec: 2, rec_tgt: 2, rec_yd: 19}, 'RB'), '29 CAR, 194 YD, 2 TD, 2/2 REC, 19 YD');
  assert.equal(statLine({rec: 9, rec_tgt: 10, rec_yd: 194}, 'WR'), '9/10 REC, 194 YD');
  assert.equal(statLine({fga: 2, fgm: 2, xpa: 3, xpm: 3}, 'K'), '2/2 FG, 3/3 XP');
  assert.equal(statLine({pts_allow: 14, sack: 1, int: 1}, 'DEF'), '14 PTS ALLOWED, 1 SACK, 1 INT');
});

test('ownership comes from the week\'s rosters, with bench players marked', () => {
  const ctx = {
    weeks: new Map([[3, [{roster_id: 1, players: ['a', 'b'], starters: ['a']}]]]),
    rosters: [], teams: new Map([[1, {name: 'Barkin', manager: 'BrownPwrRanger'}]])
  };
  const owners = ownerIndex(ctx, 3);
  assert.equal(ownerText(owners.get('a')), 'Barkin');
  assert.equal(ownerText(owners.get('b')), 'Barkin · bench');
  assert.equal(ownerText(owners.get('zzz')), 'Free agent');
  assert.equal(shortName('GB', {}), 'GB D/ST');
});

test('teammates sharing a last name need the extra first-name letters ESPN prints', () => {
  const players = {
    bijan: {first: 'Bijan', last: 'Robinson', pos: 'RB', team: 'ATL'},
    brian: {first: 'Brian', last: 'Robinson Jr.', pos: 'RB', team: 'ATL'}
  };
  const tracked = trackPlayers(['bijan', 'brian'], players);
  const scoring = {rush_yd: 0.1};
  const r = attributePlay({text: 'Br.Robinson left guard to ATL 30 for 7 yards.', type: 'Rush', possession: 'ATL', tracked, scoring});
  assert.deepEqual(r.map(x => x.playerId), ['brian']);
  const r2 = attributePlay({text: 'Bi.Robinson up the middle for 4 yards.', type: 'Rush', possession: 'ATL', tracked, scoring});
  assert.deepEqual(r2.map(x => x.playerId), ['bijan']);
});
