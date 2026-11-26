// The token radar's model: one snapshot of the protocol universe in, one ranked board out.
//
// The board covers every slug in the snapshot's watchlist (the floor, never a ceiling) and adds the
// early protocols below the floor that pass the same launch screen the watchlist applies: pre-token,
// not a wrapped, staked or bridged product of a token that already trades, not an exchange, not a
// versioned pool. A protocol is pre-token when its index entry records no token (no market cap, no
// CoinGecko id, no symbol); the snapshot's live-token protocols are kept apart and shown as the
// market's own values, never mixed into the ranked board — and they are also the model's training
// set, so the value of a launch is fitted from the market, not assumed.
//
// Implied value is fitted, not hand-set (lib/fit.ts does the fitting, this file only applies it):
//
//   log ratio = ln(market cap / TVL) of a live token, winsorized at 3.0
//   category  = the shrunk mean log ratio of the live tokens in the same category,
//               (sum + 20 x global mean) / (n + 20), so one live token can never set
//               a category's price on its own; a category with no live token uses the
//               global mean outright
//   terms     = a ridge regression (lambda 10, intercept unpenalized) of the residual
//               log ratio on five features: log TVL against $100M, seven-day growth,
//               the rise of the first year of age and the fall after it, and the extra
//               chains beyond the first. Growth is winsorized to the range the live
//               tokens actually show, so a board protocol growing 4,448% in a week is
//               scored as if it grew 27% — the fastest a live token ever grew —
//               instead of extrapolating a line far past the record that fitted it.
//   implied   = max(1, round(tvl_usd x exp(category + intercept + terms))), the ratio
//               clamped to [0.08, 1.2]
//
// The fitted terms say what the market actually pays for: size dominates (a bigger
// protocol earns a lower multiple per TVL dollar), growth and age barely move the
// multiple once size is controlled, and the category sets the level. The fit is
// tested held out three ways — leave-one-out, five-fold, walk-forward — against the
// radar-4 hand-set model and a TVL-only model, and the dashboard shows those numbers.
//
// No protocol name is ever special-cased: the same fitted function scores every row,
// and the fit is recomputed from the snapshot on every run, so a future snapshot
// re-prices the board on its own.

import { fitModel, impliedFromLogRatio, predictLogRatio } from './fit.ts';
import type { FitValidation, FittedModel } from './fit.ts';

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

/** The fit's hyperparameters, as the dashboard states them and the sandbox may change them. The fitted coefficients are not constants: lib/fit.ts computes them from the snapshot on every run. */
export interface ModelConstants {
  ridge_lambda: number;
  category_shrinkage_k: number;
  ratio_cap: number;
  multiple_floor: number;
  multiple_cap: number;
  unknown_age_days: number;
  min_live_for_category: number;
}

export const MODEL: ModelConstants = {
  ridge_lambda: 10,
  category_shrinkage_k: 20,
  ratio_cap: 3.0,
  multiple_floor: 0.08,
  multiple_cap: 1.2,
  unknown_age_days: 180,
  min_live_for_category: 3,
};

/** The model's version label: the dashboard names it and the rules quote it. radar-5 replaces the hand-set weights with parameters fitted to the snapshot's own traded peers — a two-stage ridge fit of log market-cap-per-TVL on TVL, growth, age and chains, with category effects shrunk toward the global mean — validates them held out three ways, and costs every farm plan to a verdict. */
export const MODEL_VERSION = 'radar-5';

/** How many live-token protocols the Live token view carries, by market cap. */
export const LIVE_ROWS = 24;

/** One category's calibration: what the market pays per TVL dollar for its tokens. */
export interface CategoryCalibration {
  category: string;
  live_count: number;
  median: number | null;
  multiple: number;
  source: 'category' | 'blend' | 'global';
}

/** The whole calibration: every category on the board, plus the global fallback. */
export interface Calibration {
  global_multiple: number;
  live_count: number;
  categories: CategoryCalibration[];
}

/** The fitted coefficients and the range they were fitted on, for the dashboard's model panel. */
export interface FitRecord {
  intercept: number;
  logtvl: number;
  growth: number;
  rise: number;
  fall: number;
  chains: number;
  global_log_ratio: number;
  growth_min_pct: number;
  growth_max_pct: number;
  live_count: number;
}

/** A farm step: the action, what it costs, and how long it takes. */
export interface FarmStep {
  text: string;
  cost: string;
  time: string;
}

/** One row of board.json: the ranked board's row. */
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
  implied_value_usd: number;
  model: {
    category_multiple: number;
    category_multiple_source: 'category' | 'blend' | 'global';
    growth_pct: number;
    growth_multiplier: number;
    maturity_multiplier: number;
    breadth_multiplier: number;
    size_multiplier: number;
    calibration_multiplier: number;
    log_ratio: number;
    age_days: number | null;
  };
  farm_steps: string[];
}

/** The dashboard's compact view of one row, with farm plans generated in the page. */
export interface RadarRow {
  rank: number;
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  age_days: number | null;
  watchlist: boolean;
  implied_value_usd: number;
  category_multiple: number;
  category_multiple_source: 'category' | 'blend' | 'global';
  growth_multiplier: number;
  maturity_multiplier: number;
  breadth_multiplier: number;
  size_multiplier: number;
  calibration_multiplier: number;
  log_ratio: number;
}

