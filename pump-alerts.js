#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════════
//  PUMP Entry Signal Alerts
//  Reads tracker history, computes backtested entry signals,
//  sends notifications when conditions change.
//  Run standalone or chained after pump-tracker.js in cron.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { createTransport } from "nodemailer";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = join(__dirname, "pump-tracker-history.json");
const STATE_FILE = join(__dirname, "pump-alert-state.json");

// ─── Configuration ───
const IS_CI = !!process.env.CI;
const CONFIG = {
  ntfy: {
    enabled: true,
    topic: process.env.NTFY_TOPIC || "pump-entry-signal-wx7k2m",
  },
  macos: {
    enabled: !IS_CI,
  },
  email: {
    enabled: false,  // Set to true after configuring below
    to: "starrwill32@gmail.com",
    from: "starrwill32@gmail.com",
    // Generate an App Password: Google Account → Security → 2-Step Verification → App Passwords
    // Create one for "Mail" on "Mac", paste the 16-char password below
    appPassword: "YOUR_GMAIL_APP_PASSWORD_HERE",
  },
};

// ─── Wallet classifications (from pump-tracker.js) ───
const EXCHANGE_ADDRS = new Set([
  "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM",  // Binance Hot
  "AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2",  // Bybit Hot
  "9SLPTL41SPsYkgdsMzdfJsxymEANKr5bYoBsQzJyKpKS",  // HyperUnit Hot
  "C68a6RCGLiPskbPYtAcsCjhG8tfTWYcoB4JjCrXFdqyo",  // OKX Hot
  "8wM44Ryv9DFCSfkgUnPEPgnsc53arT4cnmXL6LnnC4UW",  // OKX Hot 2
  "7TWnq4WeYcwQWBCwKeEX2Q9xqVtthPGkB7adNvueuVuh",  // Bitget Cold
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9",  // Binance 3
  "6LY1JzAFVZsP2a2xKrtU6znQMQ5h4i7tocWdgrkZzkzF",  // Kraken Hot
  "3B7XAQrLoEMDEGvX8569F9GRb9PcXXocJmj5wvhhei9z",  // BtcTurk Cold
  "EFE3j1pcSP1paUzA86zW7989ZjsFP2J7ginyUqo4ewqR",  // Kraken Cold
  "u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEsynXq2w",   // Gate.io
  "E2RvJg2myWpKcbkhBuF81gfhYr6KvmNcDbSmr5qnatYy",  // Kraken Cold 2
  "5PAhQiYdLBd6SVdjzBQDxUAEFyDdF5ExNPQfcscnPRj5",  // MEXC
  "A77HErqtfN1hLLpvZ9pCtu66FEtM8BveoaKbbMoZ4RiR",  // Bitget Hot
]);

const KRAKEN_LOCKED_ADDRS = new Set([
  "EFE3j1pcSP1paUzA86zW7989ZjsFP2J7ginyUqo4ewqR",
  "E2RvJg2myWpKcbkhBuF81gfhYr6KvmNcDbSmr5qnatYy",
]);

const TEAM_ECO_ADDRS = new Set([
  "Cfq1ts1iFr1eUWWBm8eFxUzm5R3YA3UvMZznwiShbgZt",
  "8UhbNoBXmGoxJr2TeWW8wmSMoWmjS2rTT2tVJxzuTogC",
  "9pkFKCR1mdS31JxjKdtmWg2awZUg6vJUYVY722DAcXzv",
  "85WTujfJ9meJq5hfjAeb5gftj7n8Q7QTsZJbRqMD5ERS",
  "BBvQteuawKB2UtExfevL8HYLjWWsgmWXsp922vFbvCfT",
  "GTeSSwovPiVirpvWJpThUWiLDSLsuApmJw621Yom3MhB",
  "AvqFxKNrYZNvxsj2oWhLW8det68HzCXBqswshoD2TdT6",
  "96HiV4cGWTJNCjGVff3RTHgPXmpYz7MSrGTAmxNKVWM9",
  "9UcygiamY92yGntGkUkBKi4SdApxkBMZd9QSo6wMC2dN",
  "EuH2wD3rkVp5uosoL8v5kRTMLT5L6jvbwXAXRSEwzdwG",
]);

const LP_ADDR = "2uF4Xh61rDwxnG9woyxsVQP7zuA6kLFpb3NvnRQeoiSd";
const ORIGINAL_SUPPLY = 1_000_000_000_000;
const LOCKED_IN_EXCHANGES = 9_300_000_000;

// ─── SOL market regime ───

