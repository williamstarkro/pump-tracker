#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════════
//  PUMP Buyback Rhythm Analyzer
//  Extracts burn patterns from supply deltas across snapshots.
//  Identifies: daily/weekly rhythms, acceleration, revenue per burn,
//  and whether buyback timing is predictable.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = join(__dirname, "pump-tracker-history.json");

const BOLD = "\x1b[1m", RESET = "\x1b[0m", GREEN = "\x1b[32m", RED = "\x1b[31m", DIM = "\x1b[2m", YELLOW = "\x1b[33m", CYAN = "\x1b[36m";

function main() {
  const raw = JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));

  // Deduplicate to ~1h gaps
  const snapshots = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    if (new Date(raw[i].timestamp) - new Date(snapshots[snapshots.length - 1].timestamp) >= 3600000)
      snapshots.push(raw[i]);
  }

  console.log(`${BOLD}═══════════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  PUMP Buyback Rhythm Analysis${RESET}`);
  console.log(`${BOLD}═══════════════════════════════════════════════════════════════════${RESET}`);
  console.log(`  ${DIM}${snapshots.length} snapshots, ${snapshots[0].timestamp.slice(0, 10)} → ${snapshots[snapshots.length - 1].timestamp.slice(0, 10)}${RESET}`);

  // ── A. Per-interval burn data ──
  const intervals = [];
  for (let i = 1; i < snapshots.length; i++) {
    const prev = snapshots[i - 1];
    const curr = snapshots[i];
    const dt = (new Date(curr.timestamp) - new Date(prev.timestamp)) / 3600000;
    const burned = prev.totalSupply - curr.totalSupply;
    if (burned < 0) continue; // skip anomalies

    const burnRate = burned / dt; // tokens per hour
    const burnUsd = burned * curr.price;
    const revenueImplied = burnUsd * 2; // 50% of revenue goes to buyback

    intervals.push({
      from: prev.timestamp,
      to: curr.timestamp,
      hours: dt,
      burned,
      burnRate,
      burnUsd,
      revenueImplied,
      revenuePerHour: revenueImplied / dt,
      price: curr.price,
      dayOfWeek: new Date(curr.timestamp).getUTCDay(),
      hourOfDay: new Date(curr.timestamp).getUTCHours(),
    });
  }

  console.log(`\n  ${BOLD}A. Overall Burn Statistics${RESET}`);
  const totalBurned = intervals.reduce((s, i) => s + i.burned, 0);
  const totalHours = intervals.reduce((s, i) => s + i.hours, 0);
  const totalDays = totalHours / 24;
  const totalRevenue = intervals.reduce((s, i) => s + i.revenueImplied, 0);
  const avgBurnPerDay = totalBurned / totalDays;
  const avgRevenuePerDay = totalRevenue / totalDays;
  const latestPrice = snapshots[snapshots.length - 1].price;

  console.log(`    Total burned (tracked): ${(totalBurned / 1e9).toFixed(2)}B tokens ($${(totalBurned * latestPrice / 1e6).toFixed(1)}M at current price)`);
  console.log(`    Implied revenue (tracked): $${(totalRevenue / 1e6).toFixed(1)}M over ${totalDays.toFixed(0)} days`);
  console.log(`    Avg burn rate: ${(avgBurnPerDay / 1e6).toFixed(0)}M tokens/day ($${(avgBurnPerDay * latestPrice / 1e3).toFixed(0)}K/day in burns)`);
  console.log(`    Avg implied revenue: $${(avgRevenuePerDay / 1e6).toFixed(2)}M/day`);

  // ── B. Weekly revenue trend ──
  console.log(`\n  ${BOLD}B. Weekly Revenue Trend${RESET}`);
  const weekBuckets = new Map();
  for (const iv of intervals) {
    const d = new Date(iv.to);
    const weekStart = new Date(d);
    weekStart.setUTCDate(d.getUTCDate() - d.getUTCDay());
    const key = weekStart.toISOString().slice(0, 10);
    if (!weekBuckets.has(key)) weekBuckets.set(key, { revenue: 0, burned: 0, hours: 0, prices: [] });
    const b = weekBuckets.get(key);
    b.revenue += iv.revenueImplied;
    b.burned += iv.burned;
    b.hours += iv.hours;
    b.prices.push(iv.price);
  }

  let prevWeekRev = null;
  for (const [week, data] of [...weekBuckets.entries()].sort()) {
    const dailyRev = data.hours > 0 ? data.revenue / (data.hours / 24) : 0;
    const avgPrice = data.prices.reduce((a, b) => a + b, 0) / data.prices.length;
    const delta = prevWeekRev ? ((dailyRev / prevWeekRev - 1) * 100) : null;
    const arrow = delta === null ? "" : delta > 5 ? GREEN + " ▲" + delta.toFixed(0) + "%" : delta < -5 ? RED + " ▼" + Math.abs(delta).toFixed(0) + "%" : YELLOW + " =" + RESET;
    console.log(`    ${week}: $${(dailyRev / 1e6).toFixed(2)}M/day | burned ${(data.burned / 1e9).toFixed(1)}B | avg price $${avgPrice.toFixed(6)}${arrow}${RESET} ${DIM}(${(data.hours).toFixed(0)}h coverage)${RESET}`);
    prevWeekRev = dailyRev;
  }

  // ── C. Burn rate volatility ──
  console.log(`\n  ${BOLD}C. Burn Rate Volatility${RESET}`);
  const hourlyRates = intervals.filter(i => i.hours < 3).map(i => i.burnRate);
  if (hourlyRates.length >= 5) {
    const mean = hourlyRates.reduce((a, b) => a + b, 0) / hourlyRates.length;
    const variance = hourlyRates.reduce((s, r) => s + (r - mean) ** 2, 0) / hourlyRates.length;
    const cv = Math.sqrt(variance) / mean;
    hourlyRates.sort((a, b) => a - b);
    const p10 = hourlyRates[Math.floor(hourlyRates.length * 0.1)];
    const p90 = hourlyRates[Math.floor(hourlyRates.length * 0.9)];

    console.log(`    ${hourlyRates.length} hourly intervals analyzed`);
    console.log(`    Mean: ${(mean / 1e6).toFixed(0)}M tokens/hr | CV: ${cv.toFixed(2)}`);
    console.log(`    P10: ${(p10 / 1e6).toFixed(0)}M/hr | P90: ${(p90 / 1e6).toFixed(0)}M/hr | Range: ${(p90 / p10).toFixed(1)}x`);
    console.log(`    ${cv < 0.3 ? GREEN + "Low volatility — steady buyback rate" : cv < 0.6 ? YELLOW + "Moderate volatility — some clustering" : RED + "High volatility — buybacks are lumpy/clustered"}${RESET}`);
  } else {
    console.log(`    ${DIM}Need more hourly-cadence data for volatility analysis${RESET}`);
  }

  // ── D. Burn-price relationship ──
  console.log(`\n  ${BOLD}D. Burn Rate vs Price Relationship${RESET}`);
  console.log(`  ${DIM}Does higher price → higher burn (more revenue)?${RESET}`);

  // Split into price quintiles
  const sorted = [...intervals].filter(i => i.hours < 12).sort((a, b) => a.price - b.price);
  if (sorted.length >= 10) {
    const qSize = Math.floor(sorted.length / 5);
    for (let q = 0; q < 5; q++) {
      const slice = sorted.slice(q * qSize, q === 4 ? sorted.length : (q + 1) * qSize);
      const avgPrice = slice.reduce((s, i) => s + i.price, 0) / slice.length;
      const avgBurn = slice.reduce((s, i) => s + i.burnRate, 0) / slice.length;
      const avgRev = slice.reduce((s, i) => s + i.revenuePerHour, 0) / slice.length;
      console.log(`    Q${q + 1} price $${avgPrice.toFixed(6)}: burn ${(avgBurn / 1e6).toFixed(0)}M/hr, rev $${(avgRev * 24 / 1e6).toFixed(2)}M/day (${slice.length} obs)`);
    }
  }

  // ── E. Acceleration analysis ──
  console.log(`\n  ${BOLD}E. Revenue Acceleration (rolling 7d windows)${RESET}`);

  // For each snapshot, compute trailing 7d revenue rate
  const revenueTimeline = [];
  for (let i = 1; i < snapshots.length; i++) {
    const ts = new Date(snapshots[i].timestamp).getTime();
    const window7d = intervals.filter(iv => {
      const ivTs = new Date(iv.to).getTime();
      return ivTs <= ts && ivTs > ts - 7 * 86400000;
    });
    if (window7d.length < 3) continue;
    const windowHours = window7d.reduce((s, i) => s + i.hours, 0);
    const windowRev = window7d.reduce((s, i) => s + i.revenueImplied, 0);
    const dailyRate = windowRev / (windowHours / 24);

    revenueTimeline.push({
      date: snapshots[i].timestamp.slice(0, 10),
      dailyRate,
      price: snapshots[i].price,
    });
  }

  // Dedupe by date
  const byDate = new Map();
  for (const r of revenueTimeline) {
    byDate.set(r.date, r);
  }
  const dates = [...byDate.entries()].sort(([a], [b]) => a.localeCompare(b));

  if (dates.length >= 3) {
    let prevRate = null;
    for (const [date, data] of dates) {
      const delta = prevRate ? ((data.dailyRate / prevRate - 1) * 100) : null;
      const bar = "█".repeat(Math.min(40, Math.round(data.dailyRate / 50000)));
      const arrow = delta === null ? "" : delta > 10 ? GREEN + " ▲" : delta < -10 ? RED + " ▼" : " =";
      console.log(`    ${date} $${(data.dailyRate / 1e6).toFixed(2)}M/d ${DIM}${bar}${RESET}${arrow}${RESET} ${DIM}@$${data.price.toFixed(6)}${RESET}`);
      prevRate = data.dailyRate;
    }
  }

  // ── F. Buyback yield curve (what yield does the market assign at different price levels?) ──
  console.log(`\n  ${BOLD}F. Implied Buyback Yield at Different Prices${RESET}`);
  console.log(`  ${DIM}If revenue stays at current levels, what yield does the market get?${RESET}`);

  const currentDailyRev = dates.length > 0 ? dates[dates.length - 1][1].dailyRate : avgRevenuePerDay;
  const currentSupply = snapshots[snapshots.length - 1].totalSupply;

  // Project yield at different price multiples
  const annualBuyback = currentDailyRev * 365 * 0.5; // 50% goes to buyback
  console.log(`    Current daily revenue: $${(currentDailyRev / 1e6).toFixed(2)}M`);
  console.log(`    Annual buyback budget: $${(annualBuyback / 1e6).toFixed(0)}M`);
  console.log();

  for (const mult of [0.5, 0.75, 1.0, 1.5, 2.0, 3.0, 5.0]) {
    const projPrice = latestPrice * mult;
    const mcap = currentSupply * projPrice;
    const yieldPct = (annualBuyback / mcap) * 100;
    const label = mult === 1.0 ? " ← current" : "";
    const color = yieldPct > 20 ? GREEN : yieldPct > 10 ? YELLOW : RED;
    console.log(`    $${projPrice.toFixed(6)} (${mult}x): FDV $${(mcap / 1e9).toFixed(1)}B, buyback yield ${color}${yieldPct.toFixed(1)}%${RESET}${label}`);
  }

  // ── G. Supply compression projections ──
  console.log(`\n  ${BOLD}G. Supply Compression Projections${RESET}`);
  console.log(`  ${DIM}At current burn rate, when does float get squeezed?${RESET}`);

  const currentBurned = 1_000_000_000_000 - currentSupply;
  const burnPerDay = avgBurnPerDay;
  const currentBurnedPct = (currentBurned / 1_000_000_000_000) * 100;

  console.log(`    Currently burned: ${(currentBurned / 1e9).toFixed(1)}B (${currentBurnedPct.toFixed(1)}%)`);
  console.log(`    Burn rate: ${(burnPerDay / 1e6).toFixed(0)}M/day`);
  console.log();

  for (const target of [20, 25, 30, 40, 50]) {
    const targetBurn = target / 100 * 1_000_000_000_000;
    const remaining = targetBurn - currentBurned;
    if (remaining <= 0) {
      console.log(`    ${target}%: ${GREEN}ALREADY REACHED${RESET}`);
      continue;
    }
    const daysTo = remaining / burnPerDay;
    const dateAt = new Date(Date.now() + daysTo * 86400000);
    console.log(`    ${target}%: ${daysTo.toFixed(0)} days (${dateAt.toISOString().slice(0, 10)}) — ${(remaining / 1e9).toFixed(1)}B more to burn`);
  }

  // ── H. Revenue elasticity — does revenue grow with price? ──
  console.log(`\n  ${BOLD}H. Revenue-Price Elasticity${RESET}`);
  console.log(`  ${DIM}If price doubles, does revenue double? (elasticity = 1 means linear)${RESET}`);

  if (dates.length >= 5) {
    // Compute log returns for price and revenue
    const pairs = [];
    for (let i = 1; i < dates.length; i++) {
      const [, prev] = dates[i - 1];
      const [, curr] = dates[i];
      if (prev.dailyRate > 0 && curr.dailyRate > 0 && prev.price > 0 && curr.price > 0) {
        pairs.push({
          priceReturn: Math.log(curr.price / prev.price),
          revReturn: Math.log(curr.dailyRate / prev.dailyRate),
        });
      }
    }

    if (pairs.length >= 3) {
      // Simple OLS regression: revReturn = α + β * priceReturn
      const n = pairs.length;
      const sumX = pairs.reduce((s, p) => s + p.priceReturn, 0);
      const sumY = pairs.reduce((s, p) => s + p.revReturn, 0);
      const sumXY = pairs.reduce((s, p) => s + p.priceReturn * p.revReturn, 0);
      const sumX2 = pairs.reduce((s, p) => s + p.priceReturn ** 2, 0);
      const beta = (n * sumXY - sumX * sumY) / (n * sumX2 - sumX ** 2);
      const alpha = (sumY - beta * sumX) / n;

      // R-squared
      const yMean = sumY / n;
      const ssRes = pairs.reduce((s, p) => s + (p.revReturn - alpha - beta * p.priceReturn) ** 2, 0);
      const ssTot = pairs.reduce((s, p) => s + (p.revReturn - yMean) ** 2, 0);
      const r2 = 1 - ssRes / ssTot;

      console.log(`    Elasticity (β): ${beta.toFixed(2)} ${DIM}(1.0 = linear, >1 = superlinear)${RESET}`);
      console.log(`    R²: ${r2.toFixed(2)} ${DIM}(how much price explains revenue variation)${RESET}`);

      if (beta > 1.2) {
        console.log(`    ${GREEN}Revenue grows FASTER than price — flywheel effect${RESET}`);
        console.log(`    ${GREEN}Higher price → more trading → more revenue → more buyback → higher price${RESET}`);
      } else if (beta > 0.8) {
        console.log(`    ${YELLOW}Revenue roughly tracks price — linear relationship${RESET}`);
      } else if (beta > 0) {
        console.log(`    ${YELLOW}Revenue grows SLOWER than price — diminishing returns${RESET}`);
      } else {
        console.log(`    ${RED}Revenue inversely related to price — contrarian dynamic${RESET}`);
      }
    }
  }

  console.log(`\n${BOLD}═══════════════════════════════════════════════════════════════════${RESET}`);
}

main();
