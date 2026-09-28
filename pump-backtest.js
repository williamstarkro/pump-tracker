#!/usr/bin/env node

import fs from "fs";
import path from "path";
import { createRequire } from "module";
const require = createRequire(import.meta.url);
const history = require("./pump-tracker-history.json");

// ─── Constants ───
const ORIGINAL_SUPPLY = 1_000_000_000_000;
const LOCKED_IN_EXCHANGES = 9_300_000_000;

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

const KRAKEN_LOCKED = new Set([
  "EFE3j1pcSP1paUzA86zW7989ZjsFP2J7ginyUqo4ewqR",
  "E2RvJg2myWpKcbkhBuF81gfhYr6KvmNcDbSmr5qnatYy",
]);

const TEAM_ECO_ADDRS = new Set([
  "Cfq1ts1iFr1eUWWBm8eFxUzm5R3YA3UvMZznwiShbgZt",  // Token Custodian
  "8UhbNoBXmGoxJr2TeWW8wmSMoWmjS2rTT2tVJxzuTogC",  // Team (locked)
  "9pkFKCR1mdS31JxjKdtmWg2awZUg6vJUYVY722DAcXzv",  // Team
  "85WTujfJ9meJq5hfjAeb5gftj7n8Q7QTsZJbRqMD5ERS",  // Team
  "BBvQteuawKB2UtExfevL8HYLjWWsgmWXsp922vFbvCfT",  // Ecosystem
  "GTeSSwovPiVirpvWJpThUWiLDSLsuApmJw621Yom3MhB",  // Ecosystem
  "AvqFxKNrYZNvxsj2oWhLW8det68HzCXBqswshoD2TdT6",  // Team
  "96HiV4cGWTJNCjGVff3RTHgPXmpYz7MSrGTAmxNKVWM9",  // Team
  "9UcygiamY92yGntGkUkBKi4SdApxkBMZd9QSo6wMC2dN",  // Team (distributed)
  "EuH2wD3rkVp5uosoL8v5kRTMLT5L6jvbwXAXRSEwzdwG",  // Investor (locked)
]);

const LP_ADDR = "2uF4Xh61rDwxnG9woyxsVQP7zuA6kLFpb3NvnRQeoiSd";

// ─── Colors ───
const R = "\x1b[0m", B = "\x1b[1m", DIM = "\x1b[2m";
const RED = "\x1b[31m", GRN = "\x1b[32m", YEL = "\x1b[33m", CYN = "\x1b[36m", MAG = "\x1b[35m";

// ─── Helpers ───
function median(arr) {
  if (!arr.length) return NaN;
  const s = [...arr].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

function mean(arr) {
  if (!arr.length) return NaN;
  return arr.reduce((s, v) => s + v, 0) / arr.length;
}

function spearman(x, y) {
  const n = x.length;
  if (n < 5) return { rho: NaN, p: 1, n: 0 };
  const rank = (arr) => {
    const indexed = arr.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
    const ranks = new Array(n);
    for (let i = 0; i < n;) {
      let j = i;
      while (j < n && indexed[j].v === indexed[i].v) j++;
      const avgRank = (i + j - 1) / 2 + 1;
      for (let k = i; k < j; k++) ranks[indexed[k].i] = avgRank;
      i = j;
    }
    return ranks;
  };
  const rx = rank(x), ry = rank(y);
  const d2 = rx.reduce((s, _, i) => s + (rx[i] - ry[i]) ** 2, 0);
  const rho = 1 - (6 * d2) / (n * (n * n - 1));
  // t-approximation for p-value
  const t = rho * Math.sqrt((n - 2) / (1 - rho * rho + 1e-15));
  const df = n - 2;
  // Approximate two-tailed p-value using t-distribution
  const p = approxTwoTailP(Math.abs(t), df);
  return { rho, p, n };
}

function approxTwoTailP(t, df) {
  // Rough approximation using normal for large df
  if (df > 30) {
    const z = t;
    return 2 * (1 - normalCDF(z));
  }
  // For small df, use a cruder approximation
  const x = df / (df + t * t);
  return x < 0.5 ? 1.0 : Math.max(0.001, x);
}

function normalCDF(z) {
  const a1 = 0.254829592, a2 = -0.284496736, a3 = 1.421413741;
  const a4 = -1.453152027, a5 = 1.061405429, p = 0.3275911;
  const sign = z < 0 ? -1 : 1;
  z = Math.abs(z) / Math.SQRT2;
  const t = 1.0 / (1.0 + p * z);
  const y = 1.0 - (((((a5 * t + a4) * t) + a3) * t + a2) * t + a1) * t * Math.exp(-z * z);
  return 0.5 * (1.0 + sign * y);
}

// ─── Step 1: Deduplicate burst runs ───
// Keep only snapshots with >= 1 hour gap from previous
function deduplicateSnapshots(raw) {
  const MIN_GAP_MS = 3600 * 1000; // 1 hour
  const result = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const prev = new Date(result[result.length - 1].timestamp).getTime();
    const curr = new Date(raw[i].timestamp).getTime();
    if (curr - prev >= MIN_GAP_MS) {
      result.push(raw[i]);
    } else {
      // Replace with the later snapshot (more recent data)
      result[result.length - 1] = raw[i];
    }
  }
  return result;
}

// ─── Step 2: Compute per-snapshot signals ───
function holderBalance(snap, addrSet) {
  let total = 0;
  for (const h of snap.holders) {
    if (addrSet.has(h.addr)) total += h.balance;
  }
  return total;
}

