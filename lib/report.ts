// Radar run report: the four lines a run prints, and the independent
// re-check of the board it hands in.
//
// The entrypoint stays a thin driver: it reads the snapshot, builds the
// radar, writes the outputs, and then asks this module to say what happened
// and to double-check the board. Keeping the reporting here means the
// entrypoint never formats a number twice and never decides on its own
// whether a board is good enough to hand in.
//
// The re-check is deliberately a second implementation of the invariants,
// not a call back into boardIssue: two independent passes have to agree
// before a board leaves the machine. A board that fails any single check
// below is refused outright, the same as one boardIssue rejects, because a
// ranking that violates its own invariants is not a radar at all.

import { join } from 'node:path';
import type { BoardRow, FitRecord, RadarData, Snapshot } from './model.ts';
import type { FitValidation } from './fit.ts';

/** One invariant of the board, with the evidence for its verdict. */
export interface ReportCheck {
  name: string;
  passed: boolean;
  detail: string;
}

/** A dollar amount with thousands separators, for the rank-1 line. */
export function formatUsd(amount: number): string {
  return `$${amount.toLocaleString('en-US')}`;
}

/** The fitted coefficients as one clause: intercept, then each term in turn. */
export function formatFitClause(fit: FitRecord): string {
  return `log-ratio intercept ${fit.intercept.toFixed(4)}, logTVL ${fit.logtvl.toFixed(4)}, growth ${fit.growth.toFixed(4)}, rise ${fit.rise.toFixed(4)}, fall ${fit.fall.toFixed(4)}, chains ${fit.chains.toFixed(4)}`;
}

/** The coverage line: how many protocols the snapshot held, and how many rows the radar scored. */
export function coverageLine(snapshot: Snapshot, board: BoardRow[], radar: RadarData): string {
  return `token radar: ${snapshot.protocols.length} protocols, ${snapshot.watchlist.length} on the watchlist, ${board.length} rows scored (${radar.early_size} early, ${radar.live_size} live set aside)`;
}

/** The leader line: the rank-1 protocol, its implied value, and the multiple behind it. */
export function leaderLine(board: BoardRow[]): string {
  const top = board[0]!;
  return `token radar: rank 1 is ${top.name} at ${formatUsd(top.implied_value_usd)} implied (${top.category}, multiple ${top.model.category_multiple} from ${top.model.category_multiple_source})`;
}

/** The fit line: the live-token count, the fitted coefficients, and the two held-out lifts. */
export function fitLine(fit: FitRecord, validation: FitValidation): string {
  return `token radar: fitted on ${fit.live_count} live tokens: ${formatFitClause(fit)}; held out leave-one-out ${validation.loo.lift_vs_radar4.toFixed(2)}x the hand-set model, walk-forward ${validation.walk_forward.lift_vs_radar4.toFixed(2)}x`;
}

/** The files line: every output the run wrote, with the counts of each kind. */
export function filesLine(out: string, dashboardFiles: string[], shots: string[]): string {
  return `token radar: wrote ${join(out, 'board.json')}, ${join(out, 'data.js')}, ${join(out, 'dashboard')} (${dashboardFiles.length} files), ${join(out, 'screenshots')} (${shots.length} images) and ${join(out, 'dossier.json')}`;
}

/** The four lines a run prints, in the order they are printed. */
export function summarizeRun(snapshot: Snapshot, board: BoardRow[], radar: RadarData, out: string, dashboardFiles: string[], shots: string[]): string[] {
  return [
    coverageLine(snapshot, board, radar),
    leaderLine(board),
    fitLine(radar.fit, radar.validation),
    filesLine(out, dashboardFiles, shots),
  ];
}

/**
 * Re-check every invariant the board must hold, as a second pair of eyes.
 * Each check carries the evidence for its verdict, so a refusal names the
 * exact row and the exact rule it broke instead of a bare failure.
 */
export function verifyBoard(board: BoardRow[], snapshot: Snapshot): ReportCheck[] {
  const checks: ReportCheck[] = [];
  const slugs = new Set(board.map((r) => r.slug));
  const missing = snapshot.watchlist.filter((s) => !slugs.has(s));
  checks.push({
    name: 'watchlist coverage',
    passed: missing.length === 0,
    detail: missing.length === 0 ? `all ${snapshot.watchlist.length} watchlist slugs are on the board` : `missing ${missing.length}: ${missing.slice(0, 5).join(', ')}`,
  });
  const badRank = board.findIndex((r, i) => r.rank !== i + 1);
  checks.push({
    name: 'ranks run 1 to N',
    passed: badRank === -1,
    detail: badRank === -1 ? `ranks 1 to ${board.length} with no gap and no repeat` : `row ${badRank + 1} carries rank ${board[badRank]!.rank}`,
  });
  const outOfOrder = board.findIndex((r, i) => i > 0 && r.implied_value_usd > board[i - 1]!.implied_value_usd);
  checks.push({
    name: 'implied values do not rise down the board',
    passed: outOfOrder === -1,
    detail: outOfOrder === -1 ? `implied value is non-increasing across all ${board.length} rows` : `row ${outOfOrder + 1} outranks row ${outOfOrder} on implied value`,
  });
  const badValue = board.find((r) => !Number.isSafeInteger(r.implied_value_usd) || r.implied_value_usd <= 0);
  checks.push({
    name: 'implied values are positive whole dollars',
    passed: badValue === undefined,
    detail: badValue === undefined ? `every row carries a positive whole-dollar implied value` : `${badValue.slug} has implied value ${badValue.implied_value_usd}`,
  });
  const badSteps = board.find((r) => r.farm_steps.length < 3 || r.farm_steps.length > 12 || r.farm_steps.some((s) => s.length < 20 || s.length > 600));
  checks.push({
    name: 'farm plans are 3 to 12 steps of 20 to 600 characters',
    passed: badSteps === undefined,
    detail: badSteps === undefined ? `every row carries a farm plan inside the limits` : `${badSteps.slug} carries ${badSteps.farm_steps.length} steps`,
  });
  const slugCounts = new Map<string, number>();
  for (const r of board) slugCounts.set(r.slug, (slugCounts.get(r.slug) ?? 0) + 1);
  const repeated = [...slugCounts.entries()].find(([, n]) => n > 1);
  checks.push({
    name: 'no slug appears twice',
    passed: repeated === undefined,
    detail: repeated === undefined ? `all ${board.length} slugs are distinct` : `${repeated[0]} appears ${repeated[1]} times`,
  });
  const traded = board.find((r) => r.mcap_usd !== null && r.mcap_usd > 0);
  checks.push({
    name: 'every row is pre-token',
    passed: traded === undefined,
    detail: traded === undefined ? `no row carries a traded market cap, so the board never ranks a token that already trades` : `${traded.slug} carries a market cap of $${traded.mcap_usd!.toLocaleString('en-US')}`,
  });
  return checks;
}
