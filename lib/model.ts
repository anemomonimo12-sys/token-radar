// Launch Radar's model: one sealed snapshot of the protocol universe in, one ranked board out.
//
// The question the board answers is narrow: if this protocol issued its token at the value its
// already-trading peers carry, what would that token be worth, and what should a farmer do about
// it before the launch? Nothing here predicts that a launch happens. Every number is derived from
// the snapshot's own figures; no protocol name is ever special-cased.
//
//   implied_usd = tvl_usd x multiple x momentum x maturity x reach, capped at the largest
//                 market cap the snapshot records for a live token.
//
//   multiple  The value the market already puts on one dollar of TVL in this protocol's
//             category: the median market-cap/TVL of the snapshot's live-token protocols in
//             that category, shrunk toward the snapshot-wide median by sample size
//             ((n x category median + 8 x global median) / (n + 8)). Both medians are taken
//             on log ratios: ratios are multiplicative, and on the raw scale one distorted
//             peer (an oracle whose recorded TVL is a sliver of its token's value) would
//             otherwise set a whole category's price. Clamped to [0.03, 1.5].
//   momentum  The week's TVL change, clamped to [-50, +100] per cent, at half weight:
//             1 + clamp(change_7d) / 100 x 0.5. Unreported change counts as no momentum.
//   maturity  A protocol's record, from the day DefiLlama began tracking it to the snapshot's
//             date: 0.55 on day one, rising linearly to 1.00 at two years. A launch priced off
//             two audited years of operation is a different claim from one priced off a week.
//             An unreported listing day counts as half a year.
//   reach     1 + 0.03 per chain past the first, up to seven: distribution a token launches
//             into, counted from the snapshot's own chain list.
//
// Readiness (0-100, the board's second signal) mixes the same figures on log scales: TVL
// against the watchlist floor, the week's growth, the record's length and the chain count.
// It ranks nothing by itself; it tells the reader which rows to farm first.
//
// The board ranks every protocol that records no token and could still issue one of its own:
// the whole watchlist, plus every other pre-token protocol that is not an exchange, not a
// versioned pool of another protocol, and not a product of a token that already trades. The
// snapshot carries no parent-protocol field, so products are kept off the way the watchlist's
// own rule keeps them off: by category (Bridge, Canonical Bridge, Liquid Staking, Liquid
// Restaking, Restaked BTC and CEX are products or exchanges, never launches of their own —
// WBTC and USDT0 are Bridge rows, Binance staked ETH a Liquid Staking one) and by name (a
// version marker, a whole word wrapped, staked or staking, or an exchange's name in front). Protocols whose token already trades are never ranked; the
// dashboard shows the largest of them apart, at the market's own values, as the comparison set
// the multiples came from.

/** The snapshot's protocol entry: exactly the ten fields the sealed input carries. */
export interface SnapshotProtocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

/** The whole snapshot document. */
export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: SnapshotProtocol[];
  watchlist: string[];
}

/** The model's version label: the dashboard names it wherever it states the model. */
export const MODEL_VERSION = 'launch-radar-2';

/** How many live-token protocols the dashboard's comparison strip carries, by market cap. */
export const LIVE_ROWS = 24;

/** The value model, exposed so the dashboard can state and recompute it. */
export interface ValueModel {
  global_multiple: number;
  shrink_k: number;
  multiple_floor: number;
  multiple_cap: number;
  momentum_weight: number;
  momentum_floor_pct: number;
  momentum_cap_pct: number;
  maturity_start: number;
  maturity_days: number;
  unknown_age_days: number;
  reach_per_chain: number;
  reach_max_extra_chains: number;
  categories: Record<string, { multiple: number; samples: number }>;
}

const MODEL_TUNING = {
  shrink_k: 8,
  multiple_floor: 0.03,
  multiple_cap: 1.5,
  momentum_weight: 0.5,
  momentum_floor_pct: -50,
  momentum_cap_pct: 100,
  maturity_start: 0.55,
  maturity_days: 730,
  unknown_age_days: 182,
  reach_per_chain: 0.03,
  reach_max_extra_chains: 7,
} as const;

