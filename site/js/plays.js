// Turns ESPN play-by-play into a fantasy feed: finds plays involving a matchup's starters and
// estimates the fantasy points each play produced under the league's scoring settings.
import {toSleeperTeam} from './espn.js';
import {round2} from './util.js';

const escapeRe = text => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const SUFFIX = /\s+(Jr\.?|Sr\.?|II|III|IV|V)$/i;

// ESPN abbreviates players as "B.Robinson", adding letters when teammates collide ("Bi.Robinson").
const firstLetters = player => { const first = String(player?.first || '').trim(); return first.replace(/[^A-Za-z]/g, '') || first; };
const lastName = player => String(player?.last || '').replace(SUFFIX, '').trim();

// minPrefix > 1 when a teammate shares the last name and first initial (ESPN then prints "Ja.Williams").
export function namePattern(player, minPrefix = 1) {
  const first = String(player?.first || '').trim(), last = lastName(player);
  if (!first || !last) return null;
  const letters = firstLetters(player);
  const prefixes = [...new Set([1, 2, 3].filter(k => k >= minPrefix).map(k => letters.slice(0, k)).filter(Boolean))].sort((a, b) => b.length - a.length).map(escapeRe);
  const lastPart = escapeRe(last).replace(/(\\\.)?\s+/g, (_, dot) => `${dot || ''}\\s?`);
  return `(?<![A-Za-z.'-])(?:${prefixes.join('|')})\\.\\s?${lastPart}(?![A-Za-z'])`;
}