function computeSignals(snapshots) {
  const signals = [];

  for (let i = 0; i < snapshots.length; i++) {
    const snap = snapshots[i];
    const prev = i > 0 ? snapshots[i - 1] : null;
    const ts = new Date(snap.timestamp).getTime();
    const prevTs = prev ? new Date(prev.timestamp).getTime() : ts;
    const timeDeltaDays = (ts - prevTs) / (86400 * 1000);

    const price = snap.price;
    const burned = ORIGINAL_SUPPLY - snap.totalSupply;
    const burnedPct = (burned / ORIGINAL_SUPPLY) * 100;

    // Team/eco balance in this snapshot
    const teamEcoBalance = holderBalance(snap, TEAM_ECO_ADDRS);
    const circSupply = snap.totalSupply - teamEcoBalance - LOCKED_IN_EXCHANGES;
    const circMC = circSupply * price;

    // Exchange balances
    const exchBalance = holderBalance(snap, EXCHANGE_ADDRS);
    const krakenLocked = holderBalance(snap, KRAKEN_LOCKED);

    // LP balance
    const lpH = snap.holders.find(h => h.addr === LP_ADDR);
    const lpBalance = lpH ? lpH.balance : 0;

    // Top N concentration
    const sortedByBalance = [...snap.holders].sort((a, b) => b.balance - a.balance);
    const top10Pct = sortedByBalance.slice(0, 10).reduce((s, h) => s + h.balance, 0) / snap.totalSupply * 100;
    const top20Pct = sortedByBalance.slice(0, 20).reduce((s, h) => s + h.balance, 0) / snap.totalSupply * 100;

    // Float estimate
    const floatPct = (snap.totalSupply - teamEcoBalance - LOCKED_IN_EXCHANGES) / snap.totalSupply * 100;

    // Deltas (require previous snapshot and meaningful time gap)
    let burnRatePerDay = NaN, buybackDollarRate = NaN, buybackYield = NaN;
    let holderGrowthPerDay = NaN, exchFlow = NaN, organicExchFlow = NaN;
    let top10Delta = NaN, lpDelta = NaN;

    if (prev && timeDeltaDays > 0.04) {
      burnRatePerDay = (prev.totalSupply - snap.totalSupply) / timeDeltaDays;
      buybackDollarRate = burnRatePerDay * price;
      buybackYield = circMC > 0 ? (buybackDollarRate * 365) / circMC * 100 : NaN;

      holderGrowthPerDay = (snap.uniqueOwners - prev.uniqueOwners) / timeDeltaDays;

      const prevExchBalance = holderBalance(prev, EXCHANGE_ADDRS);
      exchFlow = exchBalance - prevExchBalance;
      const prevKraken = holderBalance(prev, KRAKEN_LOCKED);
      organicExchFlow = exchFlow - (krakenLocked - prevKraken);

      const prevSorted = [...prev.holders].sort((a, b) => b.balance - a.balance);
      const prevTop10 = prevSorted.slice(0, 10).reduce((s, h) => s + h.balance, 0) / prev.totalSupply * 100;
      top10Delta = top10Pct - prevTop10;

      const prevLpH = prev.holders.find(h => h.addr === LP_ADDR);
      const prevLp = prevLpH ? prevLpH.balance : 0;
      lpDelta = lpBalance - prevLp;
    }

    signals.push({
      ts, price, burned, burnedPct,
      teamEcoBalance, circSupply, circMC,
      exchBalance, krakenLocked, lpBalance,
      top10Pct, top20Pct, floatPct,
      holderCount: snap.uniqueOwners,
      burnRatePerDay, buybackDollarRate, buybackYield,
      holderGrowthPerDay, exchFlow, organicExchFlow,
      top10Delta, lpDelta,
      timeDeltaDays,
    });
  }

  return signals;
}

// ─── Step 3: Compute rolling signals ───
function findNearestIndex(signals, targetTs, tolerance) {
  let best = -1, bestDist = Infinity;
  for (let i = 0; i < signals.length; i++) {
    const dist = Math.abs(signals[i].ts - targetTs);
    if (dist < bestDist) { bestDist = dist; best = i; }
  }
  return bestDist <= tolerance ? best : -1;
}

function addRollingSignals(signals) {
  const HOUR = 3600 * 1000;
  const DAY = 24 * HOUR;

  for (let i = 0; i < signals.length; i++) {
    const s = signals[i];

    // Lookback returns
    for (const [name, window, tol] of [
      ["priceReturn_24h", 1 * DAY, 12 * HOUR],
      ["priceReturn_3d", 3 * DAY, 1.5 * DAY],
      ["priceReturn_7d", 7 * DAY, 3.5 * DAY],
    ]) {
      const idx = findNearestIndex(signals, s.ts - window, tol);
      s[name] = idx >= 0 ? (s.price - signals[idx].price) / signals[idx].price * 100 : NaN;
    }

    // Cumulative exchange flow over window
    for (const [name, window] of [
      ["exchFlow_3d", 3 * DAY],
      ["exchFlow_7d", 7 * DAY],
    ]) {
      let cum = 0, count = 0;
      for (let j = i; j >= 0 && s.ts - signals[j].ts <= window; j--) {
        if (!isNaN(signals[j].exchFlow)) { cum += signals[j].exchFlow; count++; }
      }
      s[name] = count > 0 ? cum : NaN;
    }

    // Organic exchange flow over window
    for (const [name, window] of [
      ["organicExchFlow_3d", 3 * DAY],
      ["organicExchFlow_7d", 7 * DAY],
    ]) {
      let cum = 0, count = 0;
      for (let j = i; j >= 0 && s.ts - signals[j].ts <= window; j--) {
        if (!isNaN(signals[j].organicExchFlow)) { cum += signals[j].organicExchFlow; count++; }
      }
      s[name] = count > 0 ? cum : NaN;
    }

    // Holder growth acceleration vs 7d ago
    const hIdx = findNearestIndex(signals, s.ts - 7 * DAY, 3.5 * DAY);
    s.holderGrowthAccel = (hIdx >= 0 && !isNaN(s.holderGrowthPerDay) && !isNaN(signals[hIdx].holderGrowthPerDay))
      ? s.holderGrowthPerDay - signals[hIdx].holderGrowthPerDay : NaN;

    // Burn rate change vs 7d ago
    const bIdx = findNearestIndex(signals, s.ts - 7 * DAY, 3.5 * DAY);
    s.burnRateChange_7d = (bIdx >= 0 && !isNaN(s.buybackDollarRate) && !isNaN(signals[bIdx].buybackDollarRate))
      ? s.buybackDollarRate - signals[bIdx].buybackDollarRate : NaN;

    // Revenue growth rate vs 7d ago (%)
    s.revenueGrowth_7d = (bIdx >= 0 && !isNaN(s.buybackDollarRate) && signals[bIdx].buybackDollarRate > 0)
      ? (s.buybackDollarRate - signals[bIdx].buybackDollarRate) / signals[bIdx].buybackDollarRate * 100 : NaN;

    // Yield change vs 7d ago
    s.yieldChange_7d = (bIdx >= 0 && !isNaN(s.buybackYield) && !isNaN(signals[bIdx].buybackYield))
      ? s.buybackYield - signals[bIdx].buybackYield : NaN;

    // Top 20 trend over 7d
    s.top20Trend_7d = (bIdx >= 0) ? s.top20Pct - signals[bIdx].top20Pct : NaN;
  }
}