async function fetchSOLRegime() {
  try {
    const resp = await fetch(
      "https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=7&interval=daily"
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const prices = data.prices;
    if (!prices || prices.length < 2) return null;
    const priceNow = prices[prices.length - 1][1];
    const price7dAgo = prices[0][1];
    const change7d = ((priceNow - price7dAgo) / price7dAgo) * 100;
    let regime;
    if (change7d > 5) regime = "BULL";
    else if (change7d < -5) regime = "BEAR";
    else regime = "NEUTRAL";
    return { price: priceNow, price7dAgo, change7d, regime };
  } catch (e) {
    console.error("  SOL regime fetch failed:", e.message);
    return null;
  }
}

// ─── Fear & Greed Index (contrarian: r=-0.301, #2 predictor) ───

async function fetchFNG() {
  try {
    const resp = await fetch("https://api.alternative.me/fng/?limit=1&format=json");
    if (!resp.ok) return null;
    const data = await resp.json();
    const entry = data.data?.[0];
    if (!entry) return null;
    return { value: parseInt(entry.value), classification: entry.value_classification };
  } catch (e) {
    console.error("  FNG fetch failed:", e.message);
    return null;
  }
}

// ─── BTC price (for BTC-SOL spread — 0% WR when BTC > SOL by >3pp) ───

async function fetchBTCChange() {
  try {
    const resp = await fetch(
      "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7&interval=daily"
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const prices = data.prices;
    if (!prices || prices.length < 2) return null;
    const priceNow = prices[prices.length - 1][1];
    const price7dAgo = prices[0][1];
    const change7d = ((priceNow - price7dAgo) / price7dAgo) * 100;
    return { price: priceNow, change7d };
  } catch (e) {
    console.error("  BTC fetch failed:", e.message);
    return null;
  }
}

// ─── Signal computation ───

function getHolderBalance(snap, addrSet) {
  return snap.holders.filter(h => addrSet.has(h.addr)).reduce((s, h) => s + h.balance, 0);
}

function getAddrBalance(snap, addr) {
  const h = snap.holders.find(h => h.addr === addr);
  return h ? h.balance : 0;
}

function findSnapshotAtOffset(snapshots, fromIdx, hoursBack) {
  const targetTime = new Date(snapshots[fromIdx].timestamp).getTime() - hoursBack * 3600000;
  let best = null, bestDist = Infinity;
  for (let j = fromIdx - 1; j >= 0; j--) {
    const dist = Math.abs(new Date(snapshots[j].timestamp).getTime() - targetTime);
    if (dist < bestDist) { bestDist = dist; best = j; }
    if (new Date(snapshots[j].timestamp).getTime() < targetTime - hoursBack * 1800000) break;
  }
  if (best === null || bestDist > hoursBack * 3600000 * 0.5) return null;
  return best;
}

function deduplicateSnapshots(raw, minGapHours = 1) {
  if (raw.length === 0) return [];
  const out = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const gap = (new Date(raw[i].timestamp) - new Date(out[out.length - 1].timestamp)) / 3600000;
    if (gap >= minGapHours) out.push(raw[i]);
  }
  return out;
}

function computeEntrySignals(snapshots) {
  if (snapshots.length < 3) return null;

  const latest = snapshots[snapshots.length - 1];
  const prev = snapshots[snapshots.length - 2];
  const latestIdx = snapshots.length - 1;

  // Find snapshots at various offsets
  const idx24h = findSnapshotAtOffset(snapshots, latestIdx, 24);
  const idx7d = findSnapshotAtOffset(snapshots, latestIdx, 168);
  const idx3d = findSnapshotAtOffset(snapshots, latestIdx, 72);

  const snap7d = idx7d !== null ? snapshots[idx7d] : null;
  const snap3d = idx3d !== null ? snapshots[idx3d] : null;

  // Current values
  const price = latest.price;
  const exchBalance = getHolderBalance(latest, EXCHANGE_ADDRS);
  const krakenLocked = getHolderBalance(latest, KRAKEN_LOCKED_ADDRS);
  const lpBalance = getAddrBalance(latest, LP_ADDR);
  const teamEcoBalance = getHolderBalance(latest, TEAM_ECO_ADDRS);
  const burned = ORIGINAL_SUPPLY - latest.totalSupply;
  const circSupply = latest.totalSupply - teamEcoBalance - LOCKED_IN_EXCHANGES;
  const circMC = circSupply * price;

  // Burn rate (24h rolling window — single hourly intervals are too noisy)
  const snap24h = idx24h !== null ? snapshots[idx24h] : null;
  const timeDelta24h = snap24h ? (new Date(latest.timestamp) - new Date(snap24h.timestamp)) / 86400000 : 0;
  const burnDelta24h = snap24h ? snap24h.totalSupply - latest.totalSupply : 0;
  const burnRatePerDay = timeDelta24h > 0.5 && burnDelta24h > 0 ? burnDelta24h / timeDelta24h : null;
  const buybackDollarRate = burnRatePerDay ? burnRatePerDay * price : null;
  const buybackYield = buybackDollarRate ? (buybackDollarRate * 365 / circMC) * 100 : null;

  // Holder growth
  const holderTimeDelta = (new Date(latest.timestamp) - new Date(prev.timestamp)) / 86400000;
  const holderGrowthPerDay = holderTimeDelta > 0.04 ? (latest.uniqueOwners - prev.uniqueOwners) / holderTimeDelta : null;

  const signals = { price, timestamp: latest.timestamp, holders: latest.uniqueOwners };

  // ── 7-day signals ──
  if (snap7d) {
    const exch7d = getHolderBalance(snap7d, EXCHANGE_ADDRS);
    const krakenLocked7d = getHolderBalance(snap7d, KRAKEN_LOCKED_ADDRS);
    const lp7d = getAddrBalance(snap7d, LP_ADDR);
    const top20Now = latest.holders.slice(0, 20).reduce((s, h) => s + h.balance, 0) / latest.totalSupply * 100;
    const top20_7d = snap7d.holders.slice(0, 20).reduce((s, h) => s + h.balance, 0) / snap7d.totalSupply * 100;

    // Exchange flow (7d cumulative)
    const exchFlow7d = exchBalance - exch7d;
    const krakenLockedDelta = krakenLocked - krakenLocked7d;
    const organicExchFlow7d = exchFlow7d - krakenLockedDelta;

    // Price return
    const priceReturn7d = (price - snap7d.price) / snap7d.price * 100;

    // LP trend
    const lpDelta7d = lpBalance - lp7d;
    const lpIncreasing = lpDelta7d > 0;

    // Revenue trend
    const timeDelta7d = (new Date(latest.timestamp) - new Date(snap7d.timestamp)) / 86400000;
    const burnDelta7d = snap7d.totalSupply - latest.totalSupply;
    const buybackRate7d = timeDelta7d > 0.5 && burnDelta7d > 0 ? (burnDelta7d / timeDelta7d) * snap7d.price : null;
    const revenueAccelerating = buybackDollarRate && buybackRate7d && buybackRate7d > 0 ? buybackDollarRate > buybackRate7d * 1.1 : null;

    // Yield trend
    const teamEco7d = getHolderBalance(snap7d, TEAM_ECO_ADDRS);
    const circSupply7d = snap7d.totalSupply - teamEco7d - LOCKED_IN_EXCHANGES;
    const circMC7d = circSupply7d * snap7d.price;
    const yield7d = buybackRate7d ? (buybackRate7d * 365 / circMC7d) * 100 : null;
    const yieldExpanding = buybackYield && yield7d && yield7d > 0 ? buybackYield > yield7d * 1.1 : null;

    // Holder growth 7d ago
    const prevOf7d = idx7d > 0 ? snapshots[idx7d - 1] : null;
    let holderGrowth7dAgo = null;
    if (prevOf7d) {
      const dt = (new Date(snap7d.timestamp) - new Date(prevOf7d.timestamp)) / 86400000;
      if (dt > 0.04) holderGrowth7dAgo = (snap7d.uniqueOwners - prevOf7d.uniqueOwners) / dt;
    }

    // Top 20 trend
    const top20Trend7d = top20Now - top20_7d;

    // Momentum divergence: price rising + exchange inflow
    const momentumDivergence = priceReturn7d > 0 && organicExchFlow7d > 0;

    signals.organicExchFlow7d = organicExchFlow7d;
    signals.priceReturn7d = priceReturn7d;
    signals.lpIncreasing = lpIncreasing;
    signals.lpDelta7d = lpDelta7d;
    signals.revenueAccelerating = revenueAccelerating;
    signals.yieldExpanding = yieldExpanding;
    signals.top20Trend7d = top20Trend7d;
    signals.momentumDivergence = momentumDivergence;
    signals.buybackYield = buybackYield;
    signals.buybackDollarRate = buybackDollarRate;
    signals.holderGrowthPerDay = holderGrowthPerDay;
    signals.holderGrowth7dAgo = holderGrowth7dAgo;
  }

  // 3-day price return (for momentum confirmation filter)
  if (snap3d && snap3d.price) {
    signals.priceReturn3d = (price - snap3d.price) / snap3d.price * 100;
  }

  // ── Dip & confluence signals ──
  // Mean reversion: 3d dips < -5% have 100% WR, +12.3% avg fwd 24h when combined with outflow
  const isDip = signals.priceReturn3d !== undefined && signals.priceReturn3d < -5;
  const isDeepDip = signals.priceReturn3d !== undefined && signals.priceReturn3d < -8;
  const priceDropping = prev.price >= latest.price;
  const isApproachingDip = signals.priceReturn3d !== undefined && signals.priceReturn3d >= -5 && signals.priceReturn3d < -3 && priceDropping;
  const hasOutflow = signals.organicExchFlow7d !== undefined && signals.organicExchFlow7d < -500_000_000;
  const isDanger = !!signals.momentumDivergence;

  signals.isDip = isDip;
  signals.isDeepDip = isDeepDip;
  signals.isApproachingDip = isApproachingDip;
  signals.dipConfluence = isDip && hasOutflow && !isDanger;
  signals.dipOnly = isDip && !hasOutflow && !isDanger;
  signals.dipBlocked = isDip && isDanger;

  // Confluence readiness: track how many conditions are met/approaching
  const confluenceConditions = [];
  if (isDip) confluenceConditions.push({ name: "3d dip < -5%", status: "MET", value: `${signals.priceReturn3d.toFixed(1)}%` });
  else if (isApproachingDip) confluenceConditions.push({ name: "3d dip < -5%", status: "APPROACHING", value: `${signals.priceReturn3d.toFixed(1)}% (need < -5%)` });
  else confluenceConditions.push({ name: "3d dip < -5%", status: "NOT MET", value: signals.priceReturn3d !== undefined ? `${signals.priceReturn3d > 0 ? '+' : ''}${signals.priceReturn3d.toFixed(1)}%` : "n/a" });

  if (hasOutflow) confluenceConditions.push({ name: "Exchange outflow", status: "MET", value: `${(signals.organicExchFlow7d / 1e9).toFixed(1)}B` });
  else if (signals.organicExchFlow7d !== undefined && signals.organicExchFlow7d < 0) confluenceConditions.push({ name: "Exchange outflow", status: "APPROACHING", value: `${(signals.organicExchFlow7d / 1e9).toFixed(2)}B (need < -0.5B)` });
  else confluenceConditions.push({ name: "Exchange outflow", status: "NOT MET", value: signals.organicExchFlow7d !== undefined ? `${(signals.organicExchFlow7d / 1e9).toFixed(2)}B (inflow)` : "n/a" });

  if (!isDanger) confluenceConditions.push({ name: "No divergence", status: "MET", value: "safe" });
  else confluenceConditions.push({ name: "No divergence", status: "BLOCKED", value: `price +${signals.priceReturn7d?.toFixed(1)}% + exch inflow` });

  signals.confluenceConditions = confluenceConditions;
  signals.confluenceMet = confluenceConditions.filter(c => c.status === "MET").length;
  signals.confluenceTotal = confluenceConditions.length;

  return signals;
}

function computeEntryScore(signals, solRegime, fng, btcData) {
  if (!signals || signals.organicExchFlow7d === undefined) {
    return { score: 0, tier: "INSUFFICIENT DATA", components: [], dangers: [] };
  }

  const components = [];
  const dangers = [];
  let score = 0;

  // ALL scoring uses structural (price-independent) signals only.
  // No absolute price, holder count, or exchange balance levels.
  // These signals work at $0.005 or $0.05.

  // ── Positive signals (all structural: flows, rates, deltas) ──

  // Exchange organic outflow (strongest signal: ρ=-0.66, 76% win rate)
  if (signals.organicExchFlow7d < -500_000_000) {
    components.push({ name: "Exchange outflow > 500M (7d) [flow]", pts: 20, value: `${(signals.organicExchFlow7d / 1e9).toFixed(1)}B` });
    score += 20;
  }
  if (signals.organicExchFlow7d < -1_000_000_000) {
    components.push({ name: "Exchange outflow > 1B (7d) [flow]", pts: 10, value: `${(signals.organicExchFlow7d / 1e9).toFixed(1)}B` });
    score += 10;
  }

  // Revenue accelerating (combo signal: 73% win rate)
  if (signals.revenueAccelerating) {
    components.push({ name: "Revenue accelerating vs 7d ago [revenue]", pts: 15, value: `$${(signals.buybackDollarRate / 1e6).toFixed(2)}M/day` });
    score += 15;
  }

  // LP depth increasing (#2 signal: 77% win rate)
  if (signals.lpIncreasing) {
    components.push({ name: "LP depth increasing [structure]", pts: 15, value: `+${(signals.lpDelta7d / 1e6).toFixed(0)}M` });
    score += 15;
  }

  // Yield expanding (rate of change, not level — works at any price)
  if (signals.yieldExpanding) {
    components.push({ name: "Yield expanding vs 7d ago [yield delta]", pts: 15, value: `${signals.buybackYield?.toFixed(1)}%` });
    score += 15;
  }

  // 7-day momentum positive (regime qualifier — rate, not level)
  if (signals.priceReturn7d > 0 && signals.priceReturn7d <= 40) {
    components.push({ name: "7d return positive & not overextended [momentum]", pts: 10, value: `+${signals.priceReturn7d.toFixed(1)}%` });
    score += 10;
  }

  // Top 20 distributing (ρ=-0.71 — strongest structural correlation)
  if (signals.top20Trend7d < -0.5) {
    components.push({ name: "Top 20 distributing (7d) [structure]", pts: 10, value: `${signals.top20Trend7d.toFixed(2)}pp` });
    score += 10;
  }

  // SOL macro regime (dominant factor — backtest: regime overrides on-chain signals)
  if (solRegime) {
    if (solRegime.regime === "BULL") {
      components.push({ name: "SOL BULL regime (7d > +5%) [macro]", pts: 15, value: `SOL ${solRegime.change7d > 0 ? "+" : ""}${solRegime.change7d.toFixed(1)}%` });
      score += 15;
    } else if (solRegime.change7d > 3) {
      components.push({ name: "SOL uptrend (7d > +3%) [macro]", pts: 10, value: `SOL +${solRegime.change7d.toFixed(1)}%` });
      score += 10;
    }
  }

  // Fear & Greed contrarian (r=-0.301 — #2 predictor; FNG 20-35: 95% WR, +13.2% avg)
  if (fng) {
    if (fng.value < 30) {
      components.push({ name: "Extreme Fear (<30) — contrarian buy [macro]", pts: 20, value: `FNG ${fng.value}` });
      score += 20;
    } else if (fng.value < 45) {
      components.push({ name: "Fear zone (30-45) — contrarian buy [macro]", pts: 10, value: `FNG ${fng.value}` });
      score += 10;
    }
  }

  // BTC-SOL spread: SOL outperforming BTC by >3pp = risk-on environment
  if (btcData && solRegime) {
    const spread = btcData.change7d - solRegime.change7d;
    if (spread < -3) {
      components.push({ name: "SOL outperforming BTC >3pp — risk-on [macro]", pts: 10, value: `spread ${spread.toFixed(1)}pp` });
      score += 10;
    }
  }

  // ── Danger signals (deductions — all structural) ──

  // Momentum divergence (11% win rate = BLOCK)
  if (signals.momentumDivergence) {
    dangers.push({ name: "MOMENTUM DIVERGENCE — price up + exchange inflow", pts: -50, value: `7d ret: +${signals.priceReturn7d.toFixed(1)}%, exch flow: +${(signals.organicExchFlow7d / 1e9).toFixed(1)}B` });
    score -= 50;
  }

  // Overextended (7d return > 40%, mean reversion kicks in: 20% win rate)
  if (signals.priceReturn7d > 40) {
    dangers.push({ name: "Overextended — 7d return > 40% (mean reversion)", pts: -25, value: `+${signals.priceReturn7d.toFixed(1)}%` });
    score -= 25;
  }

  // Exchange organic inflow (not just absence of outflow — active inflow)
  if (signals.organicExchFlow7d > 500_000_000) {
    dangers.push({ name: "Exchange organic inflow > 500M (7d)", pts: -20, value: `+${(signals.organicExchFlow7d / 1e9).toFixed(1)}B` });
    score -= 20;
  }

  // 3d momentum confirmation — avoid dead cat bounces
  // Winners had 3d return > +5% (momentum) or < -5% (true dip). The -12% loser entered at +2.6%.
  if (signals.priceReturn3d !== undefined && signals.priceReturn3d > -5 && signals.priceReturn3d < 5) {
    dangers.push({ name: "Weak 3d momentum (dead cat zone: -5% to +5%)", pts: -15, value: `${signals.priceReturn3d > 0 ? '+' : ''}${signals.priceReturn3d.toFixed(1)}%` });
    score -= 15;
  }

  // Mean reversion dip: 3d return < -5% = buyback floor creates snapback
  // DIP + OUTFLOW: +12.3% avg fwd24h, 100% WR (n=6)
  // DIP alone: +11.8% avg, 100% WR (n=3)
  // DIP + DANGER: -3.4% avg, 25% WR — divergence kills it
  if (signals.isDip && !signals.momentumDivergence) {
    components.push({ name: "Mean reversion dip (3d < -5%) [dip]", pts: 20, value: `${signals.priceReturn3d.toFixed(1)}%` });
    score += 20;
  }
  if (signals.isDeepDip && !signals.momentumDivergence) {
    components.push({ name: "Deep dip bonus (3d < -8%) [dip]", pts: 10, value: `${signals.priceReturn3d.toFixed(1)}%` });
    score += 10;
  }
  if (signals.dipConfluence) {
    components.push({ name: "DIP + OUTFLOW confluence [dip+flow]", pts: 15, value: `dip ${signals.priceReturn3d.toFixed(1)}% + outflow ${(signals.organicExchFlow7d / 1e9).toFixed(1)}B` });
    score += 15;
  }

  // SOL BEAR — on-chain signals fail in bear markets (backtest: -5.1% avg, 33% WR)
  if (solRegime?.regime === "BEAR") {
    dangers.push({ name: "SOL BEAR regime (7d < -5%) — signals unreliable", pts: -35, value: `SOL ${solRegime.change7d.toFixed(1)}%` });
    score -= 35;
  }

  // FNG Greed zone — historically worst entry zone (15% WR, -7.8% avg)
  if (fng && fng.value >= 56 && fng.value <= 75) {
    dangers.push({ name: "FNG Greed zone (56-75) — worst PUMP entry zone", pts: -20, value: `FNG ${fng.value} (${fng.classification})` });
    score -= 20;
  }

  // BTC outperforming SOL by >3pp — risk-off rotation (0% WR, -17.6% avg, n=7)
  if (btcData && solRegime) {
    const spread = btcData.change7d - solRegime.change7d;
    if (spread > 3) {
      dangers.push({ name: "BTC > SOL by >3pp — risk-off rotation (0% WR)", pts: -30, value: `spread +${spread.toFixed(1)}pp` });
      score -= 30;
    }
  }

  score = Math.max(0, Math.min(100, score));

  let tier;
  if (signals.momentumDivergence) tier = "DANGER";
  else if (score >= 70) tier = "STRONG ENTRY";
  else if (score >= 50) tier = "GOOD ENTRY";
  else if (score >= 30) tier = "NEUTRAL";
  else tier = "AVOID";

  let regimeWarning = null;
  if (solRegime?.regime === "BEAR" && tier !== "DANGER" && tier !== "AVOID") {
    regimeWarning = `SOL BEAR (${solRegime.change7d.toFixed(1)}%) — entry blocked until regime flips`;
    if (tier === "STRONG ENTRY" || tier === "GOOD ENTRY") tier = "NEUTRAL";
  }

  return { score, tier, components, dangers, regimeWarning };
}

// ─── Notification dispatch ───

async function notifyMacOS(title, message) {
  if (!CONFIG.macos.enabled) return;
  try {
    const escaped = message.replace(/"/g, '\\"').replace(/\n/g, "\\n");
    const titleEsc = title.replace(/"/g, '\\"');
    execSync(`osascript -e 'display notification "${escaped}" with title "${titleEsc}"'`);
  } catch (e) {
    console.error("  macOS notification failed:", e.message);
  }
}

async function notifyNtfy(title, message, priority = 3) {
  if (!CONFIG.ntfy.enabled) return;
  try {
    const tags = priority >= 4 ? "rotating_light" : priority >= 3 ? "chart_with_upwards_trend" : "eyes";
    const sanitize = s => s.replace(/[^\x20-\x7E]/g, c => ({ "—": "--", "–": "-", "‘": "'", "’": "'", "“": '"', "”": '"' }[c] || ""));
    const resp = await fetch(`https://ntfy.sh/${CONFIG.ntfy.topic}`, {
      method: "POST",
      headers: {
        "Title": sanitize(title),
        "Priority": String(priority),
        "Tags": tags,
      },
      body: sanitize(message),
    });
    if (!resp.ok) console.error("  ntfy failed:", resp.status, await resp.text());
  } catch (e) {
    console.error("  ntfy failed:", e.message);
  }
}

async function notifyEmail(subject, body) {
  if (!CONFIG.email.enabled || CONFIG.email.appPassword === "YOUR_GMAIL_APP_PASSWORD_HERE") return;
  try {
    const transport = createTransport({
      service: "gmail",
      auth: {
        user: CONFIG.email.from,
        pass: CONFIG.email.appPassword,
      },
    });
    await transport.sendMail({
      from: CONFIG.email.from,
      to: CONFIG.email.to,
      subject,
      text: body,
    });
  } catch (e) {
    console.error("  Email failed:", e.message);
  }
}

async function sendAlert(title, message, priority = 3) {
  console.log(`\n  ALERT: ${title}`);
  console.log(`  ${message}\n`);
  await Promise.all([
    notifyMacOS(title, message),
    notifyNtfy(title, message, priority),
    notifyEmail(`PUMP: ${title}`, message),
  ]);
}

// ─── State management ───

function loadState() {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {}
  return { lastTier: null, lastScore: 0, lastAlertTime: null, lastAlertTier: null };
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── Main ───

async function main() {
  const BOLD = "\x1b[1m";
  const RESET = "\x1b[0m";
  const GREEN = "\x1b[32m";
  const RED = "\x1b[31m";
  const YELLOW = "\x1b[33m";
  const CYAN = "\x1b[36m";
  const DIM = "\x1b[2m";

  console.log(`${BOLD}═══════════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  PUMP Entry Signal Monitor${RESET}  —  ${new Date().toISOString()}`);
  console.log(`${BOLD}═══════════════════════════════════════════════════════════════════${RESET}`);

  // Load and deduplicate history
  let raw;
  try {
    raw = JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));
  } catch (e) {
    console.error("Cannot read history:", e.message);
    process.exit(1);
  }

  const snapshots = deduplicateSnapshots(raw, 1);
  console.log(`  ${DIM}${raw.length} raw snapshots → ${snapshots.length} deduplicated (≥1h gap)${RESET}`);

  if (snapshots.length < 5) {
    console.log("  Not enough data for signal computation. Need at least 5 hourly snapshots.");
    process.exit(0);
  }

  // Compute signals
  const signals = computeEntrySignals(snapshots);
  if (!signals) {
    console.log("  Could not compute signals.");
    process.exit(0);
  }

  // Fetch macro signals in parallel
  const [solRegime, fng, btcData] = await Promise.all([
    fetchSOLRegime(),
    fetchFNG(),
    fetchBTCChange(),
  ]);

  // Compute score (regime + macro aware)
  const { score, tier, components, dangers, regimeWarning } = computeEntryScore(signals, solRegime, fng, btcData);

  // Display
  const tierColor = tier === "STRONG ENTRY" ? GREEN :
                    tier === "GOOD ENTRY" ? GREEN :
                    tier === "DANGER" ? RED :
                    tier === "AVOID" ? RED :
                    YELLOW;

  console.log(`\n  ${BOLD}Price:${RESET}   $${signals.price.toFixed(6)}`);
  console.log(`  ${BOLD}Holders:${RESET} ${signals.holders.toLocaleString()}`);
  if (signals.buybackYield) console.log(`  ${BOLD}Yield:${RESET}   ${signals.buybackYield.toFixed(1)}%`);
  if (signals.buybackDollarRate) console.log(`  ${BOLD}Revenue:${RESET} $${(signals.buybackDollarRate / 1e6).toFixed(2)}M/day`);
  if (solRegime) {
    const regColor = solRegime.regime === "BULL" ? GREEN : solRegime.regime === "BEAR" ? RED : YELLOW;
    console.log(`  ${BOLD}SOL:${RESET}     $${solRegime.price.toFixed(2)} ${regColor}(7d: ${solRegime.change7d > 0 ? "+" : ""}${solRegime.change7d.toFixed(1)}% — ${solRegime.regime})${RESET}`);
  } else {
    console.log(`  ${BOLD}SOL:${RESET}     ${DIM}(fetch failed — regime not scored)${RESET}`);
  }
  if (fng) {
    const fngColor = fng.value < 30 ? GREEN : fng.value < 46 ? YELLOW : fng.value <= 75 ? RED : DIM;
    console.log(`  ${BOLD}FNG:${RESET}     ${fngColor}${fng.value} (${fng.classification})${RESET}`);
  }
  if (btcData) {
    console.log(`  ${BOLD}BTC:${RESET}     $${Math.round(btcData.price).toLocaleString()} (7d: ${btcData.change7d > 0 ? "+" : ""}${btcData.change7d.toFixed(1)}%)`);
    if (solRegime) {
      const spread = btcData.change7d - solRegime.change7d;
      const spreadColor = spread > 3 ? RED : spread < -3 ? GREEN : DIM;
      console.log(`  ${BOLD}Spread:${RESET}  ${spreadColor}BTC-SOL: ${spread > 0 ? "+" : ""}${spread.toFixed(1)}pp${spread > 3 ? " [RISK-OFF]" : spread < -3 ? " [RISK-ON]" : ""}${RESET}`);
    }
  }

  console.log(`\n  ${BOLD}Entry Score: ${tierColor}${score}/100 — ${tier}${RESET}`);
  if (regimeWarning) console.log(`  ${RED}>>> ${regimeWarning} <<<${RESET}`);

  if (components.length > 0) {
    console.log(`\n  ${BOLD}Active signals:${RESET}`);
    for (const c of components) {
      console.log(`    ${GREEN}+${c.pts}${RESET}  ${c.name} ${DIM}(${c.value})${RESET}`);
    }
  }

  if (dangers.length > 0) {
    console.log(`\n  ${BOLD}Danger signals:${RESET}`);
    for (const d of dangers) {
      console.log(`    ${RED}${d.pts}${RESET}  ${d.name} ${DIM}(${d.value})${RESET}`);
    }
  }

  // Key metrics
  console.log(`\n  ${BOLD}Key metrics:${RESET}`);
  if (signals.organicExchFlow7d !== undefined) {
    const flowDir = signals.organicExchFlow7d < 0 ? GREEN : RED;
    console.log(`    Exchange organic flow (7d): ${flowDir}${(signals.organicExchFlow7d / 1e9).toFixed(2)}B${RESET}`);
  }
  if (signals.priceReturn7d !== undefined) {
    const retColor = signals.priceReturn7d > 0 ? GREEN : RED;
    console.log(`    7d price return: ${retColor}${signals.priceReturn7d > 0 ? "+" : ""}${signals.priceReturn7d.toFixed(1)}%${RESET}`);
  }
  if (signals.top20Trend7d !== undefined) {
    console.log(`    Top 20 trend (7d): ${signals.top20Trend7d > 0 ? "+" : ""}${signals.top20Trend7d.toFixed(2)}pp`);
  }
  if (signals.lpIncreasing !== undefined) {
    console.log(`    LP depth: ${signals.lpIncreasing ? GREEN + "increasing" : RED + "decreasing"}${RESET} (${(signals.lpDelta7d / 1e6).toFixed(0)}M)`);
  }
  if (signals.priceReturn3d !== undefined) {
    const r3 = signals.priceReturn3d;
    const label = r3 > 5 ? GREEN + "strong momentum" : r3 < -5 ? YELLOW + "dip (contrarian buy)" : RED + "dead cat zone";
    console.log(`    3d momentum: ${label}${RESET} (${r3 > 0 ? "+" : ""}${r3.toFixed(1)}%)`);
  }

  // Backtested expectations for current regime
  console.log(`\n  ${BOLD}Backtested expectations for current conditions:${RESET}`);
  if (solRegime?.regime === "BEAR") {
    console.log(`    ${RED}SOL BEAR REGIME — on-chain signals unreliable${RESET}`);
    console.log(`    ${RED}Historical BEAR 7d return: -5.1% avg, 33% win rate${RESET}`);
    console.log(`    ${RED}INFLOW + BEAR: -20% avg, 0% WR (n=4)${RESET}`);
    console.log(`    ${YELLOW}Wait for SOL 7d > +3% before entering${RESET}`);
    if (signals.organicExchFlow7d < -500_000_000) {
      console.log(`    ${DIM}On-chain outflow IS active — setup will fire once SOL turns${RESET}`);
    }
    if (signals.isDip) {
      console.log(`    ${DIM}Dip at ${signals.priceReturn3d.toFixed(1)}% — but dip signals untested in BEAR (n=0)${RESET}`);
    }
  } else if (signals.dipConfluence) {
    console.log(`    ${GREEN}DIP + OUTFLOW CONFLUENCE (strongest setup)${RESET}`);
    console.log(`    ${GREEN}Historical fwd 24h: +12.3% avg, 100% win rate (n=6)${RESET}`);
    if (solRegime?.change7d > 3) console.log(`    ${GREEN}SOL uptrend active — best macro for PUMP entries${RESET}`);
    console.log(`    ${GREEN}Sizing: full position $150K at 3x${RESET}`);
  } else if (signals.dipOnly) {
    console.log(`    ${GREEN}DIP ENTRY (mean reversion, no outflow yet)${RESET}`);
    console.log(`    ${GREEN}Historical fwd 24h: +11.8% avg, 100% win rate (n=3)${RESET}`);
    console.log(`    ${YELLOW}Sizing: half position $100K at 2x (single signal)${RESET}`);
  } else if (signals.dipBlocked) {
    console.log(`    ${RED}DIP BLOCKED BY DIVERGENCE${RESET}`);
    console.log(`    ${RED}Historical dip + danger: -3.4% avg, 25% win rate (n=4)${RESET}`);
    console.log(`    ${RED}Mean reversion FAILS during distribution. DO NOT buy this dip.${RESET}`);
  } else if (signals.momentumDivergence) {
    console.log(`    ${RED}MOMENTUM DIVERGENCE REGIME${RESET}`);
    console.log(`    ${RED}Historical 3d return: -6.0% avg, 11% win rate${RESET}`);
    console.log(`    ${RED}DO NOT open leveraged positions${RESET}`);
  } else if (signals.organicExchFlow7d < -1_000_000_000 && signals.priceReturn7d > 0) {
    console.log(`    ${GREEN}OUTFLOW + ${solRegime?.regime || "?"} SOL (best combo)${RESET}`);
    console.log(`    ${GREEN}Historical 7d return: +26-29% avg, 80% win rate${RESET}`);
    console.log(`    ${DIM}Worst historical 3d drawdown: -9.4%${RESET}`);
  } else if (signals.organicExchFlow7d < -500_000_000) {
    console.log(`    ${GREEN}Exchange outflow active + ${solRegime?.regime || "?"} SOL${RESET}`);
    console.log(`    ${GREEN}OUTFLOW + BULL/NEUTRAL: 7d avg +26-29%, 80% WR${RESET}`);
    console.log(`    ${DIM}Worst historical 3d drawdown: -9.4%${RESET}`);
  } else {
    console.log(`    ${YELLOW}Mixed conditions — no strong regime match${RESET}`);
  }
  // Macro overlay
  if (fng) {
    if (fng.value < 30) console.log(`    ${GREEN}EXTREME FEAR (FNG ${fng.value}) — contrarian buy signal active${RESET}`);
    else if (fng.value < 45) console.log(`    ${YELLOW}Fear zone (FNG ${fng.value}) — contrarian favorable${RESET}`);
    else if (fng.value >= 56 && fng.value <= 75) console.log(`    ${RED}GREED ZONE (FNG ${fng.value}) — worst entry window: 15% WR, -7.8% avg${RESET}`);
  }
  if (btcData && solRegime) {
    const spread = btcData.change7d - solRegime.change7d;
    if (spread > 3) console.log(`    ${RED}BTC > SOL by ${spread.toFixed(1)}pp — risk-off rotation: 0% WR, -17.6% avg${RESET}`);
    else if (spread < -3) console.log(`    ${GREEN}SOL > BTC by ${(-spread).toFixed(1)}pp — risk-on environment${RESET}`);
  }

  // ── Confluence tracker — shows how conditions are gearing up ──
  console.log(`\n  ${BOLD}Confluence Tracker:${RESET} ${signals.confluenceMet}/${signals.confluenceTotal} conditions met`);
  for (const c of signals.confluenceConditions) {
    const icon = c.status === "MET" ? GREEN + "[MET]" :
                 c.status === "APPROACHING" ? YELLOW + "[~]  " :
                 c.status === "BLOCKED" ? RED + "[X]  " :
                 RED + "[--] ";
    console.log(`    ${icon}${RESET} ${c.name}: ${c.value}`);
  }
  if (signals.confluenceMet === signals.confluenceTotal) {
    console.log(`    ${GREEN}>>> ALL CONDITIONS MET — CONFLUENCE ACTIVE <<<${RESET}`);
  } else if (signals.confluenceMet >= signals.confluenceTotal - 1 && !signals.momentumDivergence) {
    const missing = signals.confluenceConditions.find(c => c.status !== "MET");
    console.log(`    ${YELLOW}>>> 1 away from confluence — watching: ${missing?.name} <<<${RESET}`);
  }

  // Position sizing guidance
  if (solRegime?.regime === "BEAR" && (signals.dipConfluence || signals.dipOnly || score >= 30)) {
    console.log(`\n  ${BOLD}Position Guidance:${RESET}`);
    console.log(`    ${RED}SOL BEAR — do not enter despite on-chain signals${RESET}`);
    console.log(`    ${YELLOW}Setup: ${signals.dipConfluence ? "DIP + OUTFLOW (strong)" : signals.dipOnly ? "DIP (moderate)" : "building"}${RESET}`);
    console.log(`    ${YELLOW}Enter when SOL 7d flips above +3%${RESET}`);
  } else if (signals.dipConfluence || signals.dipOnly || tier === "GOOD ENTRY" || tier === "STRONG ENTRY") {
    console.log(`\n  ${BOLD}Position Guidance:${RESET}`);
    if (signals.dipConfluence) {
      console.log(`    ${GREEN}DIP + OUTFLOW: $150K at 3x leverage${RESET}`);
      console.log(`    ${DIM}Take profit: 3d return crosses back above +5%${RESET}`);
      console.log(`    ${DIM}Hard stop: 3d return drops below -20%${RESET}`);
      console.log(`    ${DIM}Time stop: 7 days max hold${RESET}`);
    } else if (signals.dipOnly) {
      console.log(`    ${YELLOW}DIP only: $100K at 2x leverage (no outflow confirmation)${RESET}`);
      console.log(`    ${DIM}Take profit: 3d return crosses back above +5%${RESET}`);
      console.log(`    ${DIM}Hard stop: 3d return drops below -20%${RESET}`);
      console.log(`    ${DIM}Time stop: 7 days max hold${RESET}`);
      console.log(`    ${DIM}Upgrade to full size if outflow develops${RESET}`);
    } else if (tier === "STRONG ENTRY") {
      console.log(`    ${GREEN}Structural STRONG: $150K at 3x leverage${RESET}`);
    } else {
      console.log(`    ${YELLOW}Structural GOOD: $100K at 2x leverage${RESET}`);
    }
  }

  // Alert logic
  const state = loadState();
  const now = new Date().toISOString();
  const alerts = []; // collect all alerts, send highest priority

  // Minimum 30 minutes between tier alerts
  const minAlertGap = 30 * 60 * 1000;
  const timeSinceLastAlert = state.lastAlertTime ? Date.now() - new Date(state.lastAlertTime).getTime() : Infinity;
  // Dip alerts use separate cooldown
  const dipCooldown = 4 * 3600000; // 4 hours between dip alerts
  const timeSinceLastDip = state.lastDipAlertTime ? Date.now() - new Date(state.lastDipAlertTime).getTime() : Infinity;

  // ── Dip alerts (independent track, highest priority) ──
  if (timeSinceLastDip > dipCooldown) {
    if (solRegime?.regime === "BEAR" && (signals.dipConfluence || signals.dipOnly) && state.lastDipAlertType !== "bear_waiting") {
      alerts.push({
        title: "DIP SETUP BLOCKED — SOL BEAR",
        message: `Dip ${signals.priceReturn3d.toFixed(1)}% + ${signals.dipConfluence ? "outflow confluence" : "no outflow"} detected, but SOL is BEAR (${solRegime.change7d.toFixed(1)}% 7d). On-chain setup loading — wait for SOL 7d > +3%. Price: $${signals.price.toFixed(6)}.`,
        priority: 3,
        type: "dip",
        dipType: "bear_waiting",
      });
    } else if (signals.dipConfluence && state.lastDipAlertType !== "confluence" && solRegime?.regime !== "BEAR") {
      const solNote = solRegime ? ` SOL: ${solRegime.regime} (${solRegime.change7d > 0 ? "+" : ""}${solRegime.change7d.toFixed(1)}%).` : "";
      alerts.push({
        title: "DIP + OUTFLOW CONFLUENCE",
        message: `3d return: ${signals.priceReturn3d.toFixed(1)}%. Exchange outflow: ${(signals.organicExchFlow7d / 1e9).toFixed(1)}B. Price: $${signals.price.toFixed(6)}.${solNote} Historical: +12.3% avg fwd 24h, 100% WR (n=6). Full position: $150K at 3x. Stop: 3d < -20%. Take profit: 3d > +5%.`,
        priority: 5,
        type: "dip",
        dipType: "confluence",
      });
    } else if (signals.dipOnly && state.lastDipAlertType !== "diponly" && state.lastDipAlertType !== "confluence" && solRegime?.regime !== "BEAR") {
      alerts.push({
        title: "DIP ENTRY -- 3d return " + signals.priceReturn3d.toFixed(1) + "%",
        message: `Buyback-floor mean reversion active. Price: $${signals.price.toFixed(6)}. No exchange outflow yet -- half size: $100K at 2x. Upgrade if outflow develops. Stop: 3d < -20%. Historical dip-only: +11.8% avg, 100% WR (n=3).`,
        priority: 4,
        type: "dip",
        dipType: "diponly",
      });
    } else if (signals.isApproachingDip && !signals.momentumDivergence && !state.lastDipApproachAlert) {
      const outflowStatus = signals.organicExchFlow7d < -500_000_000 ? "OUTFLOW active" :
                            signals.organicExchFlow7d < 0 ? "outflow building" : "no outflow yet";
      alerts.push({
        title: "DIP APPROACHING -- 3d at " + signals.priceReturn3d.toFixed(1) + "%",
        message: `3d return nearing -5% dip threshold. Price: $${signals.price.toFixed(6)}. Exchange flow: ${outflowStatus} (${(signals.organicExchFlow7d / 1e9).toFixed(2)}B). Confluence ${signals.confluenceMet}/${signals.confluenceTotal} met. Watch for entry.`,
        priority: 3,
        type: "dip",
        dipType: "approaching",
      });
    } else if (signals.dipBlocked && state.lastDipAlertType !== "blocked") {
      alerts.push({
        title: "DIP BLOCKED -- Divergence active",
        message: `3d dip at ${signals.priceReturn3d.toFixed(1)}% BUT momentum divergence active (price +${signals.priceReturn7d?.toFixed(1)}% + exchange inflow). DO NOT buy this dip. Historical dip+danger: -3.4% avg, 25% WR. Wait for divergence to clear.`,
        priority: 4,
        type: "dip",
        dipType: "blocked",
      });
    }
  }

  // Clear dip alert state when dip conditions end
  if (!signals.isDip && !signals.isApproachingDip && state.lastDipAlertType) {
    state.lastDipAlertType = null;
    state.lastDipApproachAlert = false;
  }

  // ── Tier alerts (existing, on cooldown) ──
  if (timeSinceLastAlert >= minAlertGap) {
    if (tier === "DANGER" && state.lastAlertTier !== "DANGER") {
      alerts.push({
        title: "DANGER -- Momentum Divergence",
        message: `Price rising (+${signals.priceReturn7d?.toFixed(1)}%) while exchanges receiving inflow (+${(signals.organicExchFlow7d / 1e9).toFixed(1)}B). Historical 3d return: -6.0%, 11% win rate. CLOSE any leveraged positions.`,
        priority: 5,
        type: "tier",
      });
    } else if (tier === "STRONG ENTRY" && state.lastTier !== "STRONG ENTRY") {
      const macroNote = [
        solRegime ? `SOL: ${solRegime.regime} (${solRegime.change7d > 0 ? "+" : ""}${solRegime.change7d.toFixed(1)}%)` : null,
        fng ? `FNG: ${fng.value}` : null,
        btcData && solRegime ? `BTC-SOL: ${(btcData.change7d - solRegime.change7d).toFixed(1)}pp` : null,
      ].filter(Boolean).join(". ");
      alerts.push({
        title: "STRONG ENTRY Signal",
        message: `Score: ${score}/100. Price: $${signals.price.toFixed(4)}. ${macroNote}. Exchange outflow: ${(signals.organicExchFlow7d / 1e9).toFixed(1)}B (7d). Yield: ${signals.buybackYield?.toFixed(1)}%. ${signals.isDip ? "DIP CONFLUENCE ACTIVE." : ""} OUTFLOW + BULL/NEUTRAL SOL: +26-29% avg 7d, 80% WR.`,
        priority: 4,
        type: "tier",
      });
    } else if (tier === "GOOD ENTRY" && (state.lastTier === "NEUTRAL" || state.lastTier === "AVOID" || !state.lastTier)) {
      const macroNote = [
        solRegime ? `SOL: ${solRegime.regime} (${solRegime.change7d > 0 ? "+" : ""}${solRegime.change7d.toFixed(1)}%)` : null,
        fng ? `FNG: ${fng.value}` : null,
        btcData && solRegime ? `BTC-SOL: ${(btcData.change7d - solRegime.change7d).toFixed(1)}pp` : null,
      ].filter(Boolean).join(". ");
      alerts.push({
        title: "GOOD ENTRY Signal",
        message: `Score: ${score}/100. Price: $${signals.price.toFixed(4)}. ${macroNote}. Exchange flow: ${(signals.organicExchFlow7d / 1e9).toFixed(1)}B (7d). Yield: ${signals.buybackYield?.toFixed(1)}%. ${signals.isDip ? "DIP active -- mean reversion in play." : ""}`,
        priority: 3,
        type: "tier",
      });
    } else if ((tier === "AVOID" || tier === "NEUTRAL") && (state.lastAlertTier === "STRONG ENTRY" || state.lastAlertTier === "GOOD ENTRY")) {
      alerts.push({
        title: "Entry Signals Faded",
        message: `Score dropped to ${score}/100 (${tier}). ${dangers.length > 0 ? "Danger: " + dangers.map(d => d.name).join(", ") : "Positive signals weakened."}`,
        priority: 3,
        type: "tier",
      });
    }
  } else {
    console.log(`\n  ${DIM}Tier alert cooldown: ${Math.round(timeSinceLastAlert / 60000)}m ago${RESET}`);
  }

  // Send the highest-priority alert (or all if different types)
  const sentTypes = new Set();
  for (const alert of alerts.sort((a, b) => b.priority - a.priority)) {
    if (sentTypes.has(alert.type)) continue;
    sentTypes.add(alert.type);

    await sendAlert(alert.title, alert.message, alert.priority);

    if (alert.type === "tier") {
      state.lastAlertTime = now;
      state.lastAlertTier = tier;
    }
    if (alert.type === "dip") {
      state.lastDipAlertTime = now;
      state.lastDipAlertType = alert.dipType;
      if (alert.dipType === "approaching") state.lastDipApproachAlert = true;
    }
  }

  if (alerts.length === 0) {
    console.log(`\n  ${DIM}No alert triggered (tier: ${tier}, dip: ${signals.isDip ? "active" : signals.isApproachingDip ? "approaching" : "no"})${RESET}`);
  }

  // ── Holder velocity alert (fast-twitch, independent of tier) ──
  // Detects demand surges that precede price moves by 1-2 hours.
  // Sep 29 case study: +1111 holders/hr (19x baseline) preceded a +15.7% rip.
  if (snapshots.length >= 25) {
    const latest2 = snapshots.slice(-2);
    const dtHrs = (new Date(latest2[1].timestamp) - new Date(latest2[0].timestamp)) / 3600000;
    const holderVelocity = dtHrs > 0.1 ? (latest2[1].uniqueOwners - latest2[0].uniqueOwners) / dtHrs : 0;

    // Trailing 24h baseline
    const trailing24h = snapshots.filter(s => {
      const t = new Date(s.timestamp).getTime();
      const latest = new Date(latest2[1].timestamp).getTime();
      return t >= latest - 24 * 3600000 && t < latest - 3600000;
    });
    let baselineVelocity = 50; // fallback
    if (trailing24h.length >= 3) {
      const totalGrowth = trailing24h[trailing24h.length - 1].uniqueOwners - trailing24h[0].uniqueOwners;
      const totalHrs = (new Date(trailing24h[trailing24h.length - 1].timestamp) - new Date(trailing24h[0].timestamp)) / 3600000;
      if (totalHrs > 1) baselineVelocity = totalGrowth / totalHrs;
    }

    const velocityRatio = baselineVelocity > 0 ? holderVelocity / baselineVelocity : 0;

    console.log(`\n  ${BOLD}Holder Velocity:${RESET}`);
    const velColor = velocityRatio >= 5 ? RED : velocityRatio >= 3 ? YELLOW : DIM;
    console.log(`    Current: ${velColor}${holderVelocity.toFixed(0)}/hr${RESET} (baseline: ${baselineVelocity.toFixed(0)}/hr, ratio: ${velocityRatio.toFixed(1)}x)`);

    const velCooldown = 2 * 3600000; // 2 hour cooldown for velocity alerts
    const lastVelAlert = state.lastVelocityAlertTime ? Date.now() - new Date(state.lastVelocityAlertTime).getTime() : Infinity;

    if (velocityRatio >= 5 && holderVelocity > 200 && lastVelAlert > velCooldown) {
      const velTitle = "DEMAND SURGE -- " + holderVelocity.toFixed(0) + " new holders/hr (" + velocityRatio.toFixed(0) + "x baseline)";
      const velMsg = "Holder velocity spike detected. Price: $" + signals.price.toFixed(6) + ". Historical pattern: holder surges precede price moves by 1-2 hours. Current entry tier: " + tier + " (score " + score + "/100).";
      console.log(`    ${RED}DEMAND SURGE DETECTED${RESET} — ${velocityRatio.toFixed(0)}x baseline`);
      await sendAlert(velTitle, velMsg, 4);
      state.lastVelocityAlertTime = new Date().toISOString();
    } else if (velocityRatio >= 3) {
      console.log(`    ${YELLOW}Elevated — watching${RESET}`);
    }
  }

  state.lastTier = tier;
  state.lastScore = score;
  state.lastCheck = now;
  saveState(state);

  // Notification status
  console.log(`\n  ${BOLD}Notification channels:${RESET}`);
  console.log(`    macOS:  ${CONFIG.macos.enabled ? GREEN + "ON" : RED + "OFF"}${RESET}`);
  console.log(`    ntfy:   ${CONFIG.ntfy.enabled ? GREEN + "ON" + RESET + DIM + ` (topic: ${CONFIG.ntfy.topic})` : RED + "OFF"}${RESET}`);
  console.log(`    Email:  ${CONFIG.email.enabled && CONFIG.email.appPassword !== "YOUR_GMAIL_APP_PASSWORD_HERE" ? GREEN + "ON" : YELLOW + "NEEDS SETUP"}${RESET}`);

  console.log(`\n${BOLD}═══════════════════════════════════════════════════════════════════${RESET}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