/** One protocol's valuation, factor by factor, exactly as the dashboard shows it. */
export interface Valuation {
  multiple: number;
  momentum: number;
  maturity: number;
  reach: number;
  implied: number;
  readiness: number;
  age_days: number | null;
}

/** One row of board.json. */
export interface BoardRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
  token_status: 'pre-token';
  watchlist: boolean;
  age_days: number | null;
  readiness: number;
  implied_value_usd: number;
  model: {
    multiple: number;
    momentum_multiplier: number;
    maturity_multiplier: number;
    reach_multiplier: number;
  };
  farm_steps: string[];
}

/** The dashboard's view of one board row: the row, its factors and its plan, nothing recomputed. */
export interface RadarRow extends BoardRow {
  farm_plan: { action: string; cost: string; time: string }[];
}

/** A live-token protocol, shown apart at the market's own value. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
  multiple: number | null;
}

/** Everything the dashboard renders. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  model: ValueModel;
  scanned_size: number;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  total_implied_usd: number;
  value_cap_usd: number;
  rows: RadarRow[];
  live: LiveRow[];
}

/** Why the snapshot is not one this model can score. */
export class SnapshotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SnapshotError';
  }
}

const DAY_MS = 86_400_000;

function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, n));
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** Whole days from the day DefiLlama began tracking a protocol to the snapshot's date. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The median of a non-empty list. */
function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/**
 * The value model the snapshot itself implies: what one dollar of TVL is worth, per category,
 * among the protocols whose token already trades, shrunk toward the snapshot-wide median.
 */