// ─── Step 4: Compute forward returns ───
function addForwardReturns(signals) {
  const HOUR = 3600 * 1000;
  const DAY = 24 * HOUR;

  const horizons = [
    { name: "fwd_6h", window: 6 * HOUR, tol: 3 * HOUR },
    { name: "fwd_12h", window: 12 * HOUR, tol: 6 * HOUR },
    { name: "fwd_24h", window: 24 * HOUR, tol: 12 * HOUR },
    { name: "fwd_3d", window: 3 * DAY, tol: 1.5 * DAY },
    { name: "fwd_7d", window: 7 * DAY, tol: 3.5 * DAY },
  ];

  for (let i = 0; i < signals.length; i++) {
    const s = signals[i];
    for (const h of horizons) {
      const idx = findNearestIndex(signals, s.ts + h.window, h.tol);
      s[h.name] = (idx >= 0 && idx !== i) ? (signals[idx].price - s.price) / s.price * 100 : NaN;
    }
  }
}

// ─── Analysis ───

// Signal classification: "structural" signals measure conditions around the buyback
// and work at any price level. "level" signals proxy for "how far along the move"
// and will degrade as price trends up. Only structural signals should drive entry decisions.
const SIGNAL_META = {
  // Level-dependent (will look worse at higher prices simply because they're later in time)
  price:              { type: "level",      label: "Price" },
  burnedPct:          { type: "level",      label: "Burned %" },
  holderCount:        { type: "level",      label: "Holder count" },
  exchBalance:        { type: "level",      label: "Exchange balance (abs)" },
  top10Pct:           { type: "level",      label: "Top 10 concentration" },
  top20Pct:           { type: "level",      label: "Top 20 concentration" },
  floatPct:           { type: "level",      label: "Float %" },
  lpBalance:          { type: "level",      label: "LP balance (abs)" },
  circMC:             { type: "level",      label: "Circ market cap" },

  // Structural (price-independent, measure flows/rates/changes)
  buybackDollarRate:  { type: "structural", label: "Buyback $/day" },
  buybackYield:       { type: "structural", label: "Buyback yield %" },
  holderGrowthPerDay: { type: "structural", label: "Holder growth/day" },
  exchFlow:           { type: "structural", label: "Exchange flow (snap)" },
  organicExchFlow:    { type: "structural", label: "Organic exch flow (snap)" },
  top10Delta:         { type: "structural", label: "Top 10 delta (snap)" },
  lpDelta:            { type: "structural", label: "LP delta (snap)" },
  priceReturn_24h:    { type: "structural", label: "24h price return" },
  priceReturn_3d:     { type: "structural", label: "3d price return" },
  priceReturn_7d:     { type: "structural", label: "7d price return" },
  exchFlow_3d:        { type: "structural", label: "Exchange flow (3d)" },
  exchFlow_7d:        { type: "structural", label: "Exchange flow (7d)" },
  organicExchFlow_3d: { type: "structural", label: "Organic exch flow (3d)" },
  organicExchFlow_7d: { type: "structural", label: "Organic exch flow (7d)" },
  holderGrowthAccel:  { type: "structural", label: "Holder growth accel" },
  burnRateChange_7d:  { type: "structural", label: "Revenue change (7d)" },
  revenueGrowth_7d:   { type: "structural", label: "Revenue growth % (7d)" },
  yieldChange_7d:     { type: "structural", label: "Yield change (7d)" },
  top20Trend_7d:      { type: "structural", label: "Top 20 trend (7d)" },
};

const SIGNAL_NAMES = Object.keys(SIGNAL_META);

const FWD_NAMES = ["fwd_6h", "fwd_12h", "fwd_24h", "fwd_3d", "fwd_7d"];

function correlationTable(signals) {
  const results = [];

  for (const sig of SIGNAL_NAMES) {
    for (const fwd of FWD_NAMES) {
      const pairs = signals.filter(s => !isNaN(s[sig]) && isFinite(s[sig]) && !isNaN(s[fwd]) && isFinite(s[fwd]));
      if (pairs.length < 10) continue;
      const x = pairs.map(s => s[sig]);
      const y = pairs.map(s => s[fwd]);
      const { rho, p, n } = spearman(x, y);
      if (isNaN(rho)) continue;
      results.push({ signal: sig, horizon: fwd, rho, p, n });
    }
  }

  results.sort((a, b) => Math.abs(b.rho) - Math.abs(a.rho));
  return results;
}

function quintileAnalysis(signals, signalName, fwdName) {
  const valid = signals.filter(s => !isNaN(s[signalName]) && isFinite(s[signalName]) && !isNaN(s[fwdName]) && isFinite(s[fwdName]));
  if (valid.length < 10) return null;

  valid.sort((a, b) => a[signalName] - b[signalName]);
  const qSize = Math.floor(valid.length / 5);
  const quintiles = [];

  for (let q = 0; q < 5; q++) {
    const start = q * qSize;
    const end = q === 4 ? valid.length : (q + 1) * qSize;
    const slice = valid.slice(start, end);
    const returns = slice.map(s => s[fwdName]);
    const sigVals = slice.map(s => s[signalName]);

    quintiles.push({
      q: q + 1,
      sigRange: `${sigVals[0].toFixed(4)} → ${sigVals[sigVals.length - 1].toFixed(4)}`,
      mean: mean(returns),
      med: median(returns),
      winRate: returns.filter(r => r > 0).length / returns.length * 100,
      n: returns.length,
    });
  }

  return quintiles;
}

