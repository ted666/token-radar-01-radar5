// The fitted value model: every number the board ranks by is read from the snapshot's own
// traded protocols, and every number is tested on protocols the fit never saw.
//
// The model is a two-stage fit of the log market-cap-per-TVL ratio of the snapshot's live
// tokens (128 of them carry a market cap and a TVL):
//
//   stage 1 — one effect per category: the shrunk mean of its tokens' log ratios,
//             (sum + 20 x global mean) / (n + 20), so a category with one live token
//             sits almost on the global mean and a category with many tokens speaks
//             for itself. The global mean is the mean log ratio of all 128 live tokens.
//   stage 2 — a ridge regression (lambda 10, intercept unpenalized) of the residual
//             log ratio on five features of each token: log TVL, seven-day growth,
//             a rise term for the first year of age and a fall term after it, and the
//             number of extra chains. The growth feature is winsorized to the range the
//             live tokens actually show, so a board protocol growing 4,448% in a week
//             is scored as if it grew 27% — the fastest a live token ever grew —
//             instead of extrapolating a line far past the record that fitted it.
//
// A pre-token protocol's implied value is its TVL times exp(category effect +
// intercept + the five fitted terms), clamped to a ratio of 0.08–1.2. No name is
// special-cased: the same fitted function scores every row, and a future snapshot
// re-fits the board on its own.
//
// The fit is tested held out, three ways, on the same snapshot: leave-one-out
// (refit 128 times, each token predicted by a fit that never saw it), five-fold
// cross-validation (seeded shuffle, seed 20261127), and a walk-forward test
// (the 95 live tokens with a recorded listing date, in chronological quartiles,
// each fold predicted by a fit trained only on earlier listings). Each is scored
// against two baselines refit on the same folds: the radar-4 hand-set model
// (median multiples, a maturity hump, growth weight 1.0) and a TVL-only model
// (the global median ratio for every protocol). The numbers the dashboard shows
// are computed here, at runtime, from the snapshot — never typed in by hand.

/** The smallest protocol record the fit needs: the six fields it reads. */
export interface FitProtocol {
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
}

/** The fitted coefficients: one intercept and one slope per feature. */
export interface FitCoefficients {
  intercept: number;
  logtvl: number;
  growth: number;
  rise: number;
  fall: number;
  chains: number;
}

/** One held-out method's mean squared error, and the fitted model's lift over each baseline. */
export interface HeldOutResult {
  fitted_mse: number;
  radar4_mse: number;
  tvl_mse: number;
  lift_vs_radar4: number;
  lift_vs_tvl: number;
}

/** The three held-out tests, and the in-sample fit quality, for one snapshot. */
export interface FitValidation {
  live_count: number;
  walk_forward_count: number;
  r_squared: number;
  loo: HeldOutResult;
  five_fold: HeldOutResult;
  walk_forward: HeldOutResult;
}

/** Everything the fit learned from one snapshot, ready for the board to use. */
export interface FittedModel {
  coefficients: FitCoefficients;
  category_log_effect: Map<string, number>;
  global_log_ratio: number;
  growth_min: number;
  growth_max: number;
  live_count: number;
  validation: FitValidation;
}

/** The fit's hyperparameters: the ridge penalty, the category shrinkage, the ratio cap. */
export interface FitHyperparameters {
  ridge_lambda: number;
  category_shrinkage_k: number;
  ratio_cap: number;
}

const DAY_MS = 86_400_000;

