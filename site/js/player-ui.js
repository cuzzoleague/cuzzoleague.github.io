// Small shared pieces for showing NFL players: photos, names, league ownership, and stat lines.
import {esc} from './util.js';
import {isTeamId, playerPhotoUrl} from './sleeper.js';

export const POSITIONS = ['QB', 'RB', 'WR', 'TE', 'K', 'DEF'];
export const POSITION_NAMES = {QB: 'Quarterback', RB: 'Running back', WR: 'Wide receiver', TE: 'Tight end', K: 'Kicker', DEF: 'Defense'};

export function positionOf(id, players, fallback = '') {
  if (isTeamId(id)) return 'DEF';
  const pos = players?.[id]?.pos || fallback;
  return pos === 'FB' ? 'RB' : pos;
}

export function fullName(id, players) {
  const p = players?.[id];
  if (isTeamId(id)) return p?.name || `${id} D/ST`;
  return p?.name || 'Loading…';
}

export function shortName(id, players) {
  const p = players?.[id];
  if (isTeamId(id)) return `${p?.team || id} D/ST`;
  if (!p) return 'Loading…';
  return p.first ? `${p.first[0]}. ${p.last}` : p.name;
}

// Headshot (or team logo for a D/ST) layered over initials, which show if the image is missing.
export function photo(id, players, size = '') {
  const p = players?.[id];
  const label = isTeamId(id) ? id : String(p?.name || '?').split(/\s+/).map(w => w[0] || '').slice(0, 2).join('').toUpperCase();
  return `<span class="pphoto ${size} ${isTeamId(id) ? 'team' : ''}" aria-hidden="true"><i>${esc(label)}</i><img src="${playerPhotoUrl(id)}" alt="" loading="lazy" referrerpolicy="no-referrer" onerror="this.remove()"></span>`;
}

// Who rosters each player, from that week's Sleeper matchup entries (falls back to current rosters).
export function ownerIndex(ctx, week) {
  const index = new Map(), entries = ctx.weeks.get(week) || [];
  const source = entries.some(e => e.players?.length) ? entries : ctx.rosters;
  for (const r of source) {
    const team = ctx.teams.get(Number(r.roster_id)), starters = new Set((r.starters || []).map(String));
    for (const pid of r.players || []) index.set(String(pid), {rosterId: Number(r.roster_id), name: team?.name || 'Team', manager: team?.manager || '', starter: starters.has(String(pid))});
  }
  return index;
}

export function ownerText(owner) {
  if (!owner) return 'Free agent';
  return `${owner.name}${owner.starter ? '' : ' · bench'}`;
}

const n = (st, key) => Number(st?.[key] || 0);
export function statLine(st, pos) {
  if (!st) return '';
  const parts = [];
  const passing = () => { if (n(st, 'pass_att')) parts.push(`${n(st, 'pass_cmp')}/${n(st, 'pass_att')} CMP, ${n(st, 'pass_yd')} YD${n(st, 'pass_td') ? `, ${n(st, 'pass_td')} TD` : ''}${n(st, 'pass_int') ? `, ${n(st, 'pass_int')} INT` : ''}`); };
  const rushing = () => { if (n(st, 'rush_att')) parts.push(`${n(st, 'rush_att')} CAR, ${n(st, 'rush_yd')} YD${n(st, 'rush_td') ? `, ${n(st, 'rush_td')} TD` : ''}`); };
  const receiving = () => { if (n(st, 'rec_tgt') || n(st, 'rec')) parts.push(`${n(st, 'rec')}/${n(st, 'rec_tgt')} REC, ${n(st, 'rec_yd')} YD${n(st, 'rec_td') ? `, ${n(st, 'rec_td')} TD` : ''}`); };
  if (pos === 'DEF') {
    parts.push(`${n(st, 'pts_allow')} PTS ALLOWED`);
    if (n(st, 'sack')) parts.push(`${n(st, 'sack')} SACK`);
    if (n(st, 'int')) parts.push(`${n(st, 'int')} INT`);
    if (n(st, 'fum_rec')) parts.push(`${n(st, 'fum_rec')} FUM REC`);
    if (n(st, 'def_td')) parts.push(`${n(st, 'def_td')} TD`);
    return parts.join(', ');
  }
  if (pos === 'K') {
    if (n(st, 'fga')) parts.push(`${n(st, 'fgm')}/${n(st, 'fga')} FG`);
    if (n(st, 'xpa')) parts.push(`${n(st, 'xpm')}/${n(st, 'xpa')} XP`);
    return parts.join(', ');
  }
  if (pos === 'QB') { passing(); rushing(); receiving(); }
  else if (pos === 'RB') { rushing(); receiving(); passing(); }
  else { receiving(); rushing(); passing(); }
  const twoPt = n(st, 'pass_2pt') + n(st, 'rush_2pt') + n(st, 'rec_2pt');
  if (twoPt) parts.push(`${twoPt} 2-PT CONV`);
  if (n(st, 'fum_lost')) parts.push(`${n(st, 'fum_lost')} FUM LOST`);
  return parts.join(', ');
}

// Groups NFL games into viewing windows by local kickoff time: Thursday, Sunday morning, and so on.
export function kickoffSlot(date) {
  const d = new Date(date);
  if (Number.isNaN(d.getTime())) return 'TBD';
  const day = d.toLocaleDateString([], {weekday: 'long'});
  if (d.getDay() !== 0) return day;
  const hour = d.getHours();
  return hour < 12 ? 'Sunday morning' : hour < 16 ? 'Sunday afternoon' : 'Sunday night';
}