function regimeAnalysis(signals) {
  const medYield = median(signals.filter(s => !isNaN(s.buybackYield)).map(s => s.buybackYield));
  const medHolderGrowth = median(signals.filter(s => !isNaN(s.holderGrowthPerDay)).map(s => s.holderGrowthPerDay));

  const regimes = [
    {
      name: "Strong buyback (yield > med & exch outflow)",
      filter: s => s.buybackYield > medYield && s.organicExchFlow < 0,
    },
    {
      name: "Weak buyback (yield < med OR exch inflow)",
      filter: s => s.buybackYield < medYield || s.organicExchFlow > 0,
    },
    {
      name: "Momentum + flow (7d ret > 0 & exch outflow 7d)",
      filter: s => s.priceReturn_7d > 0 && s.organicExchFlow_7d < 0,
    },
    {
      name: "Momentum divergence (7d ret > 0 & exch inflow 7d)",
      filter: s => s.priceReturn_7d > 0 && s.organicExchFlow_7d > 0,
    },
    {
      name: "Accumulation (holder growth > med & exch outflow)",
      filter: s => s.holderGrowthPerDay > medHolderGrowth && s.organicExchFlow < 0,
    },
    {
      name: "Distribution (holder growth < med OR exch inflow)",
      filter: s => s.holderGrowthPerDay < medHolderGrowth || s.organicExchFlow > 0,
    },
    {
      name: "Revenue acceleration (buyback $ up vs 7d ago)",
      filter: s => s.burnRateChange_7d > 0,
    },
    {
      name: "Revenue deceleration (buyback $ down vs 7d ago)",
      filter: s => s.burnRateChange_7d < 0,
    },
  ];

  const results = [];
  for (const regime of regimes) {
    const matching = signals.filter(s => {
      try { return regime.filter(s); } catch { return false; }
    }).filter(s => !isNaN(s.fwd_24h) && !isNaN(s.fwd_3d));

    if (matching.length < 3) {
      results.push({ name: regime.name, n: matching.length, fwd_24h: NaN, fwd_3d: NaN, fwd_7d: NaN, winRate_3d: NaN });
      continue;
    }

    results.push({
      name: regime.name,
      n: matching.length,
      fwd_24h: mean(matching.map(s => s.fwd_24h).filter(v => !isNaN(v))),
      fwd_3d: mean(matching.map(s => s.fwd_3d).filter(v => !isNaN(v))),
      fwd_7d: mean(matching.map(s => s.fwd_7d).filter(v => !isNaN(v))),
      winRate_3d: matching.filter(s => s.fwd_3d > 0).length / matching.filter(s => !isNaN(s.fwd_3d)).length * 100,
    });
  }

  return results;
}

function entrySignalCandidates(signals) {
  // ALL candidates use only structural (price-independent) signals.
  // No absolute price, holder count, exchange balance level, burned %, or float % thresholds.
  const candidates = [
    // ── Flow signals (strongest category) ──
    {
      name: "Exchange organic outflow > 500M (7d)",
      cond: s => s.organicExchFlow_7d < -500_000_000,
      type: "flow",
    },
    {
      name: "Exchange organic outflow > 1B (7d)",
      cond: s => s.organicExchFlow_7d < -1_000_000_000,
      type: "flow",
    },
    {
      name: "Exchange organic outflow > 2B (7d)",
      cond: s => s.organicExchFlow_7d < -2_000_000_000,
      type: "flow",
    },
    // ── Revenue/yield signals (price-normalized) ──
    {
      name: "Buyback yield > 15%",
      cond: s => s.buybackYield > 15,
      type: "yield",
    },
    {
      name: "Buyback yield > 20%",
      cond: s => s.buybackYield > 20,
      type: "yield",
    },
    {
      name: "Yield expanding (7d yield change > 0)",
      cond: s => s.yieldChange_7d > 0,
      type: "yield",
    },
    {
      name: "Revenue acceleration > $50K/day vs 7d ago",
      cond: s => s.burnRateChange_7d > 50000,
      type: "revenue",
    },
    {
      name: "Revenue acceleration > $100K/day vs 7d ago",
      cond: s => s.burnRateChange_7d > 100000,
      type: "revenue",
    },
    // ── Momentum signals (rate-based, not level) ──
    {
      name: "24h momentum > +5%",
      cond: s => s.priceReturn_24h > 5,
      type: "momentum",
    },
    {
      name: "7d price dip > -5% (buy the dip)",
      cond: s => s.priceReturn_7d < -5,
      type: "momentum",
    },
    {
      name: "2+ down snapshots (consecutive dip)",
      cond: (s, i, all) => i >= 2 && all[i-1].priceReturn_24h < 0 && s.priceReturn_24h < 0,
      type: "momentum",
    },
    // ── Structure signals (distribution, LP, growth rates) ──
    {
      name: "LP depth increasing (snap delta > 0)",
      cond: s => s.lpDelta > 0,
      type: "structure",
    },
    {
      name: "Top 20 distributing (7d trend < -0.5pp)",
      cond: s => s.top20Trend_7d < -0.5,
      type: "structure",
    },
    {
      name: "Holder growth accelerating (> 100/day vs 7d ago)",
      cond: s => s.holderGrowthAccel > 100,
      type: "structure",
    },
    {
      name: "Holder growth cooling (< 500/day)",
      cond: s => s.holderGrowthPerDay > 0 && s.holderGrowthPerDay < 500,
      type: "structure",
    },
    // ── Combo signals (multiple structural conditions) ──
    {
      name: "Revenue up + exchange outflow",
      cond: s => s.burnRateChange_7d > 0 && s.organicExchFlow_7d < 0,
      type: "combo",
    },
    {
      name: "Yield + outflow + growth (triple)",
      cond: s => s.buybackYield > 15 && s.organicExchFlow_7d < 0 && s.holderGrowthPerDay > 100,
      type: "combo",
    },
    {
      name: "Revenue accel + holder accel + exch outflow",
      cond: s => s.burnRateChange_7d > 0 && s.holderGrowthAccel > 0 && s.organicExchFlow_7d < 0,
      type: "combo",
    },
    {
      name: "Outflow + LP increasing + yield expanding",
      cond: s => s.organicExchFlow_7d < 0 && s.lpDelta > 0 && s.yieldChange_7d > 0,
      type: "combo",
    },
    {
      name: "24h momentum + exchange outflow (7d)",
      cond: s => s.priceReturn_24h > 3 && s.organicExchFlow_7d < -500_000_000,
      type: "combo",
    },
  ];

  const results = [];
  for (const c of candidates) {
    const matching = signals.filter((s, i, all) => {
      try { return c.cond(s, i, all); } catch { return false; }
    });

    for (const fwd of FWD_NAMES) {
      const valid = matching.filter(s => !isNaN(s[fwd]) && isFinite(s[fwd]));
      if (valid.length < 3) continue;
      const returns = valid.map(s => s[fwd]);
      results.push({
        signal: c.name,
        horizon: fwd,
        meanReturn: mean(returns),
        medianReturn: median(returns),
        winRate: returns.filter(r => r > 0).length / returns.length * 100,
        maxDrawdown: Math.min(...returns),
        n: valid.length,
      });
    }
  }

  return results;
}

// ─── Output ───

function printHeader(title) {
  console.log(`\n${B}${"═".repeat(100)}${R}`);
  console.log(`${B}  ${title}${R}`);
  console.log(`${"═".repeat(100)}${R}`);
}

function printSubHeader(title) {
  console.log(`\n${B}  ${title}${R}`);
  console.log(`  ${"─".repeat(96)}`);
}