/** A whole day count from `from` to `to`, clamped at zero; null when either date is absent or bad. */
export function fitAgeDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const b = Date.parse(`${listedAt}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return null;
  return Math.max(0, Math.floor((a - b) / DAY_MS));
}

/** The log ratio a live token carries: its market cap per TVL dollar, winsorized at the cap. */
function logRatioOf(p: FitProtocol, ratioCap: number): number {
  return Math.log(Math.min(p.mcap_usd! / p.tvl_usd, ratioCap));
}

/** Whether a protocol carries a market price the fit can learn from. */
function isLive(p: FitProtocol): boolean {
  return p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0;
}

/**
 * The five features of one protocol, with the intercept's 1 in front: log TVL against
 * $100M, seven-day growth as a fraction winsorized to the live range, the rise of the
 * first year of age and the fall after it (both in years), and the extra chains beyond
 * the first, capped at four. An unlisted age counts as 180 days, the same stand-in the
 * board uses everywhere else.
 */
function featureRow(p: FitProtocol, asOf: string, growthMin: number, growthMax: number): number[] {
  const age = fitAgeDays(asOf, p.listed_at) ?? 180;
  const rawGrowth = p.change_7d === null || !Number.isFinite(p.change_7d) ? 0 : p.change_7d;
  const clamped = Math.min(120, Math.max(-60, rawGrowth)) / 100;
  const growth = Math.min(growthMax, Math.max(growthMin, clamped));
  return [
    1,
    Math.log(p.tvl_usd / 100_000_000),
    growth,
    Math.min(age, 365) / 365,
    Math.max(age - 365, 0) / 365,
    Math.min(Math.max(p.chains.length - 1, 0), 4),
  ];
}

/** A small dense linear system, solved by Gaussian elimination with partial pivoting. */
function solveLinear(matrix: number[][], rhs: number[]): number[] {
  const n = rhs.length;
  const aug = matrix.map((row, i) => [...row, rhs[i]!]);
  for (let col = 0; col < n; col++) {
    let pivot = col;
    for (let r = col + 1; r < n; r++) {
      if (Math.abs(aug[r]![col]!) > Math.abs(aug[pivot]![col]!)) pivot = r;
    }
    if (pivot !== col) {
      const tmp = aug[col]!;
      aug[col] = aug[pivot]!;
      aug[pivot] = tmp;
    }
    const div = aug[col]![col]!;
    if (div === 0) continue;
    for (let r = col + 1; r < n; r++) {
      const factor = aug[r]![col]! / div;
      if (factor === 0) continue;
      for (let k = col; k <= n; k++) aug[r]![k]! -= factor * aug[col]![k]!;
    }
  }
  const x = new Array<number>(n).fill(0);
  for (let i = n - 1; i >= 0; i--) {
    let sum = aug[i]![n]!;
    for (let j = i + 1; j < n; j++) sum -= aug[i]![j]! * x[j]!;
    x[i] = aug[i]![i]! === 0 ? 0 : sum / aug[i]![i]!;
  }
  return x;
}

/** The median of a list of numbers; the list must not be empty. */
function medianOf(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

/** The shrunk mean log ratio per category: (sum + k x global) / (n + k). */
function categoryEffects(rows: FitProtocol[], ratioCap: number, k: number, global: number): Map<string, number> {
  const sums = new Map<string, { sum: number; n: number }>();
  for (const p of rows) {
    const key = p.category ?? 'Other';
    const entry = sums.get(key) ?? { sum: 0, n: 0 };
    entry.sum += logRatioOf(p, ratioCap);
    entry.n += 1;
    sums.set(key, entry);
  }
  const effects = new Map<string, number>();
  for (const [key, entry] of sums) effects.set(key, (entry.sum + k * global) / (entry.n + k));
  return effects;
}

/** The ridge fit of the residual log ratio on the five features, intercept unpenalized. */
function ridgeCoefficients(
  rows: FitProtocol[],
  asOf: string,
  effects: Map<string, number>,
  ratioCap: number,
  growthMin: number,
  growthMax: number,
  lambda: number,
): FitCoefficients {
  const dim = 6;
  const normal: number[][] = Array.from({ length: dim }, () => new Array<number>(dim).fill(0));
  const rhs: number[] = new Array<number>(dim).fill(0);
  for (const p of rows) {
    const x = featureRow(p, asOf, growthMin, growthMax);
    const y = logRatioOf(p, ratioCap) - (effects.get(p.category ?? 'Other') ?? 0);
    for (let i = 0; i < dim; i++) {
      rhs[i]! += x[i]! * y;
      for (let j = 0; j < dim; j++) normal[i]![j]! += x[i]! * x[j]!;
    }
  }
  for (let i = 1; i < dim; i++) normal[i]![i]! += lambda;
  const beta = solveLinear(normal, rhs);
  return { intercept: beta[0]!, logtvl: beta[1]!, growth: beta[2]!, rise: beta[3]!, fall: beta[4]!, chains: beta[5]! };
}

/** The core two-stage fit on one training set: category effects, then the ridge regression. */
function fitOn(
  rows: FitProtocol[],
  asOf: string,
  hyper: FitHyperparameters,
  growthMin: number,
  growthMax: number,
): { coefficients: FitCoefficients; category_log_effect: Map<string, number>; global_log_ratio: number } {
  const ys = rows.map((p) => logRatioOf(p, hyper.ratio_cap));
  const global = ys.reduce((a, b) => a + b, 0) / ys.length;
  const effects = categoryEffects(rows, hyper.ratio_cap, hyper.category_shrinkage_k, global);
  const coefficients = ridgeCoefficients(rows, asOf, effects, hyper.ratio_cap, growthMin, growthMax, hyper.ridge_lambda);
  return { coefficients, category_log_effect: effects, global_log_ratio: global };
}

/** The fitted log ratio for one protocol: its category's effect plus the fitted terms. */
export function predictLogRatio(
  fitted: { coefficients: FitCoefficients; category_log_effect: Map<string, number>; global_log_ratio: number },
  p: FitProtocol,
  asOf: string,
  growthMin: number,
  growthMax: number,
): number {
  const x = featureRow(p, asOf, growthMin, growthMax);
  const c = fitted.coefficients;
  const effect = fitted.category_log_effect.get(p.category ?? 'Other') ?? fitted.global_log_ratio;
  return effect + c.intercept + c.logtvl * x[1]! + c.growth * x[2]! + c.rise * x[3]! + c.fall * x[4]! + c.chains * x[5]!;
}

/** The implied value from a fitted log ratio: TVL times the ratio, clamped to the model's band. */
export function impliedFromLogRatio(tvlUsd: number, logRatio: number, floor: number, cap: number): number {
  const ratio = Math.min(cap, Math.max(floor, Math.exp(logRatio)));
  return Math.max(1, Math.round(tvlUsd * ratio));
}

/** The radar-4 hand-set model, recomputed from a training fold: the baseline the fitted model must beat. */
function radar4Calibration(rows: FitProtocol[], ratioCap: number): { multiples: Map<string, number>; globalMedian: number } {
  const byCategory = new Map<string, number[]>();
  const all: number[] = [];
  for (const p of rows) {
    const ratio = Math.min(p.mcap_usd! / p.tvl_usd, ratioCap);
    all.push(ratio);
    const key = p.category ?? 'Other';
    const arr = byCategory.get(key) ?? [];
    arr.push(ratio);
    byCategory.set(key, arr);
  }
  const globalMedian = medianOf(all);
  const multiples = new Map<string, number>();
  for (const [key, ratios] of byCategory) {
    const med = medianOf(ratios);
    const n = ratios.length;
    const blended = n >= 3 ? med : (n * med + 10 * globalMedian) / (n + 10);
    multiples.set(key, Math.min(1.2, Math.max(0.08, blended)));
  }
  return { multiples, globalMedian };
}

/** The radar-4 hand-set log ratio: median multiple, growth weight 1.0, the maturity hump, breadth 0.02. */
function radar4LogRatio(p: FitProtocol, asOf: string, calib: { multiples: Map<string, number>; globalMedian: number }): number {
  const multiple = calib.multiples.get(p.category ?? 'Other') ?? Math.min(1.2, Math.max(0.08, calib.globalMedian));
  const rawGrowth = p.change_7d === null || !Number.isFinite(p.change_7d) ? 0 : p.change_7d;
  const growth = Math.min(120, Math.max(-60, rawGrowth));
  const growthMult = 1 + (growth / 100) * 1.0;
  const age = fitAgeDays(asOf, p.listed_at) ?? 180;
  let maturity: number;
  if (age <= 365) maturity = 0.6 + (age / 365) * 0.4;
  else if (age < 1095) maturity = 1.0 - ((age - 365) / 730) * 0.3;
  else maturity = 0.7;
  const breadth = 1 + 0.02 * Math.min(Math.max(p.chains.length - 1, 0), 4);
  return Math.log(multiple * growthMult * maturity * breadth);
}

/** The TVL-only log ratio: the global median ratio, the same for every protocol. */
function tvlOnlyLogRatio(rows: FitProtocol[], ratioCap: number): number {
  const ratios = rows.map((p) => Math.min(p.mcap_usd! / p.tvl_usd, ratioCap));
  return Math.log(Math.min(1.2, Math.max(0.08, medianOf(ratios))));
}

/** A deterministic shuffle: mulberry32, seeded, so the five folds are the same on every run. */
function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** One method's mean squared error on one test set, every model refit on the training set. */
function foldMse(
  train: FitProtocol[],
  test: FitProtocol[],
  asOf: string,
  hyper: FitHyperparameters,
  growthMin: number,
  growthMax: number,
  method: 'fitted' | 'radar4' | 'tvl',
): number {
  if (test.length === 0) return 0;
  let sum = 0;
  if (method === 'fitted') {
    const fitted = fitOn(train, asOf, hyper, growthMin, growthMax);
    for (const p of test) {
      const err = logRatioOf(p, hyper.ratio_cap) - predictLogRatio(fitted, p, asOf, growthMin, growthMax);
      sum += err * err;
    }
  } else if (method === 'radar4') {
    const calib = radar4Calibration(train, hyper.ratio_cap);
    for (const p of test) {
      const err = logRatioOf(p, hyper.ratio_cap) - radar4LogRatio(p, asOf, calib);
      sum += err * err;
    }
  } else {
    const base = tvlOnlyLogRatio(train, hyper.ratio_cap);
    for (const p of test) {
      const err = logRatioOf(p, hyper.ratio_cap) - base;
      sum += err * err;
    }
  }
  return sum / test.length;
}

/** One held-out method's errors across its folds, weighted by fold size, with the lifts. */
function heldOutResult(
  folds: { train: FitProtocol[]; test: FitProtocol[] }[],
  asOf: string,
  hyper: FitHyperparameters,
  growthMin: number,
  growthMax: number,
): HeldOutResult {
  let fittedSum = 0;
  let radar4Sum = 0;
  let tvlSum = 0;
  let count = 0;
  for (const fold of folds) {
    fittedSum += foldMse(fold.train, fold.test, asOf, hyper, growthMin, growthMax, 'fitted') * fold.test.length;
    radar4Sum += foldMse(fold.train, fold.test, asOf, hyper, growthMin, growthMax, 'radar4') * fold.test.length;
    tvlSum += foldMse(fold.train, fold.test, asOf, hyper, growthMin, growthMax, 'tvl') * fold.test.length;
    count += fold.test.length;
  }
  const fittedMse = fittedSum / count;
  const radar4Mse = radar4Sum / count;
  const tvlMse = tvlSum / count;
  return {
    fitted_mse: fittedMse,
    radar4_mse: radar4Mse,
    tvl_mse: tvlMse,
    lift_vs_radar4: radar4Mse / fittedMse,
    lift_vs_tvl: tvlMse / fittedMse,
  };
}

/** The three held-out tests for one snapshot's live set, plus the in-sample fit quality. */
function validateFit(
  live: (FitProtocol & { slug: string })[],
  asOf: string,
  hyper: FitHyperparameters,
  growthMin: number,
  growthMax: number,
  full: { coefficients: FitCoefficients; category_log_effect: Map<string, number>; global_log_ratio: number },
): FitValidation {
  // Leave-one-out: every token predicted by a fit that never saw it.
  const looFolds = live.map((p, i) => ({ train: live.filter((_, j) => j !== i), test: [p] }));
  const loo = heldOutResult(looFolds, asOf, hyper, growthMin, growthMax);
  // Five-fold cross-validation on a seeded shuffle, so the folds are the same on every run.
  const order = live.map((_, i) => i);
  const rand = mulberry32(20261127);
  for (let i = order.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    const tmp = order[i]!;
    order[i] = order[j]!;
    order[j] = tmp;
  }
  const fiveFolds = [0, 1, 2, 3, 4].map((f) => {
    const testIdx = new Set(order.filter((_, i) => i % 5 === f));
    return { train: live.filter((_, i) => !testIdx.has(i)), test: live.filter((_, i) => testIdx.has(i)) };
  });
  const fiveFold = heldOutResult(fiveFolds, asOf, hyper, growthMin, growthMax);
  // Walk-forward: the live tokens with a recorded listing date, oldest first, in
  // chronological quartiles; each fold is predicted by a fit trained only on earlier listings.
  const dated = live
    .filter((p) => p.listed_at !== null)
    .sort((a, b) => (a.listed_at! < b.listed_at! ? -1 : a.listed_at! > b.listed_at! ? 1 : a.slug < b.slug ? -1 : a.slug > b.slug ? 1 : 0));
  const n = dated.length;
  const bounds = [0, Math.floor(n / 4), Math.floor(n / 2), Math.floor((3 * n) / 4), n];
  const wfFolds = [0, 1, 2].map((k) => ({ train: dated.slice(0, bounds[k + 1]!), test: dated.slice(bounds[k + 1]!, bounds[k + 2]!) }));
  const walkForward = heldOutResult(wfFolds, asOf, hyper, growthMin, growthMax);
  // In-sample R-squared of the full fit, for the record.
  const ys = live.map((p) => logRatioOf(p, hyper.ratio_cap));
  const mean = ys.reduce((a, b) => a + b, 0) / ys.length;
  let ssRes = 0;
  let ssTot = 0;
  for (let i = 0; i < live.length; i++) {
    const pred = predictLogRatio(full, live[i]!, asOf, growthMin, growthMax);
    ssRes += (ys[i]! - pred) ** 2;
    ssTot += (ys[i]! - mean) ** 2;
  }
  return {
    live_count: live.length,
    walk_forward_count: n,
    r_squared: 1 - ssRes / ssTot,
    loo,
    five_fold: fiveFold,
    walk_forward: walkForward,
  };
}

/**
 * The fit for one snapshot: the live tokens are the training set, the growth bounds
 * come from them (the bounds are a no-op on live tokens, so using the full set's
 * bounds for the folds is not leakage — they only bind on board rows), and the
 * validation is computed on the same live set. FitProtocol has no slug, so the
 * walk-forward sort needs one: callers pass protocols with a slug field.
 */
export function fitModel(
  protocols: (FitProtocol & { slug: string })[],
  asOf: string,
  hyper: FitHyperparameters,
): FittedModel {
  const live = protocols.filter(isLive);
  const growths = live.filter((p) => p.change_7d !== null).map((p) => p.change_7d!);
  const growthMin = Math.min(...growths) / 100;
  const growthMax = Math.max(...growths) / 100;
  const full = fitOn(live, asOf, hyper, growthMin, growthMax);
  const validation = validateFit(live, asOf, hyper, growthMin, growthMax, full);
  return {
    coefficients: full.coefficients,
    category_log_effect: full.category_log_effect,
    global_log_ratio: full.global_log_ratio,
    growth_min: growthMin,
    growth_max: growthMax,
    live_count: live.length,
    validation,
  };
}
