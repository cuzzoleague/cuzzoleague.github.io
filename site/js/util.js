// Small shared helpers: formatting, statistics, and a seeded RNG.

export const esc = value => String(value ?? '').replace(/[&<>'"]/g, ch => ({'&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;'}[ch]));

export const sum = values => values.reduce((total, value) => total + value, 0);
export const mean = values => values.length ? sum(values) / values.length : 0;
export function std(values) {
  if (values.length < 2) return 0;
  const avg = mean(values);
  return Math.sqrt(sum(values.map(value => (value - avg) ** 2)) / values.length);
}
export function median(values) {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b), mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}
export const clamp = (value, lo, hi) => Math.min(hi, Math.max(lo, value));
export const round2 = value => Math.round((value + Number.EPSILON) * 100) / 100;

// Standard normal CDF (Abramowitz & Stegun 7.1.26, max error ~1.5e-7).
export function normCdf(z) {
  const sign = z < 0 ? -1 : 1, x = Math.abs(z) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * x);
  const y = 1 - ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t * Math.exp(-x * x);
  return 0.5 * (1 + sign * y);
}

// Converts {key: value} into {key: 0..100} percentile ranks; ties share the average rank.
export function percentileRanks(values) {
  const entries = Object.entries(values).sort((a, b) => a[1] - b[1]);
  const out = {}, span = Math.max(1, entries.length - 1);
  for (let i = 0; i < entries.length;) {
    let j = i;
    while (j + 1 < entries.length && entries[j + 1][1] === entries[i][1]) j++;
    const pct = 100 * ((i + j) / 2) / span;
    for (let k = i; k <= j; k++) out[entries[k][0]] = entries.length === 1 ? 100 : pct;
    i = j + 1;
  }
  return out;
}

// Exponentially weighted average where the newest value has weight 1 and each older one `decay` times less.
export function recencyWeighted(values, decay = 0.7) {
  if (!values.length) return 0;
  let weighted = 0, weights = 0;
  values.forEach((value, i) => { const w = decay ** (values.length - 1 - i); weighted += value * w; weights += w; });
  return weighted / weights;
}

export function seededRandom(seedText) {
  let seed = 2166136261;
  for (const ch of String(seedText)) { seed ^= ch.charCodeAt(0); seed = Math.imul(seed, 16777619); }
  return () => {
    seed = (seed + 0x6D2B79F5) | 0;
    let t = seed;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
export function gaussian(rng) {
  let u = 0;
  while (u === 0) u = rng();
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng());
}

export const fmt = (value, digits = 1) => Number(value).toFixed(digits);
export const signed = (value, digits = 1) => `${value > 0 ? '+' : value < 0 ? '−' : ''}${Math.abs(Number(value)).toFixed(digits)}`;
export const plural = (count, word, many = `${word}s`) => `${count} ${count === 1 ? word : many}`;
export const recordText = (w, l, t = 0) => `${w}-${l}${t ? `-${t}` : ''}`;
export const pct = (value, digits = 0) => `${(value * 100).toFixed(digits)}%`;
export const ordinal = n => { const s = ['th', 'st', 'nd', 'rd'], v = n % 100; return n + (s[(v - 20) % 10] || s[v] || s[0]); };
