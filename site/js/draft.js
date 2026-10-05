// Draft postmortem: every pick on the board, graded by what the player has done in this league since.
// A pick's grade is its points per start, ranked against every other drafted player at the same position.

const key = value => String(value ?? '');
const timeOf = tx => Number(tx.status_updated || tx.created || 0);

// Percentile (0..1) of value among values, with ties sharing the middle rank.
export function percentileAmong(value, values) {
  if (values.length < 2) return null;
  const lower = values.filter(v => v < value).length, equal = values.filter(v => v === value).length;
  return (lower + (equal - 1) / 2) / (values.length - 1);
}

// Five color steps, matching the scoring heatmap (1 = cold, 5 = hot).
export const qualityTier = quality => quality == null ? null : Math.max(1, Math.min(5, Math.floor(quality * 5) + 1));

export function draftBoard({draft, picks, rosters, weeks, completedWeeks, transactions = []}) {
  const rosterIds = new Set(rosters.map(r => key(r.roster_id)));
  // Draft slot for each roster: the draft record's own map first, then the pre-draft order, then the picks.
  const slots = new Map();
  for (const [slot, rosterId] of Object.entries(draft.slot_to_roster_id || {})) if (rosterIds.has(key(rosterId))) slots.set(key(rosterId), Number(slot));
  for (const roster of rosters) {
    const slot = Number(draft.draft_order?.[roster.owner_id]);
    if (!slots.has(key(roster.roster_id)) && Number.isInteger(slot) && slot > 0) slots.set(key(roster.roster_id), slot);
  }
  const made = picks.filter(p => p?.player_id != null && rosterIds.has(key(p.roster_id)));
  // A traded pick is made by its new owner but keeps the original slot, so the picks are only a fallback.
  for (const p of made) {
    const slot = Number(p.draft_slot);
    if (!slots.has(key(p.roster_id)) && Number.isInteger(slot) && slot > 0) slots.set(key(p.roster_id), slot);
  }
  const columns = [...rosterIds].sort((a, b) => (slots.get(a) ?? Infinity) - (slots.get(b) ?? Infinity) || Number(a) - Number(b))
    .map(id => ({rosterId: Number(id), slot: slots.get(id) ?? null}));

  // How each pick left its drafting team, from moves completed after the draft (the latest one wins).
  const current = new Map(rosters.map(r => [key(r.roster_id), new Set((r.players || []).map(key))]));
  const drafter = new Map(made.map(p => [key(p.player_id), key(p.roster_id)]));
  const draftedAt = Number(draft.last_picked || draft.start_time || draft.created || 0);
  const departed = new Map();
  for (const tx of transactions.filter(t => t?.status === 'complete' && timeOf(t) >= draftedAt).sort((a, b) => timeOf(a) - timeOf(b))) {
    for (const [playerId, rosterId] of Object.entries(tx.drops || {})) {
      if (key(rosterId) === drafter.get(key(playerId))) departed.set(key(playerId), tx.type === 'trade' ? 'Traded' : 'Dropped');
    }
  }

  // Production in completed league weeks on whichever Cuzzo roster had the player, starts and all.
  const production = new Map();
  for (const week of completedWeeks) {
    for (const entry of weeks.get(week) || []) {
      const starters = new Set((entry.starters || []).map(key));
      for (const [playerId, raw] of Object.entries(entry.players_points || {})) {
        const pts = Number(raw);
        if (!Number.isFinite(pts)) continue;
        const row = production.get(playerId) || {starts: 0, points: 0, startedPoints: 0};
        row.points += pts;
        if (starters.has(playerId)) { row.starts++; row.startedPoints += pts; }
        production.set(playerId, row);
      }
    }
  }

  const all = made.filter(p => Number.isInteger(Number(p.round)) && Number(p.round) > 0).map(p => {
    const m = p.metadata || {}, playerId = key(p.player_id), rosterId = Number(p.roster_id);
    const stats = production.get(playerId) || {starts: 0, points: 0, startedPoints: 0};
    const retained = current.get(key(rosterId))?.has(playerId) || false;
    return {playerId, rosterId, round: Number(p.round), pickNo: Number(p.pick_no), position: String(m.position || '').toUpperCase(),
      name: [m.first_name, m.last_name].filter(Boolean).join(' ').trim() || playerId, nflTeam: m.team || '',
      retained, departure: retained ? null : departed.get(playerId) || 'Dropped',
      starts: stats.starts, points: stats.points, perStart: stats.starts ? stats.startedPoints / stats.starts : null};
  });
  const rates = new Map();
  for (const p of all) if (p.position && p.perStart != null) rates.set(p.position, [...(rates.get(p.position) || []), p.perStart]);
  for (const p of all) {
    p.quality = p.perStart == null ? null : percentileAmong(p.perStart, rates.get(p.position) || []);
    p.tier = qualityTier(p.quality);
  }

  const total = Number(draft.settings?.rounds);
  const roundNumbers = Number.isInteger(total) && total > 0 && total <= 50 ? Array.from({length: total}, (_, i) => i + 1) : [...new Set(all.map(p => p.round))].sort((a, b) => a - b);
  const rounds = roundNumbers.map(round => {
    const cells = {};
    for (const p of all.filter(x => x.round === round).sort((a, b) => a.pickNo - b.pickNo)) (cells[p.rosterId] ||= []).push(p);
    return {round, cells};
  });
  return {name: draft.metadata?.name || `${draft.season || ''} draft`, season: String(draft.season || ''), type: draft.type || '', columns, rounds, picks: all};
}