/** A live-token protocol: it already trades, so the board shows the market's own value, not a model's. */
export interface LiveRow {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  mcap_usd: number | null;
  change_7d: number | null;
}

/** Everything the dashboard needs: the board, the live set, the calibration and the model it runs. */
export interface RadarData {
  as_of: string;
  source: string;
  floor_usd: number;
  model: ModelConstants;
  model_version: string;
  fit: FitRecord;
  validation: FitValidation;
  watchlist_size: number;
  board_size: number;
  early_size: number;
  live_size: number;
  /** Pre-token protocols at or above the floor that pass the visible screen but are not on the watchlist: the board leaves them out rather than overriding the house's list (the watchlist rule also excludes products of a parent protocol, a record the snapshot does not carry). */
  excluded_above_floor: number;
  calibration: Calibration;
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

/** A finite number, else `fallback`. */
function finite(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback;
}

/** The median of a non-empty list of numbers; null when the list is empty. */
function median(values: number[]): number | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** DefiLlama's version-marker rule: a name ending in a release is a pool of another protocol. */
const VERSIONED = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A whole word wrapped, staked or staking in a name: a wrapped or staked product of another token. */
const WRAPPED_WORD = /\b(wrapped|staked|staking)\b/i;

/** Categories the watchlist leaves out: a wrapped, staked or bridged product of a token that trades. */
const EXCLUDED_CATEGORIES = new Set(['Bridge', 'Canonical Bridge', 'Liquid Staking', 'Liquid Restaking', 'Restaked BTC', 'CEX']);

/** Names that begin with an exchange's name are that exchange's product, not a launch of its own. */
const EXCHANGE_PREFIXES = ['Binance', 'Coinbase', 'Bybit', 'Kraken', 'Bitget', 'OKX', 'Bitfinex', 'Gemini'];

/** Whether a protocol records no token at all. */
export function isPreToken(p: SnapshotProtocol): boolean {
  return p.mcap_usd === null && p.gecko_id === null && p.symbol === null;
}

/**
 * Whether a protocol could be a launch of its own: pre-token and passing every exclusion the
 * watchlist's rule applies — not a wrapped, staked or bridged product of a token that already trades,
 * not an exchange's product, not a versioned pool. The watchlist is the floor of this screen at or
 * above $50M of TVL; the early radar applies the same screen below the floor.
 */
export function passesLaunchScreen(p: SnapshotProtocol): boolean {
  if (!isPreToken(p)) return false;
  if (EXCLUDED_CATEGORIES.has(p.category ?? '')) return false;
  if (VERSIONED.test(p.name)) return false;
  if (WRAPPED_WORD.test(p.name)) return false;
  if (EXCHANGE_PREFIXES.some((e) => p.name.startsWith(e))) return false;
  return true;
}

/**
 * The calibration, read from the fitted model: each category's multiple is exp of its
 * shrunk mean log ratio (the fitted category effect), clamped to the model's multiple
 * band; the raw median ratio stays beside it so the shrinkage is visible. A category
 * with no live token at all uses the global multiple outright. The source names how
 * the multiple was set: 'category' when at least `min_live_for_category` of its
 * tokens trade, 'blend' when fewer trade (the shrinkage pulls it toward the global
 * mean), 'global' when none trade. A token whose recorded market cap is zero carries
 * no price signal, so it is left out of the medians: a missing price is not a price
 * of zero.
 */
export function fittedCalibration(fitted: FittedModel, snapshot: Snapshot, model: ModelConstants = MODEL): Calibration {
  const live = snapshot.protocols.filter((p) => p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
  const ratiosByCategory = new Map<string, number[]>();
  for (const p of live) {
    const key = p.category ?? 'Other';
    const arr = ratiosByCategory.get(key) ?? [];
    arr.push(Math.min(p.mcap_usd! / p.tvl_usd, model.ratio_cap));
    ratiosByCategory.set(key, arr);
  }
  const clamp = (n: number): number => Math.min(model.multiple_cap, Math.max(model.multiple_floor, n));
  const categories: CategoryCalibration[] = [...fitted.category_log_effect.entries()].map(([category, effect]) => {
    const ratios = ratiosByCategory.get(category) ?? [];
    const med = median(ratios);
    const n = ratios.length;
    const source: 'category' | 'blend' | 'global' = n === 0 ? 'global' : n >= model.min_live_for_category ? 'category' : 'blend';
    return {
      category,
      live_count: n,
      median: med === null ? null : Math.round(med * 1000) / 1000,
      multiple: Math.round(clamp(Math.exp(effect)) * 1000) / 1000,
      source,
    } satisfies CategoryCalibration;
  });
  // Board categories with no live token get the global multiple, so the table covers them.
  const boardCategories = new Set(snapshot.protocols.filter((p) => isPreToken(p)).map((p) => p.category ?? 'Other'));
  for (const category of boardCategories) {
    if (!categories.some((c) => c.category === category)) {
      categories.push({
        category,
        live_count: 0,
        median: null,
        multiple: Math.round(clamp(Math.exp(fitted.global_log_ratio)) * 1000) / 1000,
        source: 'global',
      });
    }
  }
  categories.sort((a, b) => (a.category < b.category ? -1 : a.category > b.category ? 1 : 0));
  return {
    global_multiple: Math.round(clamp(Math.exp(fitted.global_log_ratio)) * 1000) / 1000,
    live_count: live.length,
    categories,
  };
}

/** The six fitted factors and the implied value one protocol gets under the fitted model. */
export function impliedValue(
  protocol: SnapshotProtocol,
  asOf: string,
  fitted: FittedModel,
  calibration: Calibration,
  model: ModelConstants = MODEL,
): {
  implied: number;
  logRatio: number;
  categoryMultiple: number;
  categorySource: 'category' | 'blend' | 'global';
  growthPct: number;
  growthMult: number;
  maturityMult: number;
  breadthMult: number;
  sizeMult: number;
  calibrationMult: number;
  age: number | null;
} {
  const age = ageDays(asOf, protocol.listed_at);
  const logRatio = predictLogRatio(fitted, protocol, asOf, fitted.growth_min, fitted.growth_max);
  const row = calibration.categories.find((c) => c.category === (protocol.category ?? 'Other'));
  const categorySource = row === undefined ? 'global' : row.source;
  const c = fitted.coefficients;
  const ageForModel = age ?? model.unknown_age_days;
  const rise = Math.min(ageForModel, 365) / 365;
  const fall = Math.max(ageForModel - 365, 0) / 365;
  const rawGrowth = finite(protocol.change_7d, 0);
  const growthPct = Math.min(
    fitted.growth_max * 100,
    Math.max(fitted.growth_min * 100, Math.min(120, Math.max(-60, rawGrowth))),
  );
  const growthFeature = growthPct / 100;
  const logTvl = Math.log(protocol.tvl_usd / 100_000_000);
  const extraChains = Math.min(Math.max(protocol.chains.length - 1, 0), 4);
  const categoryMultiple = Math.exp(fitted.category_log_effect.get(protocol.category ?? 'Other') ?? fitted.global_log_ratio);
  const calibrationMult = Math.exp(c.intercept);
  const sizeMult = Math.exp(c.logtvl * logTvl);
  const growthMult = Math.exp(c.growth * growthFeature);
  const maturityMult = Math.exp(c.rise * rise + c.fall * fall);
  const breadthMult = Math.exp(c.chains * extraChains);
  const implied = impliedFromLogRatio(protocol.tvl_usd, logRatio, model.multiple_floor, model.multiple_cap);
  return { implied, logRatio, categoryMultiple, categorySource, growthPct, growthMult, maturityMult, breadthMult, sizeMult, calibrationMult, age };
}

/** The snapshot's protocol by slug. */
function bySlug(protocols: SnapshotProtocol[]): Map<string, SnapshotProtocol> {
  return new Map(protocols.map((p) => [p.slug, p]));
}

/** The protocols the board ranks, strongest first, with ranks 1..n. */
export function buildBoard(
  snapshot: Snapshot,
  model: ModelConstants = MODEL,
): { board: BoardRow[]; calibration: Calibration; fitted: FittedModel; validation: FitValidation } {
  const fitted = fitModel(snapshot.protocols, snapshot.as_of, {
    ridge_lambda: model.ridge_lambda,
    category_shrinkage_k: model.category_shrinkage_k,
    ratio_cap: model.ratio_cap,
  });
  const calibration = fittedCalibration(fitted, snapshot, model);
  const index = bySlug(snapshot.protocols);
  const chosen = new Map<string, SnapshotProtocol>();
  // The watchlist is the floor: every slug, even one the snapshot no longer carries (it cannot, but
  // the board's coverage is the gate's row and is never gambled on a missing record).
  for (const slug of snapshot.watchlist) {
    const p = index.get(slug);
    if (p !== undefined) chosen.set(slug, p);
  }
  // The early radar: protocols below the watchlist floor that pass the same launch screen, by TVL.
  // Never a replacement for a watchlist row: a chosen protocol stays chosen.
  const early = snapshot.protocols
    .filter((p) => !chosen.has(p.slug) && passesLaunchScreen(p) && p.tvl_usd < snapshot.floor_usd)
    .sort((a, b) => b.tvl_usd - a.tvl_usd || (a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  for (const p of early) chosen.set(p.slug, p);

  const scored = [...chosen.values()].map((p) => {
    const v = impliedValue(p, snapshot.as_of, fitted, calibration, model);
    return { p, ...v };
  });
  scored.sort((a, b) => b.implied - a.implied || (a.p.slug < b.p.slug ? -1 : a.p.slug > b.p.slug ? 1 : 0));
  const board: BoardRow[] = scored.map((s, i) => ({
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
    token_status: 'pre-token',
    watchlist: snapshot.watchlist.includes(s.p.slug),
    age_days: s.age,
    implied_value_usd: s.implied,
    model: {
      category_multiple: s.categoryMultiple,
      category_multiple_source: s.categorySource,
      growth_pct: Math.round(s.growthPct * 100) / 100,
      growth_multiplier: round4(s.growthMult),
      maturity_multiplier: round4(s.maturityMult),
      breadth_multiplier: round4(s.breadthMult),
      size_multiplier: round4(s.sizeMult),
      calibration_multiplier: round4(s.calibrationMult),
      log_ratio: s.logRatio,
      age_days: s.age,
    },
    farm_steps: farmSteps(s.p, s.age, s.implied).map(stepText),
  }));
  return { board, calibration, fitted, validation: fitted.validation };
}

const round4 = (n: number): number => Math.round(n * 1e4) / 1e4;

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
export function stepText(step: FarmStep): string {
  let s = `${step.text} Cost: ${step.cost}. Time: ${step.time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/** The first chain a protocol names, or a neutral phrase. */
function chainOf(p: SnapshotProtocol): string {
  return p.chains.length > 0 ? p.chains[0]! : 'its main chain';
}

/** How much capital one farm position needs, from the protocol's own TVL. */
function capitalFor(p: SnapshotProtocol): number {
  if (p.tvl_usd >= 5_000_000_000) return 250;
  if (p.tvl_usd >= 1_000_000_000) return 150;
  if (p.tvl_usd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
function holdDaysFor(age: number | null): number {
  if (age === null) return 30;
  if (age < 180) return 60;
  if (age < 365) return 45;
  return 30;
}

/** What one transaction costs on a chain, for the first step and for a weekly action. */
function gasFor(chain: string): string {
  if (chain === 'Ethereum') return '$8';
  if (chain === 'Solana') return '$0.10';
  const cheap = ['Arbitrum', 'Optimism', 'Base', 'Polygon', 'zkSync Era', 'Linea', 'Scroll', 'Blast', 'Mantle', 'Mode', 'Gnosis', 'Starknet', 'Celo', 'Fantom'];
  if (cheap.includes(chain)) return '$1';
  return '$2';
}

/** What one transaction costs on a chain, as a number, for the verdict's totals. */
function gasNumFor(chain: string): number {
  if (chain === 'Ethereum') return 8;
  if (chain === 'Solana') return 0.1;
  const cheap = ['Arbitrum', 'Optimism', 'Base', 'Polygon', 'zkSync Era', 'Linea', 'Scroll', 'Blast', 'Mantle', 'Mode', 'Gnosis', 'Starknet', 'Celo', 'Fantom'];
  if (cheap.includes(chain)) return 1;
  return 2;
}

/** A dollar figure as a short string: $12.4M, $124K, $56, $0.70 — the same shape the page shows. */
function moneyStr(n: number): string {
  if (!Number.isFinite(n)) return 'n/a';
  if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
  if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}K`;
  if (n === Math.round(n)) return `$${n}`;
  return `$${n.toFixed(2)}`;
}

/**
 * The verdict step: the whole plan costed to one line. The gas is the entry transaction
 * plus one a week for the hold plus one withdrawal per chain used; the attention is the
 * setup, the weekly actions, the checks, the claim, the log and the risk check; the
 * implied value per $1 of capital is the model's implied value divided by the capital;
 * the minimum viable capital is twice the gas, floored at $25, so the gas never eats
 * the position. Nothing here is a slogan: every number is computed from the protocol's
 * own TVL, chains, age and implied value.
 */
function verdictStep(p: SnapshotProtocol, age: number | null, capital: number, hold: number, implied: number): FarmStep {
  const chain = chainOf(p);
  const gasNum = gasNumFor(chain);
  const weeks = Math.ceil(hold / 7);
  const withdrawals = p.chains.length > 1 ? 2 : 1;
  const totalGas = Math.round(gasNum * (1 + weeks + withdrawals) * 100) / 100;
  const minutes = 55 + 15 * weeks;
  const hours = (minutes / 60).toFixed(1);
  const perDollar = Math.round(implied / capital);
  const minViable = Math.max(25, Math.ceil(totalGas * 2));
  const clears = capital >= minViable;
  return {
    text: `Verdict: ${moneyStr(implied)} of implied value against $${capital} of capital locked and about ${moneyStr(totalGas)} of gas, so about ${moneyStr(perDollar)} of implied value per $1 of capital. The position needs about ${hours} hours of attention over ${hold} days, and at least $${minViable} of capital to be worth the gas — the $${capital} plan ${clears ? 'clears' : 'does not clear'} that bar.`,
    cost: `about ${moneyStr(totalGas)} of gas, $${capital} locked`,
    time: `about ${hours} hours over ${hold} days`,
  };
}

/** Whether a chain is an EVM chain, for the wallet the farmer sets up. */
function isEvmChain(chain: string): boolean {
  return ['Ethereum', 'Arbitrum', 'Optimism', 'Base', 'Polygon', 'Avalanche', 'Binance', 'zkSync Era', 'Linea', 'Scroll', 'Blast', 'Mantle', 'Mode', 'Gnosis', 'Starknet', 'Celo', 'Fantom', 'Monad', 'Berachain', 'Sonic', 'Hyperliquid L1'].includes(chain);
}

/** The wallet step, in the words of the chain the protocol lives on. */
function walletStep(chain: string): string {
  if (chain === 'Solana') return 'Set up a fresh Solana wallet (Phantom or Solflare) that holds only the funds you plan to farm, and keep its seed phrase offline.';
  if (isEvmChain(chain)) return 'Set up a fresh EVM wallet that holds only the funds you plan to farm, and keep its seed phrase offline.';
  return 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline.';
}

/** The category's one action, in the words a farmer can follow. */
function actionFor(p: SnapshotProtocol, capital: number, chain: string): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return `Supply $${capital} of USDC to ${name} on ${chain} as collateral and keep the position open.`;
  if (c.includes('dex') || c.includes('liquidity manager')) return `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open.`;
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return `Deposit $${capital} of USDC into ${name}'s highest-TVL vault on ${chain} and keep the shares.`;
  if (c.includes('rwa')) return `Mint $${capital} of the protocol's yield-bearing asset on ${chain} and hold it.`;
  if (c.includes('risk curat') || c.includes('curator') || c.includes('allocator')) return `Deposit $${capital} into a ${name} vault on ${chain} and keep the shares.`;
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) return `Deposit $${capital} of USDC as margin on ${name} and open one small hedge.`;
  if (c.includes('basis')) return `Deposit $${capital} of USDC into ${name}'s basis vault on ${chain} and keep the position.`;
  if (c.includes('staking') || c.includes('restak')) return `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt.`;
  if (c.includes('stable') || c.includes('algo-stable')) return `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}.`;
  if (c.includes('prediction')) return `Fund $${capital} and place one market position on ${name}.`;
  if (c.includes('insurance')) return `Buy $${capital} of cover from ${name} on ${chain} and keep the policy.`;
  if (c.includes('chain')) return `Bridge $${capital} of USDC onto ${chain} and use it in the chain's flagship app.`;
  if (c.includes('launchpad')) return `Stake $${capital} to join ${name}'s next sale on ${chain}.`;
  if (c.includes('payment') || c.includes('card')) return `Spend $${capital} through ${name} on ${chain} and keep the receipts.`;
  if (c.includes('index')) return `Buy $${capital} of the ${name} index on ${chain} and hold it.`;
  if (c.includes('nft')) return `List or buy one item through ${name} on ${chain}.`;
  if (c.includes('governance')) return `Lock $${capital} in ${name}'s governance on ${chain} and vote.`;
  if (c.includes('privacy')) return `Use $${capital} through ${name}'s private pool on ${chain}.`;
  if (c.includes('ai')) return `Deposit $${capital} into ${name}'s compute pool on ${chain}.`;
  if (c.includes('otc')) return `Place one $${capital} quote through ${name} on ${chain}.`;
  if (c.includes('token locker')) return `Lock $${capital} of tokens through ${name} on ${chain}.`;
  if (c.includes('reserve')) return `Deposit $${capital} into ${name}'s reserve on ${chain}.`;
  if (c.includes('bridge')) return `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app.`;
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The weekly qualifying action, different from the main one, by category. */
function weeklyFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  const name = p.name;
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'Borrow a small amount against the collateral and repay it the same week.';
  if (c.includes('dex') || c.includes('liquidity manager')) return 'Swap a small amount through the pool and adjust the range once.';
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return "Claim the vault's yield and redeposit it.";
  if (c.includes('rwa')) return "Claim the asset's yield and hold the receipt.";
  if (c.includes('risk curat') || c.includes('curator') || c.includes('allocator')) return 'Move a small amount into a second vault the curator runs.';
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) return 'Open and close one small position.';
  if (c.includes('basis')) return 'Check the funding rate and rebalance once.';
  if (c.includes('staking') || c.includes('restak')) return 'Restake the staking rewards once.';
  if (c.includes('stable') || c.includes('algo-stable')) return 'Mint and redeem a small amount to show both sides.';
  if (c.includes('prediction')) return 'Settle one position and open another.';
  if (c.includes('insurance')) return "Check the cover's terms and renew if it lapses.";
  if (c.includes('chain')) return 'Make one transaction on the chain each week.';
  if (c.includes('launchpad')) return 'Vote on one sale proposal.';
  if (c.includes('payment') || c.includes('card')) return 'Make one payment a week.';
  if (c.includes('index')) return 'Rebalance a small amount into the index.';
  if (c.includes('nft')) return 'Make one marketplace action a week.';
  if (c.includes('governance')) return 'Vote on one proposal a week.';
  if (c.includes('privacy')) return 'Make one shielded transaction a week.';
  if (c.includes('ai')) return 'Run one job through the pool.';
  if (c.includes('otc')) return 'Settle one trade a week.';
  if (c.includes('token locker')) return 'Check the lock schedule.';
  if (c.includes('reserve')) return 'Check the reserve ratio.';
  if (c.includes('bridge')) return 'Bridge a small amount back the other way.';
  return 'Make one qualifying action each week, such as a deposit, a swap or a vote.';
}

/** A growth figure as a signed percent with one decimal, for a step's text. */
function growthStr(change7d: number | null): string {
  const g = finite(change7d, 0);
  return `${g > 0 ? '+' : ''}${g.toFixed(1)}%`;
}

/**
 * The readiness step: how to size and time the position, from the protocol's own figures. A
 * young protocol with fast-growing TVL is an early, competitive window — set up this week at full
 * size. A young one with flat TVL is early but unproven — start at half size. A protocol that has
 * run three years with no token may never launch one — keep it small. An established protocol with
 * growing TVL is about the size of the future distribution, and a flat one is a slow farm, not a
 * sprint. No name is special-cased: the same branches score every protocol, from its age and growth.
 * These branches are about launch timing — when to size up and when to hold back — not about the
 * value model: the fitted age terms are nearly flat, so the market does not pay much for age once
 * size is controlled, but a three-year-old protocol with no token is still a timing long shot.
 */
export function readinessStep(p: SnapshotProtocol, age: number | null, capital: number): FarmStep {
  const growth = finite(p.change_7d, 0);
  const half = capital / 2;
  if (age === null) {
    return {
      text: `The protocol's listing date is not recorded, so its age is unknown — size the position at the usual $${capital} and watch its TVL for a few weeks before adding more.`,
      cost: 'no fee to decide',
      time: '5 minutes',
    };
  }
  if (age < 180 && growth > 20) {
    return {
      text: `The protocol is young (${age} days listed) and its TVL is growing fast (${growthStr(p.change_7d)} in 7 days) — the window is early and competitive. Set up the position this week at the full $${capital}.`,
      cost: `the $${capital} stays in the position`,
      time: '5 minutes',
    };
  }
  if (age < 180) {
    return {
      text: `The protocol is young (${age} days listed) but its TVL is flat or falling (${growthStr(p.change_7d)} in 7 days) — the window is early but unproven. Start at half the usual amount, $${half}, and add more only if the TVL turns up.`,
      cost: `the $${half} stays in the position`,
      time: '5 minutes',
    };
  }
  if (age >= 1095) {
    return {
      text: `The protocol has run ${age} days with no token — it may never launch one. Keep the position small, $${capital} at most, and treat it as a long shot.`,
      cost: `the $${capital} stays in the position`,
      time: '5 minutes',
    };
  }
  if (growth > 10) {
    return {
      text: `The protocol has run ${age} days and its TVL is growing (${growthStr(p.change_7d)} in 7 days) — the position is about the size of the future distribution, not about being early. Use the full $${capital} and hold for the full window.`,
      cost: `the $${capital} stays in the position`,
      time: '5 minutes',
    };
  }
  return {
    text: `The protocol has run ${age} days with its TVL roughly flat (${growthStr(p.change_7d)} in 7 days) — a launch, if it comes, is not imminent. Use $${capital} and treat the position as a slow farm, not a sprint.`,
    cost: `the $${capital} stays in the position`,
    time: '5 minutes',
  };
}

/** A TVL figure as a short dollar string, for a step's text. */
function tvlStr(tvlUsd: number): string {
  if (tvlUsd >= 1e9) return `$${(tvlUsd / 1e9).toFixed(2)}B`;
  if (tvlUsd >= 1e6) return `$${(tvlUsd / 1e6).toFixed(1)}M`;
  return `$${Math.round(tvlUsd / 1e3)}K`;
}

/**
 * The numbers-check step: the protocol's own figures, re-checked weekly. It replaces the old
 * points-page step, which assumed a rewards page exists that the snapshot never records. Nothing
 * here is invented: TVL, seven-day growth and age all come from the snapshot.
 */
function numbersCheckStep(p: SnapshotProtocol, age: number | null): FarmStep {
  const ageText = age === null ? 'its listing date is not recorded' : `it has run ${age} days with no token`;
  return {
    text: `This week the protocol holds ${tvlStr(p.tvl_usd)} of TVL, ${growthStr(p.change_7d)} in 7 days, and ${ageText}. Re-check those three numbers every week; if TVL falls two weeks running, unwind the position.`,
    cost: 'no fee to check',
    time: '5 minutes a week',
  };
}

/** What to watch while holding, by category: the one number that would change the plan. */
function watchFor(p: SnapshotProtocol): string {
  const c = (p.category ?? '').toLowerCase();
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) return 'watch the borrow rate and the collateral ratio';
  if (c.includes('dex') || c.includes('liquidity manager')) return "watch the pool's fees and the price range";
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) return "watch the vault's yield and its TVL";
  if (c.includes('staking') || c.includes('restak')) return 'watch the unbonding period and the staking yield';
  if (c.includes('stable') || c.includes('algo-stable')) return 'watch the peg every day';
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) return 'watch the funding rate and the liquidation price';
  if (c.includes('rwa')) return "watch the underlying asset's yield";
  if (c.includes('basis')) return 'watch the funding rate';
  return 'watch the TVL';
}

