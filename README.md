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

Stage 1 fits one shrunk mean log ratio per category; stage 2 is a ridge regression of the residual on log TVL, growth, rise and fall of age, and extra chains. Held-out on the live tokens: leave-one-out 1.33x the hand-set model and 1.18x TVL-only (3.54 vs 4.70 vs 4.18 MSE); walk-forward 1.28x / 1.19x; five-fold 1.32x / 1.24x. The log ratio is noisy (in-sample R² 0.23), so the model ranks launches better than it prices them.
