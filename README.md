# pump-tracker

Hourly on-chain tracker, entry scorer and alerting for the PUMP token, run on GitHub Actions.

## What runs

| Script | Cadence | Does |
|---|---|---|
| `pump-tracker.js` | hourly | Scans all PUMP token accounts (Helius DAS) for top-500 holders and holder count. Pulls **chain supply** (`getTokenSupply`), Hyperliquid **open interest / funding**, and SOL spot. Appends a snapshot to `pump-tracker-history.json`. Exits non-zero on failure so nothing downstream runs on stale data. |
| `pump-alerts.js` | hourly, after tracker | Computes the entry score from `pump-signals.js`, applies 2-run hysteresis, writes a row to `pump-forecast-log.json`. Scorer-derived notifications (tier / dip / velocity) are **muted** (`SCORER_ALERTS=0` in the workflow) until re-validated. |
| `pump-whales.js` | hourly | Unknown-whale tracker. |
| `pump-price-monitor.js` | every 15 min | DexScreener price; spike / dip / 24h-high alerts. These still notify. |
| `pump-regime.js` | daily 06:37 UTC | Medium-term (3–30d) regime model from daily DefiLlama fees + prices: three dials (SOL 30d trend, fee base not shrinking, price not in deepening drawdown), sizing from holder-flow yield vs its own 90d. **Notifies on dial flips only.** Logs to `pump-regime-log.json`. Holder flow = 100% of fees before 2026-04-01, 50% after. |

## Evaluating signals (do this before trusting any weight)

```
node pump-walkforward.js            # 72h horizon, 14-day windows
node pump-walkforward.js --h 24     # 24h horizon
node pump-walkforward.js --since 2026-09-28 --window 7
node pump-scorecard.js              # grades the live forecast log out of sample
node pump-backtest.js               # legacy pooled backtest (in-sample; superseded)
```

`pump-walkforward.js` judges each condition against the **base rate of its own time window** and against **SOL-residual returns** (PUMP is ~2x SOL beta in Oct 2026). A condition earns trust only when its excess is positive in most windows. `n` counts hours, and forward windows overlap, so `n=50` is maybe 5-10 independent episodes.

Why this exists: the scorer's weights were fit on Jul-Sep 2026 data when PUMP rose 214% and *any* hour returned +8% over 72h. From Sep 28 to Oct 21 most of those signals flipped sign (exchange outflow > 1B went from an 89% to a 0% win rate; 3-day-dip buying from 80% to 19%). `pump-scorecard.js` is the ongoing test: every forecast row is written before the outcome is known.

## Medium-term regime model

`node pump-regime.js --no-notify` prints the dials, the levels at which each flips, the since-launch SOL-beta decomposition, and the in-sample forward-30d table by state. The rules live in `RULES` at the top of the file. The sample contains roughly two regimes, so treat the table as directional and let `pump-regime-log.json` accumulate.

## Data notes

- `totalSupply` before 2026-10-21 was the *sum of the paginated scan* and drifts by tens of millions per hour. `smoothSupply()` in `pump-signals.js` repairs it (rolling median, then monotone non-increasing). Snapshots from 2026-10-21 carry `chainSupply` and are used as-is.
- `sol-price-history.json`: hourly SOL from CoinGecko, Jul 14 2026 onward. Snapshots from 2026-10-21 also carry `solPrice` directly.
- `perps` (Hyperliquid OI, funding, mark, 24h volume) collection started 2026-10-21. The OI/funding rows in the walk-forward fill in as data accrues.
- Both Actions jobs push to `main`; they `git pull --rebase` before pushing.

## Re-enabling scorer alerts

Set `SCORER_ALERTS: "1"` in `.github/workflows/pump-collect.yml` once `pump-scorecard.js` shows a tier beating the base rate for several weeks running.