// ─── E. Momentum Patterns & SOL Correlation ───

function momentumAndCorrelationAnalysis(signals) {
  printHeader("E. MOMENTUM PATTERNS & SOL CORRELATION");

  // ── E1: Autocorrelation ──
  // Does a positive return predict more positive returns (momentum) or reversal (mean reversion)?
  printSubHeader("E1. Price Autocorrelation (does momentum persist or revert?)");

  const validPairs24h = signals.filter(s => !isNaN(s.priceReturn_24h) && !isNaN(s.fwd_24h));
  const validPairs3d = signals.filter(s => !isNaN(s.priceReturn_3d) && !isNaN(s.fwd_3d));
  const validPairs7d = signals.filter(s => !isNaN(s.priceReturn_7d) && !isNaN(s.fwd_7d));

  const autocorr = [
    { label: "24h return → next 24h", data: validPairs24h, sigField: "priceReturn_24h", fwdField: "fwd_24h" },
    { label: "3d return → next 3d", data: validPairs3d, sigField: "priceReturn_3d", fwdField: "fwd_3d" },
    { label: "7d return → next 7d", data: validPairs7d, sigField: "priceReturn_7d", fwdField: "fwd_7d" },
  ];

  console.log(`\n  ${"Lookback → Forward".padEnd(30)} ${"ρ".padStart(8)} ${"p-val".padStart(8)} ${"n".padStart(5)}  Pattern`);
  console.log(`  ${"─".repeat(75)}`);

  for (const ac of autocorr) {
    if (ac.data.length < 5) {
      console.log(`  ${ac.label.padEnd(30)} ${DIM}insufficient data${R}`);
      continue;
    }
    const x = ac.data.map(s => s[ac.sigField]);
    const y = ac.data.map(s => s[ac.fwdField]);
    const { rho, p, n } = spearman(x, y);
    const pattern = rho > 0.15 ? `${GRN}MOMENTUM (trends persist)` :
                    rho < -0.15 ? `${RED}MEAN REVERSION (trends reverse)` :
                    `${YEL}RANDOM WALK`;
    console.log(`  ${ac.label.padEnd(30)} ${rho.toFixed(4).padStart(8)} ${p.toFixed(4).padStart(8)} ${String(n).padStart(5)}  ${pattern}${R}`);
  }

  // ── E2: Conditional move analysis ──
  // After big moves, does PUMP continue or revert?
  printSubHeader("E2. After big moves: continuation vs reversal");

  const moveThresholds = [
    { label: "> +5% (24h)", field: "priceReturn_24h", cond: v => v > 5, fwd: "fwd_24h", fwdLabel: "next 24h" },
    { label: "> +10% (24h)", field: "priceReturn_24h", cond: v => v > 10, fwd: "fwd_24h", fwdLabel: "next 24h" },
    { label: "< -5% (24h)", field: "priceReturn_24h", cond: v => v < -5, fwd: "fwd_24h", fwdLabel: "next 24h" },
    { label: "> +5% (24h)", field: "priceReturn_24h", cond: v => v > 5, fwd: "fwd_3d", fwdLabel: "next 3d" },
    { label: "> +10% (24h)", field: "priceReturn_24h", cond: v => v > 10, fwd: "fwd_3d", fwdLabel: "next 3d" },
    { label: "< -5% (24h)", field: "priceReturn_24h", cond: v => v < -5, fwd: "fwd_3d", fwdLabel: "next 3d" },
    { label: "> +15% (3d)", field: "priceReturn_3d", cond: v => v > 15, fwd: "fwd_3d", fwdLabel: "next 3d" },
    { label: "> +30% (3d)", field: "priceReturn_3d", cond: v => v > 30, fwd: "fwd_3d", fwdLabel: "next 3d" },
    { label: "< -10% (3d)", field: "priceReturn_3d", cond: v => v < -10, fwd: "fwd_3d", fwdLabel: "next 3d" },
    { label: "> +20% (7d)", field: "priceReturn_7d", cond: v => v > 20, fwd: "fwd_7d", fwdLabel: "next 7d" },
    { label: "> +40% (7d)", field: "priceReturn_7d", cond: v => v > 40, fwd: "fwd_7d", fwdLabel: "next 7d" },
    { label: "< -10% (7d)", field: "priceReturn_7d", cond: v => v < -10, fwd: "fwd_7d", fwdLabel: "next 7d" },
  ];

  console.log(`\n  ${"Move".padEnd(20)} ${"→ Forward".padEnd(12)} ${"Avg%".padStart(7)} ${"Med%".padStart(7)} ${"Win%".padStart(6)} ${"n".padStart(4)}  Read`);
  console.log(`  ${"─".repeat(80)}`);

  for (const mt of moveThresholds) {
    const matching = signals.filter(s =>
      !isNaN(s[mt.field]) && mt.cond(s[mt.field]) && !isNaN(s[mt.fwd]) && isFinite(s[mt.fwd])
    );
    if (matching.length < 3) {
      console.log(`  ${mt.label.padEnd(20)} ${mt.fwdLabel.padEnd(12)} ${DIM}< 3 obs${R}`);
      continue;
    }
    const fwdReturns = matching.map(s => s[mt.fwd]);
    const avgRet = mean(fwdReturns);
    const medRet = median(fwdReturns);
    const winRate = fwdReturns.filter(r => r > 0).length / fwdReturns.length * 100;
    const read = avgRet > 3 ? `${GRN}CONTINUATION` :
                 avgRet < -3 ? `${RED}REVERSAL` :
                 `${YEL}MIXED`;
    console.log(`  ${mt.label.padEnd(20)} ${mt.fwdLabel.padEnd(12)} ${avgRet.toFixed(2).padStart(7)} ${medRet.toFixed(2).padStart(7)} ${winRate.toFixed(0).padStart(5)}% ${String(matching.length).padStart(4)}  ${read}${R}`);
  }

  // ── E3: Streak analysis ──
  // How does PUMP perform after consecutive up/down snapshots?
  printSubHeader("E3. Streak analysis (consecutive direction snapshots)");

  // Compute per-snapshot direction
  const withDir = signals.filter(s => !isNaN(s.priceReturn_24h));
  let streakResults = [];

  for (let sLen = 2; sLen <= 5; sLen++) {
    for (const dir of ["up", "down"]) {
      let count = 0, fwdSum = 0, fwdWins = 0, fwdAll = [];

      for (let i = sLen; i < withDir.length; i++) {
        let streakOk = true;
        for (let j = 0; j < sLen; j++) {
          const ret = withDir[i - sLen + j + 1].price / withDir[i - sLen + j].price - 1;
          if (dir === "up" && ret <= 0) { streakOk = false; break; }
          if (dir === "down" && ret >= 0) { streakOk = false; break; }
        }
        if (streakOk && !isNaN(withDir[i].fwd_3d)) {
          count++;
          fwdAll.push(withDir[i].fwd_3d);
          fwdSum += withDir[i].fwd_3d;
          if (withDir[i].fwd_3d > 0) fwdWins++;
        }
      }

      if (count >= 3) {
        streakResults.push({
          label: `${sLen}x ${dir}`,
          avgFwd: fwdSum / count,
          medFwd: median(fwdAll),
          winRate: (fwdWins / count) * 100,
          n: count,
        });
      }
    }
  }

  if (streakResults.length > 0) {
    console.log(`\n  ${"Streak".padEnd(12)} ${"Avg 3d%".padStart(9)} ${"Med 3d%".padStart(9)} ${"Win%".padStart(6)} ${"n".padStart(4)}  Read`);
    console.log(`  ${"─".repeat(55)}`);
    for (const sr of streakResults) {
      const read = sr.avgFwd > 5 ? `${GRN}CONTINUATION` :
                   sr.avgFwd < -2 ? `${RED}REVERSAL` :
                   `${YEL}FADING`;
      console.log(`  ${sr.label.padEnd(12)} ${sr.avgFwd.toFixed(2).padStart(9)} ${sr.medFwd.toFixed(2).padStart(9)} ${sr.winRate.toFixed(0).padStart(5)}% ${String(sr.n).padStart(4)}  ${read}${R}`);
    }
  } else {
    console.log(`\n  ${DIM}Insufficient data for streak analysis${R}`);
  }

  // ── E4: Volatility clustering ──
  printSubHeader("E4. Volatility regimes (does high vol predict high vol?)");

  const withVol = signals.filter(s => !isNaN(s.priceReturn_24h) && !isNaN(s.fwd_3d));
  if (withVol.length >= 10) {
    const absReturns = withVol.map(s => Math.abs(s.priceReturn_24h));
    const medAbsRet = median(absReturns);

    const highVol = withVol.filter(s => Math.abs(s.priceReturn_24h) > medAbsRet);
    const lowVol = withVol.filter(s => Math.abs(s.priceReturn_24h) <= medAbsRet);

    const hvFwd = highVol.map(s => s.fwd_3d);
    const lvFwd = lowVol.map(s => s.fwd_3d);

    const hvAbsFwd = highVol.filter(s => !isNaN(s.fwd_24h)).map(s => Math.abs(s.fwd_24h));
    const lvAbsFwd = lowVol.filter(s => !isNaN(s.fwd_24h)).map(s => Math.abs(s.fwd_24h));

    console.log(`\n  ${"Regime".padEnd(20)} ${"Avg 3d%".padStart(9)} ${"Med 3d%".padStart(9)} ${"Win%".padStart(6)} ${"Avg |24h fwd|".padStart(14)} ${"n".padStart(4)}`);
    console.log(`  ${"─".repeat(65)}`);
    console.log(`  ${"High vol (|24h| > med)".padEnd(20)} ${mean(hvFwd).toFixed(2).padStart(9)} ${median(hvFwd).toFixed(2).padStart(9)} ${(hvFwd.filter(r => r > 0).length / hvFwd.length * 100).toFixed(0).padStart(5)}% ${(hvAbsFwd.length > 0 ? mean(hvAbsFwd).toFixed(2) : "N/A").padStart(14)} ${String(highVol.length).padStart(4)}`);
    console.log(`  ${"Low vol (|24h| ≤ med)".padEnd(20)} ${mean(lvFwd).toFixed(2).padStart(9)} ${median(lvFwd).toFixed(2).padStart(9)} ${(lvFwd.filter(r => r > 0).length / lvFwd.length * 100).toFixed(0).padStart(5)}% ${(lvAbsFwd.length > 0 ? mean(lvAbsFwd).toFixed(2) : "N/A").padStart(14)} ${String(lowVol.length).padStart(4)}`);
    console.log(`\n  ${DIM}Median |24h return|: ${medAbsRet.toFixed(2)}%${R}`);
  }

  // ── E5: SOL correlation status ──
  printSubHeader("E5. SOL Correlation");

  const PRICE_HISTORY_FILE = path.join(path.dirname(new URL(import.meta.url).pathname), "pump-price-history.json");
  let solCorrMsg;

  try {
    const priceHistory = JSON.parse(fs.readFileSync(PRICE_HISTORY_FILE, "utf-8"));
    const withSol = priceHistory.filter(p => p.solPrice && p.pumpPrice);

    if (withSol.length >= 20) {
      // Compute returns and correlate
      const pumpReturns = [], solReturns = [];
      for (let i = 1; i < withSol.length; i++) {
        const pRet = (withSol[i].pumpPrice - withSol[i - 1].pumpPrice) / withSol[i - 1].pumpPrice;
        const sRet = (withSol[i].solPrice - withSol[i - 1].solPrice) / withSol[i - 1].solPrice;
        if (isFinite(pRet) && isFinite(sRet)) {
          pumpReturns.push(pRet * 100);
          solReturns.push(sRet * 100);
        }
      }

      if (pumpReturns.length >= 10) {
        const { rho, p, n } = spearman(pumpReturns, solReturns);
        const corrLabel = Math.abs(rho) > 0.5 ? "STRONG" : Math.abs(rho) > 0.3 ? "MODERATE" : "WEAK";
        console.log(`\n  PUMP-SOL return correlation: ${B}${corrLabel}${R} (ρ=${rho.toFixed(3)}, p=${p.toFixed(4)}, n=${n})`);

        // Check if SOL leads PUMP
        const leadLag = [];
        for (let lag = 1; lag <= 3; lag++) {
          const solLead = [], pumpFollow = [];
          for (let i = lag; i < withSol.length; i++) {
            const sRet = (withSol[i - lag].solPrice - (i - lag - 1 >= 0 ? withSol[i - lag - 1].solPrice : withSol[i - lag].solPrice)) / withSol[i - lag].solPrice;
            const pRet = (withSol[i].pumpPrice - withSol[i - 1].pumpPrice) / withSol[i - 1].pumpPrice;
            if (isFinite(sRet) && isFinite(pRet)) {
              solLead.push(sRet * 100);
              pumpFollow.push(pRet * 100);
            }
          }
          if (solLead.length >= 10) {
            const { rho: lRho } = spearman(solLead, pumpFollow);
            leadLag.push({ lag, rho: lRho, n: solLead.length });
          }
        }

        if (leadLag.length > 0) {
          console.log(`\n  SOL leads PUMP? (lagged correlation):`);
          console.log(`  ${"Lag".padStart(5)} ${"ρ".padStart(8)} ${"n".padStart(5)}  Signal`);
          for (const ll of leadLag) {
            const sig = ll.rho > 0.2 ? `${GRN}SOL leads PUMP (trade SOL moves for PUMP timing)` :
                        ll.rho < -0.2 ? `${RED}Inverse (SOL up → PUMP down)` :
                        `${DIM}No lead-lag relationship`;
            console.log(`  ${String(ll.lag).padStart(5)} ${ll.rho.toFixed(4).padStart(8)} ${String(ll.n).padStart(5)}  ${sig}${R}`);
          }
        }
      } else {
        solCorrMsg = `${YEL}Only ${pumpReturns.length} concurrent data points — need 20+ for correlation. Keep collecting.${R}`;
      }
    } else {
      solCorrMsg = `${YEL}Only ${withSol.length} data points with both PUMP+SOL prices. Need 20+ for correlation.${R}`;
    }
  } catch (e) {
    solCorrMsg = `${DIM}pump-price-history.json not found or empty. SOL correlation requires the price monitor to be running.`;
    solCorrMsg += `\n  The price monitor (pump-price-monitor.js) captures PUMP and SOL prices every 5 minutes.`;
    solCorrMsg += `\n  SOL correlation analysis will auto-populate once ~4 hours of data accumulates.${R}`;
  }

  if (solCorrMsg) {
    console.log(`\n  ${solCorrMsg}`);
  }
}

