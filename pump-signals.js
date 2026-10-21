// ═══════════════════════════════════════════════════════════════════
//  PUMP signal library — shared by pump-alerts.js, pump-walkforward.js,
//  pump-scorecard.js. Pure functions, no I/O, no side effects.
// ═══════════════════════════════════════════════════════════════════

// ─── Wallet classifications (from pump-tracker.js) ───
export const EXCHANGE_ADDRS = new Set([
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

export const KRAKEN_LOCKED_ADDRS = new Set([
  "EFE3j1pcSP1paUzA86zW7989ZjsFP2J7ginyUqo4ewqR",
  "E2RvJg2myWpKcbkhBuF81gfhYr6KvmNcDbSmr5qnatYy",
]);

export const TEAM_ECO_ADDRS = new Set([
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

export const LP_ADDR = "2uF4Xh61rDwxnG9woyxsVQP7zuA6kLFpb3NvnRQeoiSd";
export const ORIGINAL_SUPPLY = 1_000_000_000_000;
export const LOCKED_IN_EXCHANGES = 9_300_000_000;


// ─── Supply cleaning ───
// Until 2026-10-20 totalSupply was the SUM of a paginated 375K-account scan,
// which drifts by tens of millions per hour (38 of 160 hourly deltas were
// negative, i.e. supply "grew" for a burn-only token). PUMP supply can only
// fall, so: rolling median (±6 snapshots) then enforce non-increasing.
// Snapshots that carry `chainSupply` (from getTokenSupply) are trusted as-is.
export function smoothSupply(snapshots) {
  const out = snapshots.map(s => ({ ...s }));
  const n = out.length;
  for (let i = 0; i < n; i++) {
    if (out[i].chainSupply) { out[i].totalSupply = out[i].chainSupply; continue; }
    const w = [];
    for (let j = Math.max(0, i - 6); j < Math.min(n, i + 7); j++) w.push(snapshots[j].chainSupply || snapshots[j].totalSupply);
    w.sort((a, b) => a - b);
    out[i].totalSupply = w[Math.floor(w.length / 2)];
  }
  for (let i = 1; i < n; i++) out[i].totalSupply = Math.min(out[i].totalSupply, out[i - 1].totalSupply);
  return out;
}

// ─── Signal computation ───

export function getHolderBalance(snap, addrSet) {
  return snap.holders.filter(h => addrSet.has(h.addr)).reduce((s, h) => s + h.balance, 0);
}

export function getAddrBalance(snap, addr) {
  const h = snap.holders.find(h => h.addr === addr);
  return h ? h.balance : 0;
}

export function findSnapshotAtOffset(snapshots, fromIdx, hoursBack) {
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

export function deduplicateSnapshots(raw, minGapHours = 1) {
  if (raw.length === 0) return [];
  const out = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    const gap = (new Date(raw[i].timestamp) - new Date(out[out.length - 1].timestamp)) / 3600000;
    if (gap >= minGapHours) out.push(raw[i]);
  }
  return out;
}

export function computeEntrySignals(snapshots) {
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

export function computeEntryScore(signals, solRegime, fng, btcData) {
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