export function buildModel(snapshot: Snapshot): ValueModel {
  const logRatiosByCategory = new Map<string, number[]>();
  const allLogRatios: number[] = [];
  for (const p of snapshot.protocols) {
    if (p.mcap_usd === null || p.tvl_usd <= 0) continue;
    const ratio = p.mcap_usd / p.tvl_usd;
    if (!Number.isFinite(ratio) || ratio <= 0) continue;
    const logRatio = Math.log(ratio);
    allLogRatios.push(logRatio);
    const key = p.category ?? '(uncategorised)';
    const list = logRatiosByCategory.get(key);
    if (list === undefined) logRatiosByCategory.set(key, [logRatio]);
    else list.push(logRatio);
  }
  const globalLog = allLogRatios.length > 0 ? median(allLogRatios) : Math.log(0.15);
  const globalMultiple = Math.exp(globalLog);
  const categories: ValueModel['categories'] = {};
  for (const [key, logRatios] of [...logRatiosByCategory.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
    const shrunkLog = (logRatios.length * median(logRatios) + MODEL_TUNING.shrink_k * globalLog) / (logRatios.length + MODEL_TUNING.shrink_k);
    categories[key] = {
      multiple: round4(clamp(Math.exp(shrunkLog), MODEL_TUNING.multiple_floor, MODEL_TUNING.multiple_cap)),
      samples: logRatios.length,
    };
  }
  return {
    global_multiple: round4(globalMultiple),
    shrink_k: MODEL_TUNING.shrink_k,
    multiple_floor: MODEL_TUNING.multiple_floor,
    multiple_cap: MODEL_TUNING.multiple_cap,
    momentum_weight: MODEL_TUNING.momentum_weight,
    momentum_floor_pct: MODEL_TUNING.momentum_floor_pct,
    momentum_cap_pct: MODEL_TUNING.momentum_cap_pct,
    maturity_start: MODEL_TUNING.maturity_start,
    maturity_days: MODEL_TUNING.maturity_days,
    unknown_age_days: MODEL_TUNING.unknown_age_days,
    reach_per_chain: MODEL_TUNING.reach_per_chain,
    reach_max_extra_chains: MODEL_TUNING.reach_max_extra_chains,
    categories,
  };
}

/** One protocol's valuation under the model: every factor, the implied value and the readiness. */
export function valuate(p: SnapshotProtocol, asOf: string, model: ValueModel, valueCap: number): Valuation {
  const age = ageDays(asOf, p.listed_at);
  const cat = model.categories[p.category ?? '(uncategorised)'];
  const multiple = cat === undefined ? model.global_multiple : cat.multiple;
  const growthPct = clamp(finite(p.change_7d, 0), model.momentum_floor_pct, model.momentum_cap_pct);
  const momentum = 1 + (growthPct / 100) * model.momentum_weight;
  const ageForModel = age ?? model.unknown_age_days;
  const maturity = model.maturity_start + (1 - model.maturity_start) * (clamp(ageForModel, 0, model.maturity_days) / model.maturity_days);
  const reach = 1 + model.reach_per_chain * Math.min(Math.max(p.chains.length - 1, 0), model.reach_max_extra_chains);
  const implied = clamp(Math.round(p.tvl_usd * multiple * momentum * maturity * reach), 1, valueCap);
  // Readiness: the same figures on log scales, 0-100. TVL from the snapshot's $5M floor of
  // protocols to $5B; growth across the clamped week; the record across two years.
  const scale = clamp((Math.log10(Math.max(p.tvl_usd, 1)) - Math.log10(5_000_000)) / (Math.log10(5_000_000_000) - Math.log10(5_000_000)), 0, 1);
  const growthScore = clamp((growthPct - model.momentum_floor_pct) / (model.momentum_cap_pct - model.momentum_floor_pct), 0, 1);
  const recordScore = clamp(ageForModel / model.maturity_days, 0, 1);
  const reachScore = Math.min(Math.max(p.chains.length - 1, 0), model.reach_max_extra_chains) / model.reach_max_extra_chains;
  const readiness = Math.round(100 * (0.45 * scale + 0.25 * growthScore + 0.2 * recordScore + 0.1 * reachScore));
  return { multiple, momentum, maturity, reach, implied, readiness, age_days: age };
}

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;
const PRODUCT_WORD = /\b(wrapped|staked|staking)\b/i;
const EXCHANGE_PREFIX = /^(binance|coinbase|bybit|kraken|bitget|okx|bitfinex|gemini)\b/i;
/** Categories that are products of a token that already trades, or exchanges: never a launch. */
const PRODUCT_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/**
 * Whether a pre-token protocol could still issue a token of its own: not an exchange, not a
 * versioned pool of another protocol, and not a wrapped, staked or bridged product of a token
 * that already trades, by category or by name.
 */
export function isRankable(p: SnapshotProtocol): boolean {
  return (
    isPreToken(p) &&
    !(p.category !== null && PRODUCT_CATEGORIES.has(p.category)) &&
    !VERSIONED.test(p.name) &&
    !PRODUCT_WORD.test(p.name) &&
    !EXCHANGE_PREFIX.test(p.name)
  );
}

/** The chain a farm plan starts on: the protocol's first listed chain, or a neutral phrase. */
function homeChain(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its home chain';
}

/** Gas class of a chain, for honest cost ranges: L1s cost dollars, L2s and alt-L1s cents. */
function gasProfile(chain: string): { open: string; weekly: string } {
  const c = chain.toLowerCase();
  if (c === 'ethereum') return { open: '$8-15 of ETH for gas', weekly: 'about $6 of ETH a week' };
  if (c === 'solana') return { open: 'under $0.10 of SOL for fees', weekly: 'under $0.25 of SOL a week' };
  if (c === 'tron' || c === 'binance' || c === 'bsc') return { open: 'about $1 of gas', weekly: 'about $1 of gas a week' };
  return { open: 'about $0.50 of gas on an L2', weekly: 'about $0.50 of gas a week' };
}

/** Capital for one farm position, from the protocol's own TVL: deeper protocols absorb more. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 2_000_000_000) return 500;
  if (p.tvl_usd >= 500_000_000) return 250;
  if (p.tvl_usd >= 100_000_000) return 150;
  if (p.tvl_usd >= 25_000_000) return 100;
  return 50;
}

/** How long a position must be held to count, from the protocol's age and readiness. */
function holdDaysFor(age: number | null, readiness: number): number {
  if (age === null) return 45;
  if (age < 120) return 60;
  if (age < 365) return 45;
  return readiness >= 60 ? 30 : 45;
}

/** The core farming action for a category, in the words a farmer can follow. */
function coreAction(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const n = p.name;
  if (c.includes('lend')) return `Supply $${capital} of USDC to ${n} on ${chain}, then borrow about 40% against it once and re-supply the borrow, so both sides of the market record your wallet.`;
  if (c.includes('cdp') || c.includes('collateral')) return `Open a $${capital} collateral position in ${n} on ${chain} and mint a small amount of its debt asset, keeping the health factor above 2.`;
  if (c.includes('dex') || c.includes('aggregator')) return `Add $${capital} of liquidity to ${n}'s highest-volume pool on ${chain} and route at least $200 of swaps a week through the position.`;
  if (c.includes('perpetual') || c.includes('derivative') || c.includes('options')) return `Deposit $${capital} of USDC margin on ${n} and hold one small hedged position (long one market, short the same size on a second venue) so volume accrues without directional risk.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${n}, then put the bridged funds to work in one app on the far side instead of bridging straight back.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the underlying asset through ${n} on ${chain} and hold the receipt token in the same wallet.`;
  if (c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into one of ${n}'s curated vaults on ${chain} and keep the vault shares untouched for the hold period.`;
  if (c.includes('rwa')) return `Mint $${capital} of ${n}'s yield-bearing asset on ${chain} and hold it; if minting needs allowlisting, complete that first and keep the confirmation.`;
  if (c.includes('stable')) return `Mint or deposit $${capital} of the stable asset through ${n} on ${chain} and hold the balance across weekly snapshots.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${n} on ${chain} and keep the policy active for the hold period.`;
  if (c.includes('yield') || c.includes('farm')) return `Deposit $${capital} into ${n}'s main vault on ${chain} and leave auto-compounding on for the hold period.`;
  if (c.includes('prediction')) return `Fund $${capital} on ${n} and take one position in its most liquid market each week.`;
  if (c.includes('launchpad')) return `Deposit $${capital} through ${n} on ${chain} and take part in one launch allocation round.`;
  return `Deposit $${capital} of USDC into ${n} on ${chain} through its main product and keep the position open for the hold period.`;
}

/** A step as {action, cost, time}: the page renders the three parts; board.json joins them. */
export interface FarmStepParts {
  action: string;
  cost: string;
  time: string;
}

/**
 * A protocol's farm plan: seven steps, each an action with what it costs and how long it
 * takes, derived from the protocol's own record (category, chains, TVL, age, readiness).
 */
export function farmPlan(p: SnapshotProtocol, age: number | null, readiness: number): FarmStepParts[] {
  const chain = homeChain(p);
  const gas = gasProfile(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age, readiness);
  const multi = p.chains.length > 1 ? ` Repeat the core position on ${p.chains[1]} with half the capital if you want a second chain's activity counted.` : '';
  return [
    {
      action: `Set up a fresh wallet for ${p.name} alone, fund it on ${chain}, and keep its seed phrase offline; never farm a points program from your main wallet.`,
      cost: 'no capital, one funding transfer',
      time: '10 minutes',
    },
    {
      action: coreAction(p, capital, chain),
      cost: `$${capital} of capital plus ${gas.open}`,
      time: '20 minutes to set up',
    },
    {
      action: `Repeat one qualifying action every week on ${p.name} (a deposit, a borrow, a swap or a renewal) so the wallet shows a pattern, not a single visit.${multi}`,
      cost: gas.weekly,
      time: '10 minutes a week',
    },
    {
      action: `Hold the position for at least ${hold} days, across at least four weekly snapshots, before you change its size.`,
      cost: `the $${capital} stays deployed`,
      time: `${hold} days`,
    },
    {
      action: `Check ${p.name}'s own points or rewards page every week and screenshot your balance; points that are never screenshotted are hard to dispute later.`,
      cost: 'nothing',
      time: '5 minutes a week',
    },
    {
      action: `When a launch or snapshot is announced, claim only from the link the protocol's own page publishes, and never pay a fee or connect a second wallet to claim.`,
      cost: 'no fee to claim; anything charging one is a scam',
      time: '15 minutes at the claim',
    },
    {
      action: `Log the wallet, every date and every transaction hash in a farm log, and unwind the position once the claim window closes or after ${hold * 2} days with no announcement.`,
      cost: `${gas.open} to exit`,
      time: '15 minutes to unwind',
    },
  ];
}

/** A plan step as one string for board.json: action, cost and time in one line of prose. */
export function stepText(step: FarmStepParts): string {
  let s = `${step.action} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Keep the position open and check the protocol's own page weekly.`;
  return s;
}

/** The ranked board: every watchlist slug, plus every other rankable pre-token protocol. */
export function buildBoard(snapshot: Snapshot, model: ValueModel): BoardRow[] {
  const index = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const watch = new Set(snapshot.watchlist);
  const chosen = new Map<string, SnapshotProtocol>();
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  for (const p of snapshot.protocols) {
    if (!chosen.has(p.slug) && isRankable(p)) chosen.set(p.slug, p);
  }
  const liveMcaps = snapshot.protocols.map((p) => p.mcap_usd ?? 0);
  const valueCap = Math.max(1, ...liveMcaps);
  const scored = [...chosen.values()].map((p) => ({ p, v: valuate(p, snapshot.as_of, model, valueCap) }));
  scored.sort((a, b) => b.v.implied - a.v.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  return scored.map((s, i) => {
    const plan = farmPlan(s.p, s.v.age_days, s.v.readiness);
    return {
      rank: i + 1,
      slug: s.p.slug,
      name: s.p.name,
      category: s.p.category,
      chains: s.p.chains,
      tvl_usd: s.p.tvl_usd,
      change_7d: s.p.change_7d,
      mcap_usd: s.p.mcap_usd,
      listed_at: s.p.listed_at,
      gecko_id: s.p.gecko_id,
      symbol: s.p.symbol,
      token_status: 'pre-token' as const,
      watchlist: watch.has(s.p.slug),
      age_days: s.v.age_days,
      readiness: s.v.readiness,
      implied_value_usd: s.v.implied,
      model: {
        multiple: round4(s.v.multiple),
        momentum_multiplier: round4(s.v.momentum),
        maturity_multiplier: round4(s.v.maturity),
        reach_multiplier: round4(s.v.reach),
      },
      farm_steps: plan.map(stepText),
    };
  });
}

/** The live-token comparison set: the largest trading tokens, at the market's own values. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : 1))
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
      multiple: p.mcap_usd !== null && p.tvl_usd > 0 ? round4(p.mcap_usd / p.tvl_usd) : null,
    }));
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot): { board: BoardRow[]; radar: RadarData } {
  const model = buildModel(snapshot);
  const board = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const watch = new Set(snapshot.watchlist);
  const bySlug = new Map(snapshot.protocols.map((p) => [p.slug, p]));
  const planBySlug = new Map<string, FarmStepParts[]>();
  for (const row of board) {
    planBySlug.set(row.slug, farmPlan(bySlug.get(row.slug)!, row.age_days, row.readiness));
  }
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL_VERSION,
    model,
    scanned_size: snapshot.protocols.length,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: board.filter((r) => !watch.has(r.slug)).length,
    live_size: live.length,
    total_implied_usd: board.reduce((sum, r) => sum + r.implied_value_usd, 0),
    value_cap_usd: Math.max(1, ...snapshot.protocols.map((p) => p.mcap_usd ?? 0)),
    rows: board.map((row) => ({ ...row, farm_plan: planBySlug.get(row.slug)! })),
    live,
  };
  return { board, radar };
}

/** The snapshot out of a file's text, refused unless it is the shape the model scores. */
export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new SnapshotError('snapshot.json is not JSON');
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) throw new SnapshotError('snapshot.json is not a JSON object');
  const o = raw as Record<string, unknown>;
  if (typeof o.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(o.as_of)) throw new SnapshotError('snapshot.json has no as_of date');
  if (typeof o.source !== 'string') throw new SnapshotError('snapshot.json has no source');
  if (typeof o.floor_usd !== 'number' || !Number.isSafeInteger(o.floor_usd) || o.floor_usd <= 0) throw new SnapshotError('snapshot.json has no floor_usd');
  if (!Array.isArray(o.protocols)) throw new SnapshotError('snapshot.json has no protocols array');
  if (!Array.isArray(o.watchlist) || o.watchlist.some((s) => typeof s !== 'string')) throw new SnapshotError('snapshot.json has no watchlist of slugs');
  const protocols = o.protocols.map((v, i) => {
    if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new SnapshotError(`snapshot.json's protocol ${i} is not an object`);
    const p = v as Record<string, unknown>;
    if (typeof p.slug !== 'string' || typeof p.name !== 'string' || typeof p.tvl_usd !== 'number' || !Number.isFinite(p.tvl_usd)) {
      throw new SnapshotError(`snapshot.json's protocol ${i} lacks a slug, a name or a TVL`);
    }
    return {
      slug: p.slug,
      name: p.name,
      category: typeof p.category === 'string' ? p.category : null,
      chains: Array.isArray(p.chains) ? p.chains.filter((c): c is string => typeof c === 'string') : [],
      tvl_usd: p.tvl_usd,
      change_7d: typeof p.change_7d === 'number' && Number.isFinite(p.change_7d) ? p.change_7d : null,
      mcap_usd: typeof p.mcap_usd === 'number' && Number.isFinite(p.mcap_usd) ? p.mcap_usd : null,
      listed_at: typeof p.listed_at === 'string' ? p.listed_at : null,
      gecko_id: typeof p.gecko_id === 'string' ? p.gecko_id : null,
      symbol: typeof p.symbol === 'string' ? p.symbol : null,
    };
  });
  return { as_of: o.as_of, source: o.source, floor_usd: o.floor_usd, protocols, watchlist: o.watchlist as string[] };
}

/** Why a board is not one the gate will take, or null. Mirrors the gate's board rows. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  if (board.length < 100 || board.length > 4000) return `the board holds ${board.length} rows, outside 100..4000`;
  const slugs = new Set(board.map((r) => r.slug));
  if (slugs.size !== board.length) return 'a slug appears twice on the board';
  const known = new Set(snapshot.protocols.map((p) => p.slug));
  for (const r of board) if (!known.has(r.slug)) return `${r.slug} is not one of the snapshot's protocols`;
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slugs: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  const byRank = [...board].sort((a, b) => a.rank - b.rank);
  for (let i = 1; i < byRank.length; i++) {
    if (byRank[i]!.implied_value_usd > byRank[i - 1]!.implied_value_usd) return `row ${byRank[i]!.slug} outranks ${byRank[i - 1]!.slug} on implied value`;
  }
  if (board.length >= 2 && byRank[0]!.implied_value_usd === byRank[byRank.length - 1]!.implied_value_usd) return 'every row shares one implied value';
  for (const r of board) {
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0 || r.implied_value_usd > 100_000_000_000_000) {
      return `${r.slug} has implied value ${r.implied_value_usd}`;
    }
    if (r.farm_steps.length < 3 || r.farm_steps.length > 12) return `${r.slug} has ${r.farm_steps.length} farm steps`;
    for (const s of r.farm_steps) {
      const t = s.trim();
      if (t.length < 20 || t.length > 600) return `${r.slug} has a farm step of ${t.length} characters`;
    }
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
