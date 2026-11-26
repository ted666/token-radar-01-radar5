# Token Radar v5 — value terms fitted on live peers

Token Radar ranks pre-token protocols by implied value: a two-stage ridge fit of log market-cap-per-TVL on the snapshot's own 128 live tokens, with a costed farm plan for every row. No protocol name is special-cased — every row is scored by the same fitted function of the snapshot's TVL, seven-day growth, age and chain count.

[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/ted666/token-radar-01-radar5/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/ted666/token-radar-01-radar5/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

## How it works

`main.ts` reads the sealed snapshot (`/input/snapshot.json`, or `--input <snapshot.json>`), fits the model at runtime, scores 178 pre-token protocols (the 40-protocol watchlist plus 138 below the floor), and writes the board, the dashboard data, the dashboard and the dossier to the output directory.

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input /input/snapshot.json
```

## The model

Stage 1 fits one shrunk mean log ratio per category; stage 2 is a ridge regression of the residual on log TVL, growth, rise and fall of age, and extra chains. Held-out on the live tokens: leave-one-out 1.33x the hand-set model and 1.18x TVL-only (3.54 vs 4.70 vs 4.18 MSE); walk-forward 1.28x / 1.19x; five-fold 1.32x / 1.24x. The log ratio is noisy (in-sample R² 0.23), so the model ranks launches better than it prices them. Every farm plan is costed to an eleventh verdict step: total gas, hours of attention, implied value per $1 of capital, minimum viable capital, and whether the plan clears it.

## What the run checks

The board is checked twice before anything is written: `boardIssue` in
`lib/model.ts` enforces the gate's invariants, and `verifyBoard` in
`lib/report.ts` re-checks them independently — watchlist coverage, ranks
1 to N with no gap, implied value non-increasing down the board, positive
whole-dollar values, and farm plans of 3 to 12 steps of 20 to 600
characters. The two passes have to agree; a single failing check refuses
the board outright instead of handing in a ranking that breaks its own
rules.

## Reading the board

The dashboard sorts and filters by category, chain and watchlist, and
every row opens a detail view with the six fitted factors, the
recomputation of its implied value, and the costed farm plan. The header
strip names the model version, the live-token count and the held-out
lifts, so the screenshots and the code behind them always agree.

## Reproducing the run

The entry is deterministic: the same snapshot always produces the same
bytes. To reproduce the handed-in output, run `main.ts` against the
sealed snapshot and compare the directory with a fresh `diff -r` — the
board, the dashboard data, the dashboard files, the screenshots and the
dossier all match byte for byte. The gate script in the kit checks the
same eight invariants the submission is graded on: dashboard files,
board shape, ordering, watchlist coverage, farm steps, screenshots,
dossier bytes and page-versus-board agreement.