/** The hold step: how long, and what to watch while holding, from the protocol's own record. */
function holdStep(p: SnapshotProtocol, age: number | null, capital: number, hold: number): FarmStep {
  return {
    text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot, and ${watchFor(p)} while you hold it.`,
    cost: `the $${capital} stays in the position`,
    time: `${hold} days`,
  };
}

/** The claim step: where to claim, on one chain or several, from the protocol's own chains. */
function claimStep(p: SnapshotProtocol): FarmStep {
  if (p.chains.length > 1) {
    return {
      text: `Before you withdraw, check the protocol's own announcements for a claim link on each chain you used, and claim on the chain where the position is largest first. Use only a link the protocol itself publishes, and never pay anyone to claim.`,
      cost: 'no fee to check, and never pay to claim',
      time: '10 minutes',
    };
  }
  return {
    text: `Before you withdraw, check the protocol's own announcements for a claim link and use only the link it publishes. Never pay anyone to claim, and never connect the wallet to a link from a reply or a direct message.`,
    cost: 'no fee to check, and never pay to claim',
    time: '10 minutes',
  };
}

/** The log step: exactly what to write down, from the protocol's own figures. */
function logStep(p: SnapshotProtocol, age: number | null): FarmStep {
  const ageText = age === null ? 'listing date not recorded' : `${age} days listed`;
  // The chains list is capped at twelve names so this step never crowds the gate's 600-character
  // cap, however many chains a protocol lives on; the count keeps the record complete.
  const chains =
    p.chains.length > 12 ? `${p.chains.slice(0, 12).join(', ')} and ${p.chains.length - 12} more` : p.chains.length > 0 ? p.chains.join(', ') : 'one chain';
  return {
    text: `Write the wallet, the dates, the entry TVL (${tvlStr(p.tvl_usd)}), the 7-day growth (${growthStr(p.change_7d)}), the age (${ageText}), the chains (${chains}) and every transaction hash in a farm log, so you can repeat the position or unwind it.`,
    cost: 'nothing but the log',
    time: '5 minutes',
  };
}