function main() {
  console.log(`${B}PUMP TOKEN BACKTEST — Signal → Forward Return Analysis${R}`);
  console.log(`${DIM}Data: ${history.length} raw snapshots, ${history[0].timestamp.slice(0, 10)} → ${history[history.length - 1].timestamp.slice(0, 10)}${R}`);

  // Deduplicate
  const snaps = deduplicateSnapshots(history);
  console.log(`${DIM}After dedup (>1h gap): ${snaps.length} snapshots${R}`);

  // Compute all signals
  const signals = computeSignals(snaps);
  addRollingSignals(signals);
  addForwardReturns(signals);

  const validCount = signals.filter(s => !isNaN(s.fwd_24h)).length;
  console.log(`${DIM}Snapshots with valid 24h forward return: ${validCount}${R}`);

  // ═══════════════════════════════════════
  // A. Correlation table
  // ═══════════════════════════════════════
  printHeader("A. SIGNAL CORRELATION TABLE (Spearman rank, sorted by |ρ|)");
  console.log(`${DIM}  Positive ρ = signal value ↑ → forward return ↑${R}`);
  console.log(`${DIM}  Negative ρ = signal value ↑ → forward return ↓${R}`);
  console.log(`${DIM}  [S] = structural (price-independent)  [L] = level-dependent (degrades as price trends)${R}\n`);

  const corr = correlationTable(signals);

  // Show structural signals first, then level-dependent
  for (const [groupLabel, groupFilter] of [
    ["STRUCTURAL SIGNALS (drive entry decisions)", c => SIGNAL_META[c.signal]?.type === "structural"],
    ["LEVEL-DEPENDENT (context only — do NOT use for entry timing)", c => SIGNAL_META[c.signal]?.type === "level"],
  ]) {
    console.log(`\n  ${B}${groupLabel}${R}`);
    console.log(`  ${"Signal".padEnd(28)} ${"Horizon".padEnd(10)} ${"ρ".padStart(8)} ${"p-val".padStart(8)} ${"n".padStart(5)}  Interp`);
    console.log(`  ${"─".repeat(90)}`);

    const shown = new Set();
    let count = 0;
    for (const c of corr) {
      if (count >= 30) break;
      if (!groupFilter(c)) continue;
      const key = `${c.signal}|${c.horizon}`;
      if (shown.has(key)) continue;
      shown.add(key);

      const color = Math.abs(c.rho) > 0.3 ? (c.rho > 0 ? GRN : RED) : "";
      const sig = c.p < 0.05 ? " **" : c.p < 0.1 ? " *" : "";
      const interp = Math.abs(c.rho) > 0.4 ? "STRONG" : Math.abs(c.rho) > 0.25 ? "moderate" : "weak";
      console.log(`  ${color}${c.signal.padEnd(28)} ${c.horizon.padEnd(10)} ${c.rho.toFixed(4).padStart(8)} ${c.p.toFixed(4).padStart(8)} ${String(c.n).padStart(5)}  ${interp}${sig}${R}`);
      count++;
    }
  }

  // ═══════════════════════════════════════
  // B. Quintile analysis for top signals
  // ═══════════════════════════════════════
  printHeader("B. QUINTILE ANALYSIS (structural signals vs 3-day forward return)");

  // Pick top structural signals by correlation with fwd_3d
  const top3d = corr.filter(c => c.horizon === "fwd_3d" && SIGNAL_META[c.signal]?.type === "structural").slice(0, 8);
  for (const tc of top3d) {
    const q = quintileAnalysis(signals, tc.signal, "fwd_3d");
    if (!q) continue;

    printSubHeader(`${tc.signal} → fwd_3d (ρ=${tc.rho.toFixed(3)})`);
    console.log(`  ${"Q".padStart(3)} ${"Signal Range".padEnd(35)} ${"Mean Fwd%".padStart(10)} ${"Med Fwd%".padStart(10)} ${"Win%".padStart(7)} ${"n".padStart(4)}`);
    for (const row of q) {
      const color = row.mean > 0 ? GRN : RED;
      console.log(`  ${color}${String(row.q).padStart(3)} ${row.sigRange.padEnd(35)} ${row.mean.toFixed(2).padStart(10)} ${row.med.toFixed(2).padStart(10)} ${row.winRate.toFixed(0).padStart(6)}% ${String(row.n).padStart(4)}${R}`);
    }
  }

  // ═══════════════════════════════════════
  // C. Regime analysis
  // ═══════════════════════════════════════
  printHeader("C. REGIME ANALYSIS (avg forward returns by market regime)");

  const regimes = regimeAnalysis(signals);
  console.log(`\n  ${"Regime".padEnd(55)} ${"n".padStart(4)} ${"24h%".padStart(8)} ${"3d%".padStart(8)} ${"7d%".padStart(8)} ${"Win3d%".padStart(8)}`);
  console.log(`  ${"─".repeat(95)}`);

  for (const r of regimes) {
    const color = r.fwd_3d > 0 ? GRN : (r.fwd_3d < 0 ? RED : "");
    const f24 = isNaN(r.fwd_24h) ? "N/A" : r.fwd_24h.toFixed(2);
    const f3 = isNaN(r.fwd_3d) ? "N/A" : r.fwd_3d.toFixed(2);
    const f7 = isNaN(r.fwd_7d) ? "N/A" : r.fwd_7d.toFixed(2);
    const w3 = isNaN(r.winRate_3d) ? "N/A" : r.winRate_3d.toFixed(0) + "%";
    console.log(`  ${color}${r.name.padEnd(55)} ${String(r.n).padStart(4)} ${f24.padStart(8)} ${f3.padStart(8)} ${f7.padStart(8)} ${w3.padStart(8)}${R}`);
  }

  // ═══════════════════════════════════════
  // D. Entry signal candidates
  // ═══════════════════════════════════════
  printHeader("D. ENTRY SIGNAL CANDIDATES (structural signals only — no price levels)");
  console.log(`${DIM}  All signals are price-independent: flows, rates, deltas, yield. No absolute levels.${R}`);
  console.log(`${DIM}  Sorted by 3d win rate × mean return. Min 3 observations.${R}\n`);

  const entries = entrySignalCandidates(signals);

  // Score by risk-adjusted return (win rate * mean return)
  const scored = entries
    .filter(e => e.horizon === "fwd_3d" && e.n >= 3)
    .map(e => ({ ...e, score: (e.winRate / 100) * e.meanReturn }))
    .sort((a, b) => b.score - a.score);

  console.log(`  ${"Rank".padStart(4)} ${"Signal".padEnd(58)} ${"Mean%".padStart(7)} ${"Med%".padStart(7)} ${"Win%".padStart(6)} ${"MaxDD%".padStart(8)} ${"n".padStart(4)} ${"Score".padStart(7)}`);
  console.log(`  ${"─".repeat(100)}`);

  scored.slice(0, 20).forEach((e, i) => {
    const color = e.score > 0 ? GRN : RED;
    console.log(`  ${color}${String(i + 1).padStart(4)} ${e.signal.padEnd(58)} ${e.meanReturn.toFixed(2).padStart(7)} ${e.medianReturn.toFixed(2).padStart(7)} ${e.winRate.toFixed(0).padStart(5)}% ${e.maxDrawdown.toFixed(2).padStart(8)} ${String(e.n).padStart(4)} ${e.score.toFixed(2).padStart(7)}${R}`);
  });

  // Also show all horizons for top 5 entry signals
  printSubHeader("Top 5 signals — all horizons");
  const topSignals = [...new Set(scored.slice(0, 5).map(s => s.signal))];
  for (const sig of topSignals) {
    console.log(`\n  ${B}${sig}${R}`);
    const rows = entries.filter(e => e.signal === sig);
    console.log(`    ${"Horizon".padEnd(10)} ${"Mean%".padStart(8)} ${"Med%".padStart(8)} ${"Win%".padStart(7)} ${"MaxDD%".padStart(8)} ${"n".padStart(4)}`);
    for (const r of rows) {
      const color = r.meanReturn > 0 ? GRN : RED;
      console.log(`    ${color}${r.horizon.padEnd(10)} ${r.meanReturn.toFixed(2).padStart(8)} ${r.medianReturn.toFixed(2).padStart(8)} ${r.winRate.toFixed(0).padStart(6)}% ${r.maxDrawdown.toFixed(2).padStart(8)} ${String(r.n).padStart(4)}${R}`);
    }
  }

  // ═══════════════════════════════════════
  // E. Momentum pattern analysis + SOL correlation
  // ═══════════════════════════════════════
  momentumAndCorrelationAnalysis(signals);

  // ═══════════════════════════════════════
  // Summary
  // ═══════════════════════════════════════
  printHeader("SUMMARY — ACTIONABLE ENTRY SIGNALS (structural only)");
  console.log(`\n${DIM}  Based on ${snaps.length} snapshots over ${((signals[signals.length-1].ts - signals[0].ts)/86400000).toFixed(0)} days${R}`);
  console.log(`${DIM}  All signals are price-independent — they work at $0.005 or $0.05${R}`);
  console.log(`${DIM}  ⚠  Small sample — treat as directional guidance, not statistical proof${R}\n`);

  // Top 3 entry signals
  const top3 = scored.filter(s => s.winRate >= 50 && s.n >= 5).slice(0, 5);
  if (top3.length) {
    console.log(`  ${B}Best entry timing signals (3d horizon, win rate ≥ 50%, n ≥ 5):${R}`);
    for (const t of top3) {
      const icon = t.winRate >= 70 ? `${GRN}★` : `${YEL}◆`;
      console.log(`  ${icon} ${t.signal}${R}`);
      console.log(`    ${GRN}→ 3d return: ${t.meanReturn.toFixed(2)}% avg (${t.medianReturn.toFixed(2)}% med), ${t.winRate.toFixed(0)}% win rate, ${t.n} observations${R}`);
      console.log(`    ${RED}  Worst case: ${t.maxDrawdown.toFixed(2)}%${R}`);
    }
  }

  // Strongest structural correlations (exclude level-dependent)
  const strongCorr = corr.filter(c => c.p < 0.1 && c.n >= 10 && SIGNAL_META[c.signal]?.type === "structural").slice(0, 5);
  if (strongCorr.length) {
    console.log(`\n  ${B}Strongest predictive correlations:${R}`);
    for (const c of strongCorr) {
      const dir = c.rho > 0 ? "↑ predicts ↑" : "↑ predicts ↓";
      console.log(`  ${CYN}• ${c.signal} ${dir} ${c.horizon} (ρ=${c.rho.toFixed(3)}, p=${c.p.toFixed(3)}, n=${c.n})${R}`);
    }
  }

  console.log(`\n${DIM}  Note: With hourly data collection, these signals will become much more reliable.${R}`);
  console.log(`${DIM}  Current data is too sparse (median ${(median(signals.filter((_,i)=>i>0).map(s=>s.timeDeltaDays))*24).toFixed(1)}h gap) for 6h/12h signals.${R}`);
  console.log(`${B}${"═".repeat(100)}${R}\n`);
}

main();