export function trackPlayers(starterIds, players) {
  const tracked = [...new Set(starterIds)].filter(id => id && id !== '0').map(id => {
    const p = players?.[id] || {}, isDef = p.pos === 'DEF' || /^[A-Z]{2,3}$/.test(id);
    const source = isDef ? null : namePattern(p);
    return {id, team: isDef ? (p.team || id) : p.team, pos: isDef ? 'DEF' : p.pos, isDef, pattern: source};
  });
  // When whole rosters are tracked, teammates can share a last name. Require enough first-name letters
  // to tell them apart, the same way ESPN's play text does.
  const groups = new Map();
  for (const t of tracked) {
    if (t.isDef || !t.pattern) continue;
    const key = `${t.team}|${lastName(players[t.id]).toLowerCase()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  }
  for (const group of groups.values()) {
    if (group.length < 2) continue;
    for (const t of group) {
      const mine = firstLetters(players[t.id]);
      let k = 1;
      while (k < 3 && group.some(o => o !== t && firstLetters(players[o.id]).slice(0, k) === mine.slice(0, k))) k++;
      t.pattern = namePattern(players[t.id], k);
    }
  }
  return tracked;
}

// ---- text helpers -------------------------------------------------------------------------------

export function effectiveText(raw) {
  let text = String(raw || '');
  const reversed = text.lastIndexOf('REVERSED.');
  if (reversed >= 0) text = text.slice(reversed + 'REVERSED.'.length);
  return text.replace(/\s+/g, ' ').trim();
}

function mainPart(text) {
  let main = text;
  const twoPt = main.indexOf('TWO-POINT CONVERSION ATTEMPT');
  if (twoPt >= 0) main = main.slice(0, twoPt);
  const eligible = main.lastIndexOf('reported in as eligible.');
  if (eligible >= 0) main = main.slice(eligible + 'reported in as eligible.'.length);
  const formation = /^(\([^)]*\)\s*)+/;
  main = main.trim().replace(formation, '').replace(/^Direct snap to \S+\s*/, '').replace(formation, '').trim();
  // A fumbled snap the offense recovers can carry on as a pass ("... and recovers at NE 43. D.Maye pass short
  // left to ..."). The pass is what counts; the yardage around the fumble isn't a run.
  const resumed = /(?:and recovers|recovered by [A-Z]{2,3}-\S+) at (?:[A-Z]{2,3} )?\d+\.\s+(\S+\s+pass\b.*)$/.exec(main);
  return resumed ? resumed[1] : main;
}

function yardsAfter(text, from = 0) {
  const match = /\bfor (-?\d+) yards?\b|\bfor no gain\b/.exec(text.slice(from));
  return match ? Number(match[1] || 0) : 0;
}

// Penalty text uses NFL game-book team codes, which differ from Sleeper's for a few teams.
const BOOK_CODES = {ARZ: 'ARI', BLT: 'BAL', CLV: 'CLE', HST: 'HOU', LA: 'LAR', SL: 'LAR', JAC: 'JAX', SD: 'LAC', OAK: 'LV'};
const bookTeam = code => BOOK_CODES[code] || code;

// An offensive foul enforced at a spot downfield (e.g. holding during a long run) means the ball carrier
// is only credited with the yards gained up to that spot.
export function spotFoulYards(main, possession, lineOfScrimmage, yards) {
  if (!possession || !Number.isFinite(lineOfScrimmage)) return yards;
  const foul = /PENALTY on ([A-Z]{2,3})-[^,]*,[^,]*,\s*\d+ yards?, enforced at (?:([A-Z]{2,3}) )?(\d+)/.exec(main);
  if (!foul || bookTeam(foul[1]) !== possession) return yards;
  const spot = Number(foul[3]), toGoal = foul[2] && bookTeam(foul[2]) === possession ? 100 - spot : spot;
  const gained = lineOfScrimmage - toGoal;
  return gained >= 0 && gained < yards ? gained : yards;
}

const isNullified = text => /\bno play\b/i.test(text);
const fumbleLost = type => /Opp(onent)? Fumble|Fumble Recovery \(Opponent\)|Fumble Return Touchdown/i.test(type);
const val = (scoring, key) => Number(scoring?.[key] || 0);

function recTier(y) {
  if (y >= 40) return 'rec_40p';
  if (y >= 30) return 'rec_30_39';
  if (y >= 20) return 'rec_20_29';
  if (y >= 10) return 'rec_10_19';
  if (y >= 5) return 'rec_5_9';
  return 'rec_0_4';
}
function kickTier(prefix, distance, scoring) {
  if (distance < 20) return `${prefix}_0_19`;
  if (distance < 30) return `${prefix}_20_29`;
  if (distance < 40) return `${prefix}_30_39`;
  if (distance < 50) return `${prefix}_40_49`;
  if (distance >= 60 && scoring?.[`${prefix}_60p`]) return `${prefix}_60p`;
  if (scoring?.[`${prefix}_50_59`] && distance < 60) return `${prefix}_50_59`;
  return `${prefix}_50p`;
}
function tdLengthBonus(kind, y, scoring) {
  return (y >= 50 ? val(scoring, `${kind}_td_50p`) : 0) + (y >= 40 ? val(scoring, `${kind}_td_40p`) : 0);
}

// ---- per-play attribution -------------------------------------------------------------------------

export function attributePlay({text: rawText, type = '', possession, scoringTeam, lineOfScrimmage, tracked, scoring}) {
  const text = effectiveText(rawText);
  if (!text || isNullified(text)) return [];
  const main = mainPart(text), results = [];
  const touchdown = /TOUCHDOWN(?! NULLIFIED)/.test(main), intercepted = /INTERCEPTED by/.test(main), lost = fumbleLost(type);
  const sacked = / sacked\b/.test(main) || type === 'Sack';
  const passIdx = main.search(/\bpass\b/);
  const complete = passIdx >= 0 && !intercepted && !/\bpass incomplete\b/.test(main) && /\bpass\b[^,]*?\bto\b/.test(main) && !/\bspiked\b/.test(main);
  const lateral = /\bLateral to\b.*?\bfor (-?\d+) yards?/.exec(main);
  const lateralYards = lateral ? Number(lateral[1]) : 0;
  const adjust = yards => spotFoulYards(main, possession, lineOfScrimmage, yards);

  for (const player of tracked) {
    if (player.isDef || !player.pattern) continue;
    // Offense only: guards against same-abbreviation players on the other sideline. Kickers also kick
    // extra points after defensive scores, so they are exempt.
    if (possession && player.team && possession !== player.team && player.pos !== 'K') continue;
    const N = player.pattern, add = (role, label, pts) => results.push({playerId: player.id, role, label, pts: round2(pts)});

    // Kicks
    const fg = new RegExp(`^${N}\\s+(\\d+) yard field goal is (GOOD|No Good|BLOCKED|Blocked)`).exec(main);
    if (fg) {
      const distance = Number(fg[1]);
      if (fg[2] === 'GOOD') add('fg', `FG ${distance} yds`, val(scoring, kickTier('fgm', distance, scoring)) + val(scoring, 'fgm') + val(scoring, 'fgm_yds') * distance + val(scoring, 'fgm_yds_over_30') * Math.max(0, distance - 30));
      else add('fg', `Missed FG ${distance} yds`, val(scoring, kickTier('fgmiss', distance, scoring)) + val(scoring, 'fgmiss'));
      continue;
    }
    const xp = new RegExp(`${N}\\s+extra point is (GOOD|No Good|Blocked|BLOCKED|Aborted)`).exec(text);
    if (xp) add('xp', xp[1] === 'GOOD' ? 'Extra point' : 'Missed XP', xp[1] === 'GOOD' ? val(scoring, 'xpm') : val(scoring, 'xpmiss'));

    const isPasser = new RegExp(`^${N}\\s+pass\\b`).test(main);
    const isSacked = new RegExp(`^${N}\\s+sacked\\b`).test(main);
    // The receiver is named right after the pass direction, never later in the play (e.g. "Lateral to ...").
    const rec = new RegExp(`\\bpass(?:\\s+(?:incomplete|short|deep|left|right|middle))*\\s+(?:to|intended for)\\s+${N}`).exec(main);
    const lateralTo = complete && new RegExp(`\\bLateral to\\s+${N}`).test(main);

    if (isPasser) {
      const y = adjust(yardsAfter(main, passIdx)) + lateralYards;
      if (intercepted) add('pass', touchdown ? 'Pick-six thrown' : 'Interception', val(scoring, 'pass_att') + val(scoring, 'pass_int') + (touchdown ? val(scoring, 'pass_int_td') : 0));
      else if (complete) add('pass', `${touchdown && !lost ? 'TD pass' : 'Pass'} ${y} yds`, val(scoring, 'pass_att') + val(scoring, 'pass_cmp') + val(scoring, 'pass_yd') * y + (y >= 40 ? val(scoring, 'pass_cmp_40p') : 0) + (touchdown && !lost ? val(scoring, 'pass_td') + tdLengthBonus('pass', y, scoring) : 0));
      else add('pass', 'Incomplete', val(scoring, 'pass_att') + val(scoring, 'pass_inc'));
    }
    if (isSacked) add('pass', lost ? 'Sacked, fumble lost' : 'Sacked', val(scoring, 'pass_sack') + (lost ? val(scoring, 'fum_lost') + val(scoring, 'fum') : 0));
    if (rec) {
      if (complete) {
        const y = adjust(yardsAfter(main, rec.index)), pos = String(player.pos || '').toLowerCase(), scored = touchdown && !lost && !lateral;
        let pts = val(scoring, 'rec') + val(scoring, 'rec_yd') * y + val(scoring, recTier(y)) + val(scoring, `bonus_rec_${pos}`);
        if (scored) pts += val(scoring, 'rec_td') + tdLengthBonus('rec', y, scoring);
        if (lost && !lateral) pts += val(scoring, 'fum_lost') + val(scoring, 'fum');
        add('rec', `${scored ? 'TD catch' : 'Catch'} ${y} yds${lost && !lateral ? ', fumble lost' : ''}`, pts);
      } else add('rec', intercepted ? 'Target (picked)' : 'Target', 0);
    }
    if (lateralTo) {
      let pts = val(scoring, 'rec_yd') * lateralYards;
      if (touchdown && !lost) pts += val(scoring, 'rec_td') + tdLengthBonus('rec', lateralYards, scoring);
      add('rec', `${touchdown && !lost ? 'TD on lateral' : 'Lateral'} ${lateralYards} yds`, pts);
    }
    // Rushing: the play text starts with the ball carrier
    if (!isPasser && !isSacked && !rec && !lateralTo && new RegExp(`^${N}\\s+(?!pass\\b|sacked\\b|kicks\\b|punts\\b|spiked\\b|\\d+ yard field goal|extra point|FUMBLES \\(Aborted\\)|Aborted\\b)`).test(main)) {
      const y = adjust(yardsAfter(main)), kneel = /\bkneels\b/.test(main);
      let pts = val(scoring, 'rush_att') + val(scoring, 'rush_yd') * y + (y >= 40 ? val(scoring, 'rush_40p') : 0);
      if (touchdown && !lost) pts += val(scoring, 'rush_td') + tdLengthBonus('rush', y, scoring);
      if (lost) pts += val(scoring, 'fum_lost') + val(scoring, 'fum');
      add('rush', `${kneel ? 'Kneel' : touchdown && !lost ? 'TD run' : 'Rush'} ${y} yds${lost ? ', fumble lost' : ''}`, pts);
    }

    // Two-point conversions ride along on touchdown plays
    const twoIdx = text.indexOf('TWO-POINT CONVERSION ATTEMPT');
    if (twoIdx >= 0 && /ATTEMPT SUCCEEDS/.test(text.slice(twoIdx))) {
      const seg = text.slice(twoIdx);
      if (new RegExp(`\\.\\s*${N}\\s+pass to`).test(seg)) add('2pt', '2-pt pass', val(scoring, 'pass_2pt'));
      else if (new RegExp(`pass to\\s+${N}\\s+is complete`).test(seg)) add('2pt', '2-pt catch', val(scoring, 'rec_2pt'));
      else if (new RegExp(`\\.\\s*${N}\\s+rushes`).test(seg)) add('2pt', '2-pt run', val(scoring, 'rush_2pt'));
    }
  }

  // Team defenses / special teams
  const kickPlay = / kicks \d+ yards? from | punts /.test(main);
  const kickingTeam = kickPlay ? (bookTeam((/ kicks \d+ yards? from ([A-Z]{2,3}) /.exec(main) || [])[1] || '') || possession) : null;
  const recoveredBy = bookTeam((/RECOVERED by ([A-Z]{2,3})-/.exec(main) || [])[1] || '');
  for (const player of tracked) {
    if (!player.isDef) continue;
    const add = (label, pts) => results.push({playerId: player.id, role: 'def', label, pts: round2(pts)});
    const scored = scoringTeam === player.team, defTd = touchdown && scored;
    if (kickPlay) {
      if (kickingTeam === player.team && recoveredBy === player.team) add('Special-teams fumble recovery', val(scoring, 'def_st_fum_rec') + val(scoring, 'def_st_ff') + (defTd ? val(scoring, 'st_td') : 0));
      else if (scored && touchdown) add('Return TD', val(scoring, 'st_td'));
      continue;
    }
    if (possession && possession !== player.team) {
      if (intercepted) add(defTd ? 'Pick-six' : 'Interception', val(scoring, 'int') + (defTd ? val(scoring, 'def_td') : 0));
      else if (sacked) add(lost ? 'Strip sack' : 'Sack', val(scoring, 'sack') + (lost ? val(scoring, 'fum_rec') + val(scoring, 'ff') + (defTd ? val(scoring, 'def_td') : 0) : 0));
      else if (lost) add(defTd ? 'Fumble return TD' : 'Fumble recovery', val(scoring, 'fum_rec') + val(scoring, 'ff') + (defTd ? val(scoring, 'def_td') : 0));
      else if (/Blocked (Field Goal|Punt)/i.test(type) || /\bBLOCKED\b/.test(main)) add('Blocked kick', val(scoring, 'blk_kick') + (defTd ? val(scoring, 'st_td') : 0));
    }
    if (scored && /Safety/i.test(type)) add('Safety', val(scoring, 'safe'));
  }
  return results;
}

// ---- whole games --------------------------------------------------------------------------------

export function gameInfo(summary) {
  const comp = summary?.header?.competitions?.[0] || {};
  const teams = new Map(), side = {};
  for (const c of comp.competitors || []) {
    const abbr = toSleeperTeam(c.team?.abbreviation || '');
    teams.set(String(c.team?.id), abbr);
    side[c.homeAway] = abbr;
  }
  return {id: String(summary?.header?.id || comp.id || ''), teams, home: side.home, away: side.away, state: comp.status?.type?.state || 'pre', detail: comp.status?.type?.shortDetail || ''};
}

export function gamePlays(summary) {
  const drives = summary?.drives || {}, seen = new Set(), plays = [];
  for (const drive of [...(drives.previous || []), ...(drives.current ? [drives.current] : [])]) {
    for (const play of drive.plays || []) {
      if (!play?.id || seen.has(play.id)) continue;
      seen.add(play.id);
      plays.push({...play, driveTeam: drive.team?.id});
    }
  }
  return plays.sort((a, b) => Number(a.sequenceNumber || 0) - Number(b.sequenceNumber || 0));
}

export function fantasyFeed(summary, tracked, scoring) {
  const info = gameInfo(summary), feed = [];
  const inGame = tracked.filter(p => p.team === info.home || p.team === info.away);
  if (!inGame.length) return {info, items: feed};
  let prevHome = 0, prevAway = 0;
  for (const play of gamePlays(summary)) {
    const home = Number(play.homeScore ?? prevHome), away = Number(play.awayScore ?? prevAway);
    const scoringTeam = home > prevHome ? info.home : away > prevAway ? info.away : null;
    prevHome = home; prevAway = away;
    const possessionId = play.start?.team?.id ?? play.driveTeam;
    const possession = possessionId != null ? info.teams.get(String(possessionId)) : null;
    const lineOfScrimmage = Number(play.start?.yardsToEndzone);
    const involvements = attributePlay({text: play.text, type: play.type?.text || '', possession, scoringTeam, lineOfScrimmage, tracked: inGame, scoring});
    if (!involvements.length) continue;
    feed.push({
      id: `${info.id}:${play.id}`, gameId: info.id, seq: Number(play.sequenceNumber || 0), wallclock: play.wallclock || '',
      period: Number(play.period?.number || 0), clock: play.clock?.displayValue || '', text: effectiveText(play.text), type: play.type?.text || '',
      scoringPlay: Boolean(play.scoringPlay), home: info.home, away: info.away, homeScore: home, awayScore: away, involvements
    });
  }
  return {info, items: feed};
}

export const periodLabel = period => period > 4 ? 'OT' : period ? `Q${period}` : '';