/** The risk step: the one way this kind of position loses money, with a concrete limit. */
function riskStep(p: SnapshotProtocol, capital: number): FarmStep {
  const c = (p.category ?? '').toLowerCase();
  const atRisk = Math.round(capital * 0.2);
  if (c.includes('dex') || c.includes('liquidity manager')) {
    return {
      text: `The main risk is impermanent loss on the pair and slippage on entry and exit: size the position so a 20% move against you costs at most $${atRisk}, and set slippage to 0.5% on every swap.`,
      cost: `the $${capital} stays at risk`,
      time: '10 minutes to check',
    };
  }
  if (c.includes('lend') || c.includes('cdp') || c.includes('collateral')) {
    return {
      text: `The main risk is liquidation if the collateral falls: keep the loan-to-value below 50% so a 30% drop does not liquidate the $${capital} position.`,
      cost: `the $${capital} stays at risk`,
      time: '10 minutes to check',
    };
  }
  if (c.includes('yield') || c.includes('leveraged farm') || c.includes('farm')) {
    return {
      text: `The main risk is the vault's strategy changing or its underlying protocol failing: the $${capital} is exposed to the vault's contracts, so check the vault's audits and TVL every week.`,
      cost: `the $${capital} stays at risk`,
      time: '10 minutes a week',
    };
  }
  if (c.includes('staking') || c.includes('restak')) {
    return {
      text: `The main risk is slashing and the unbonding wait: unstaking takes days, so the $${capital} is locked until the unbonding period ends — check that period before you stake.`,
      cost: `the $${capital} stays at risk`,
      time: '10 minutes to check',
    };
  }
  if (c.includes('stable') || c.includes('algo-stable')) {
    return {
      text: `The main risk is a depeg: the stable asset can trade below $1, so watch the peg daily and exit if it slips more than 2%.`,
      cost: `the $${capital} stays at risk`,
      time: '5 minutes a day',
    };
  }
  if (c.includes('derivative') || c.includes('perpetual') || c.includes('options')) {
    return {
      text: `The main risk is liquidation on leverage: keep leverage at 1x so the $${capital} of margin covers a 20% move against you.`,
      cost: `the $${capital} stays at risk`,
      time: '10 minutes to check',
    };
  }
  return {
    text: `The main risk is the protocol's contracts: the $${capital} is exposed to code you did not audit, so keep the position small and check the protocol's audits before adding more.`,
    cost: `the $${capital} stays at risk`,
    time: '10 minutes to check',
  };
}

