# pump-tracker

Hourly on-chain tracker, entry scorer and alerting for the PUMP token, run on GitHub Actions.

## What runs

| Script | Cadence | Does |
|---|---|---|
| `pump-tracker.js` | hourly | Scans all PUMP token accounts (Helius DAS) for top-500 holders and holder count. Pulls **chain supply** (`getTokenSupply`), Hyperliquid **open interest / funding**, and SOL spot. Appends a snapshot to `pump-tracker-history.json`. Exits non-zero on failure so nothing downstream runs on stale data. |
| `pump-alerts.js` | hourly, after tracker | Computes the entry score from `pump-signals.js`, applies 2-run hysteresis, writes a row to `pump-forecast-log.json`. Scorer-derived notifications (tier / dip / velocity) are **muted** (`SCORER_ALERTS=0` in the workflow) until re-validated. |
| `pump-whales.js` | hourly | Unknown-whale tracker. |
| `pump-price-monitor.js` | every 15 min | DexScreener price; spike / dip / 24h-high alerts. These still notify. |
| `pump-perps-history.js` | daily, before regime | Appends Hyperliquid hourly funding/premium (since listing 2025-07-10) and 1h candles, plus OKX open-interest history, to `perps-history.json`. |
| `pump-momentum.js` | hourly, own job | Leveraged 3–14d long setups from Hyperliquid volume/funding/premium plus daily fee and regime context. **Notifies on setup entry and exit** with stop, time stop and in-sample stats. Also sends DE-RISK when the fee base contracts. |
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

## Leveraged momentum setups (3–14 days)

`node pump-leverage-study.js` is the evidence. Random 7-day hold: +1.3%, 48% win, median worst intra-hold move -8.7%, liquidated 18% of the time at 5x and 1% at 3x. Setups that cleared the bar (0% liquidated at 3x in-sample):

| Setup | Rule | 7d fwd | Win | Median worst move | n |
|---|---|---|---|---|---|
| M1 volume expansion + calm | 24h HL volume > 2x 7d avg, 24h up, funding < 20%/yr, premium < 0.05% | +13.0% | 70% | -0.3% | 10 |
| M2 dip inside regime | daily 3/3, 7d < -8%, calm | +9.5% | 78% | -6.6% | 9 |
| M3 fee accel + momentum (2x max) | fees 7d > 30d by 15%, 3d > +5%, calm | +13.4% at 14d | 67% | -14.7% | 12 |

What did **not** work: 20-day breakouts alone (29–33% win at 3–7d), SOL catch-up trades, and the short side at leverage (shorts were right at 3–7d in bear regimes but the intra-hold squeezes liquidated 3x positions; the Aug 21 blowoff short was liquidated before paying). Volume with *hot* funding is the blowoff, not the entry.

Drawdown signatures: every fall > 25% began with either a contracting fee base (Oct 2025, May 2026) or a 30d return > +50% at a sub-15% yield (Jan 2026, Oct 2026). `pump-momentum.js` sends DE-RISK on the first; the regime model's price dial and the yield readout cover the second.

## Position framework

`node pump-portfolio.js --no-notify` backtests and recommends three layers: **core spot** scaled by regime state (never flat, so the buyback drift is always collected), a **tactical leveraged leg** gated by fee acceleration and calm positioning (7d funding and premium), and an optional **SOL hedge** (short beta x SOL against core when the SOL dial is off). The leveraged leg pays realized Hyperliquid funding in the backtest. Notifies on tactical open/close, crowded positioning, and core-size changes. Parameters live in `P` at the top of the file.

Positioning finding behind the gate: when 7-day funding exceeded ~40%/yr, the next 7 days averaged -22% and the next 30 days -14% (n=15 days); both the late-August and early-October tops carried a funding/premium/volume spike.

`node pump-flows.js --from 2026-07-14 --to 2026-10-20` reconstructs any window by wallet category (exchange / team / ecosystem / LP / unlabeled top-500) alongside fees, SOL, funding and Hyperliquid volume, and lists the largest movers.

## Medium-term regime model

`node pump-regime.js --no-notify` prints the dials, the levels at which each flips, the since-launch SOL-beta decomposition, and the in-sample forward-30d table by state. The rules live in `RULES` at the top of the file. The sample contains roughly two regimes, so treat the table as directional and let `pump-regime-log.json` accumulate.

## Data notes

- `totalSupply` before 2026-10-21 was the *sum of the paginated scan* and drifts by tens of millions per hour. `smoothSupply()` in `pump-signals.js` repairs it (rolling median, then monotone non-increasing). Snapshots from 2026-10-21 carry `chainSupply` and are used as-is.
- `sol-price-history.json`: hourly SOL from CoinGecko, Jul 14 2026 onward. Snapshots from 2026-10-21 also carry `solPrice` directly.
- `perps` (Hyperliquid OI, funding, mark, 24h volume) collection started 2026-10-21. The OI/funding rows in the walk-forward fill in as data accrues.
- Both Actions jobs push to `main`; they `git pull --rebase` before pushing.

## Re-enabling scorer alerts

Set `SCORER_ALERTS: "1"` in `.github/workflows/pump-collect.yml` once `pump-scorecard.js` shows a tier beating the base rate for several weeks running.