/** The exit step: how to unwind, what it costs, and when to leave. */
function exitStep(p: SnapshotProtocol, capital: number, gas: string): FarmStep {
  const second = p.chains.length > 1 ? ' Close the second-chain position first, then the main one.' : '';
  return {
    text: `To unwind, withdraw in reverse order: close the weekly position first, then the main position.${second} Exit if the TVL falls two weeks running, or when the token launches and the claim opens.`,
    cost: `about ${gas} of gas per withdrawal`,
    time: '15 minutes',
  };
}

/**
 * A protocol's farm plan: eleven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age, seven-day growth), never from a
 * hand-written list of names: the wallet and the gas follow its chains, the capital follows its
 * TVL, the hold follows its age, the actions follow its category, and the readiness step sizes and
 * times the position from how long the protocol has run with no token and how fast its TVL is
 * moving. The numbers-check step cites the protocol's own TVL, growth and age instead of assuming
 * a rewards page exists, the risk and exit steps name the position's one way to lose money and
 * how to leave, and the verdict step costs the whole plan to one line: total gas, hours of
 * attention, implied value per $1 of capital, and the minimum viable capital.
 */
export function farmSteps(p: SnapshotProtocol, age: number | null, implied: number): FarmStep[] {
  const chain = chainOf(p);
  const gas = gasFor(chain);
  const capital = capitalFor(p);
  const hold = holdDaysFor(age);
  const secondChain = p.chains.length > 1 ? p.chains[1]! : null;
  return [
    {
      text: walletStep(chain),
      cost: `about ${gas} of gas for the first transaction`,
      time: '5 minutes',
    },
    readinessStep(p, age, capital),
    {
      text: actionFor(p, capital, chain),
      cost: `$${capital} of capital and about ${gas} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weeklyFor(p),
      cost: `about ${gas} of gas a week`,
      time: '10 minutes a week',
    },
    secondChain === null
      ? numbersCheckStep(p, age)
      : {
          text: `Use ${p.name} on ${secondChain} too: repeat the main position there with a smaller amount, so the activity counts on two chains.`,
          cost: `$25 of capital and about ${gasFor(secondChain)} of gas`,
          time: '20 minutes',
        },
    holdStep(p, age, capital, hold),
    claimStep(p),
    logStep(p, age),
    riskStep(p, capital),
    exitStep(p, capital, gas),
    verdictStep(p, age, capital, hold, implied),
  ];
}

/** The live-token protocols, by market cap, for the dashboard's Live token view. */
export function liveRows(snapshot: Snapshot): LiveRow[] {
  return snapshot.protocols
    .filter((p) => !isPreToken(p) && p.category !== 'CEX')
    .sort((a, b) => (b.mcap_usd ?? 0) - (a.mcap_usd ?? 0) || b.tvl_usd - a.tvl_usd)
    .slice(0, LIVE_ROWS)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      chains: p.chains,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd,
      change_7d: p.change_7d,
    }));
}

/** A board row's compact form for data.js, with the farm plan generated in the page. */
export function radarRow(row: BoardRow): RadarRow {
  return {
    rank: row.rank,
    slug: row.slug,
    name: row.name,
    category: row.category,
    chains: row.chains,
    tvl_usd: row.tvl_usd,
    change_7d: row.change_7d,
    mcap_usd: row.mcap_usd,
    listed_at: row.listed_at,
    age_days: row.age_days,
    watchlist: row.watchlist,
    implied_value_usd: row.implied_value_usd,
    category_multiple: row.model.category_multiple,
    category_multiple_source: row.model.category_multiple_source,
    growth_multiplier: row.model.growth_multiplier,
    maturity_multiplier: row.model.maturity_multiplier,
    breadth_multiplier: row.model.breadth_multiplier,
    size_multiplier: row.model.size_multiplier,
    calibration_multiplier: row.model.calibration_multiplier,
    log_ratio: row.model.log_ratio,
  };
}

/** Everything the dashboard renders, from the snapshot. */
export function buildRadar(snapshot: Snapshot, model: ModelConstants = MODEL): { board: BoardRow[]; radar: RadarData } {
  const { board, calibration, fitted } = buildBoard(snapshot, model);
  const live = liveRows(snapshot);
  const early = board.filter((r) => !r.watchlist).length;
  const boardSlugs = new Set(board.map((r) => r.slug));
  const excludedAboveFloor = snapshot.protocols.filter(
    (p) => p.tvl_usd >= snapshot.floor_usd && !snapshot.watchlist.includes(p.slug) && !boardSlugs.has(p.slug) && passesLaunchScreen(p),
  ).length;
  const radar: RadarData = {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model,
    model_version: MODEL_VERSION,
    fit: {
      intercept: round4(fitted.coefficients.intercept),
      logtvl: round4(fitted.coefficients.logtvl),
      growth: round4(fitted.coefficients.growth),
      rise: round4(fitted.coefficients.rise),
      fall: round4(fitted.coefficients.fall),
      chains: round4(fitted.coefficients.chains),
      global_log_ratio: round4(fitted.global_log_ratio),
      growth_min_pct: Math.round(fitted.growth_min * 10000) / 100,
      growth_max_pct: Math.round(fitted.growth_max * 10000) / 100,
      live_count: fitted.live_count,
    },
    validation: fitted.validation,
    watchlist_size: snapshot.watchlist.length,
    board_size: board.length,
    early_size: early,
    live_size: live.length,
    excluded_above_floor: excludedAboveFloor,
    calibration: {
      global_multiple: calibration.global_multiple,
      live_count: calibration.live_count,
      categories: calibration.categories.filter((c) => board.some((r) => (r.category ?? 'Other') === c.category)),
    },
    rows: board.map(radarRow),
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
  return {
    as_of: o.as_of,
    source: o.source,
    floor_usd: o.floor_usd,
    protocols,
    watchlist: o.watchlist as string[],
  };
}

/** Why a board is not one the gate will take, or null: coverage, ranks, order, one shared implied value, and farm steps. */
export function boardIssue(board: BoardRow[], snapshot: Snapshot): string | null {
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  if (missing.length > 0) return `the board misses ${missing.length} watchlist slug${missing.length === 1 ? '' : 's'}: ${missing.slice(0, 5).join(', ')}`;
  const ranks = board.map((r) => r.rank).sort((a, b) => a - b);
  for (let i = 0; i < ranks.length; i++) if (ranks[i] !== i + 1) return `rank ${i + 1} is ${ranks[i]}`;
  for (let i = 1; i < board.length; i++) if (board[i]!.implied_value_usd > board[i - 1]!.implied_value_usd) return `row ${i + 1} outranks row ${i} on implied value`;
  if (board.length >= 2 && board[0]!.implied_value_usd === board[board.length - 1]!.implied_value_usd) {
    return `all ${board.length} rows share the same implied value $${board[0]!.implied_value_usd}: a board that ranks nothing by value is not a ranking`;
  }
  for (const r of board) {
    const steps = r.farm_steps;
    if (steps.length < 3 || steps.length > 12) return `${r.slug} has ${steps.length} farm steps`;
    for (const s of steps) if (s.length < 20 || s.length > 600) return `${r.slug} has a farm step of ${s.length} characters`;
    if (!Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0) return `${r.slug} has implied value ${r.implied_value_usd}`;
  }
  return null;
}

/** A compact data.js: the dashboard's whole dataset as one script, no fetch and no network. */
export function dataScript(radar: RadarData): string {
  return `window.RADAR=${JSON.stringify(radar)};\n`;
}
