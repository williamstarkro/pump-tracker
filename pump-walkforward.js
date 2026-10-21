#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  PUMP walk-forward signal evaluation
//
//  Every condition is judged against the BASE RATE of the same time window
//  ("would buying any random hour have done this well?") and against
//  SOL-residual returns ("is this just SOL beta?"). A condition only earns
//  trust if its excess return is positive in most windows, not just pooled.
//
//  n counts hours, and forward windows overlap, so n=50 is maybe 5-10
//  independent episodes. Treat everything here as directional.
//
//  Usage: node pump-walkforward.js [--h 24|72|168] [--window 14] [--since 2026-09-28]
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { deduplicateSnapshots, smoothSupply, computeEntrySignals } from "./pump-signals.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1] ?? true] : null).filter(Boolean));
const H = parseInt(args.h || "72");          // forward horizon in hours
const WINDOW_DAYS = parseInt(args.window || "14");
const SINCE = args.since || null;
const B = "\x1b[1m", R = "\x1b[0m", DIM = "\x1b[2m", GRN = "\x1b[32m", RED = "\x1b[31m", YEL = "\x1b[33m";

// ─── Load ───
const raw = JSON.parse(readFileSync(join(__dirname, "pump-tracker-history.json"), "utf-8"));
const snaps = smoothSupply(deduplicateSnapshots(raw, 1));
const solFile = join(__dirname, "sol-price-history.json");
const sol = existsSync(solFile) ? JSON.parse(readFileSync(solFile, "utf-8")).map(x => ({ t: new Date(x.timestamp).getTime(), p: x.solPrice })) : [];
const solAt = (ms) => { // nearest SOL price within 2h; prefer per-snapshot solPrice when present
  let lo = 0, hi = sol.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (sol[m].t < ms) lo = m + 1; else hi = m; }
  const c = [sol[lo], sol[lo - 1]].filter(Boolean).sort((a, b) => Math.abs(a.t - ms) - Math.abs(b.t - ms))[0];
  return c && Math.abs(c.t - ms) <= 2 * 3.6e6 ? c.p : null;
};

// ─── Per-hour feature rows ───
const rows = [];
for (let i = 5; i < snaps.length; i++) {
  const sig = computeEntrySignals(snaps.slice(0, i + 1));
  if (!sig || sig.organicExchFlow7d === undefined) continue;
  const s = snaps[i], t = new Date(s.timestamp).getTime();
  const r = { t, ts: s.timestamp, p: s.price, sig, sol: s.solPrice || solAt(t), perps: s.perps || null, uniqueOwners: s.uniqueOwners };
  rows.push(r);
}
const T = r => r.t;
const idxAtOrAfter = (ms) => { let lo = 0, hi = rows.length; while (lo < hi) { const m = (lo + hi) >> 1; if (rows[m].t < ms) lo = m + 1; else hi = m; } return lo < rows.length ? lo : -1; };
// forward + trailing returns
for (let i = 0; i < rows.length; i++) {
  const r = rows[i];
  for (const h of [24, 72, 168]) {
    const j = idxAtOrAfter(r.t + h * 3.6e6);
    r[`f${h}`] = j >= 0 && rows[j].t - r.t < h * 3.6e6 * 1.5 ? (rows[j].p / r.p - 1) * 100 : null;
    r[`sf${h}`] = j >= 0 && r.sol && rows[j].sol && rows[j].t - r.t < h * 3.6e6 * 1.5 ? (rows[j].sol / r.sol - 1) * 100 : null;
  }
  const back = (h, key) => { const j = idxAtOrAfter(r.t - h * 3.6e6); if (j < 0 || j >= i || r.t - rows[j].t > h * 3.6e6 * 1.5) return null; const a = key === "p" ? rows[j].p : rows[j].sol, b = key === "p" ? r.p : r.sol; return a && b ? (b / a - 1) * 100 : null; };
  r.ret24 = back(24, "p"); r.sol72 = back(72, "sol"); r.sol24 = back(24, "sol"); r.pump72 = back(72, "p");
  const jo = idxAtOrAfter(r.t - 24 * 3.6e6);
  r.oiChg24 = r.perps && jo >= 0 && jo < i && rows[jo].perps ? (r.perps.openInterest / rows[jo].perps.openInterest - 1) * 100 : null;
}

// ─── Conditions (edit freely — anything you can compute from a row) ───
const CONDS = {
  "BASE RATE (any hour)": r => true,
  // exchange flow
  "Exch organic outflow > 500M (7d)": r => r.sig.organicExchFlow7d < -500e6,
  "Exch organic outflow > 1B (7d)": r => r.sig.organicExchFlow7d < -1e9,
  "Exch organic outflow > 2B (7d)": r => r.sig.organicExchFlow7d < -2e9,
  "Exch organic INFLOW > 500M (7d)": r => r.sig.organicExchFlow7d > 500e6,
  // structure
  "Top-20 distributing (< -0.5pp 7d)": r => r.sig.top20Trend7d < -0.5,
  "Top-20 accumulating (> +0.5pp 7d)": r => r.sig.top20Trend7d > 0.5,
  "LP depth increasing (7d)": r => r.sig.lpIncreasing === true,
  "LP depth decreasing (7d)": r => r.sig.lpIncreasing === false,
  // buyback
  "Revenue accelerating (24h vs 7d)": r => r.sig.revenueAccelerating === true,
  "Yield expanding (24h vs 7d)": r => r.sig.yieldExpanding === true,
  "Buyback yield > 20%": r => r.sig.buybackYield > 20,
  "Buyback yield > 30%": r => r.sig.buybackYield > 30,
  // holders
  "Holder growth cooling (< 500/day)": r => r.sig.holderGrowthPerDay !== null && r.sig.holderGrowthPerDay < 500,
  "Holder growth hot (> 1500/day)": r => r.sig.holderGrowthPerDay > 1500,
  // price-derived
  "Dip: 3d < -5%, no divergence": r => r.sig.isDip && !r.sig.momentumDivergence,
  "Deep dip: 3d < -8%": r => r.sig.priceReturn3d < -8,
  "3d momentum > +5%": r => r.sig.priceReturn3d > 5,
  "3d momentum > +15%": r => r.sig.priceReturn3d > 15,
  "Dead-cat zone: 3d in (-5%, +5%)": r => r.sig.priceReturn3d > -5 && r.sig.priceReturn3d < 5,
  "24h return > +5%": r => r.ret24 > 5,
  "24h return < -5%": r => r.ret24 < -5,
  "7d return > +40% (overextended)": r => r.sig.priceReturn7d > 40,
  "7d return < -10%": r => r.sig.priceReturn7d < -10,
  "Momentum divergence (7d up + inflow)": r => !!r.sig.momentumDivergence,
  // macro / relative
  "SOL 72h trailing > +5%": r => r.sol72 > 5,
  "SOL 72h trailing < -5%": r => r.sol72 < -5,
  "PUMP outperforming SOL (3d)": r => r.pump72 !== null && r.sol72 !== null && r.pump72 - r.sol72 > 5,
  "PUMP lagging SOL (3d)": r => r.pump72 !== null && r.sol72 !== null && r.pump72 - r.sol72 < -5,
  // perps (collection started 2026-10-21 — these fill in over time)
  "OI up > +10% (24h)": r => r.oiChg24 > 10,
  "OI down > -10% (24h)": r => r.oiChg24 < -10,
  "Funding negative (HL)": r => r.perps && r.perps.fundingHourly < 0,
  "Funding > 0.005%/h (crowded long)": r => r.perps && r.perps.fundingHourly > 0.00005,
  // combos the scorer leans on
  "Outflow>500M + LP up + yield expanding": r => r.sig.organicExchFlow7d < -500e6 && r.sig.lpIncreasing && r.sig.yieldExpanding,
  "Outflow>1B + Top-20 distributing": r => r.sig.organicExchFlow7d < -1e9 && r.sig.top20Trend7d < -0.5,
  "Outflow>500M + 3d momentum > +5%": r => r.sig.organicExchFlow7d < -500e6 && r.sig.priceReturn3d > 5,
  "Dip + outflow (scorer confluence)": r => r.sig.dipConfluence,
};

// ─── Stats helpers ───
const mean = v => v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
const win = v => v.length ? v.filter(x => x > 0).length / v.length * 100 : null;
const fmt = (x, d = 1, w = 6) => x === null || x === undefined || isNaN(x) ? "--".padStart(w) : ((x > 0 ? "+" : "") + x.toFixed(d)).padStart(w);
function beta(rs) { // PUMP 24h fwd on SOL 24h fwd, in-window
  const xs = [], ys = [];
  for (const r of rs) if (r.f24 !== null && r.sf24 !== null) { xs.push(r.sf24); ys.push(r.f24); }
  if (xs.length < 10) return null;
  const mx = mean(xs), my = mean(ys);
  let cov = 0, vx = 0; for (let i = 0; i < xs.length; i++) { cov += (xs[i] - mx) * (ys[i] - my); vx += (xs[i] - mx) ** 2; }
  return vx > 0 ? cov / vx : null;
}

// ─── Windows ───
const evalRows = SINCE ? rows.filter(r => r.ts >= SINCE) : rows;
const t0 = evalRows[0].t, tEnd = evalRows[evalRows.length - 1].t;
const windows = [];
for (let ws = t0; ws < tEnd; ws += WINDOW_DAYS * 86400e3) {
  const wr = evalRows.filter(r => r.t >= ws && r.t < ws + WINDOW_DAYS * 86400e3 && r[`f${H}`] !== null);
  if (wr.length >= 20) windows.push({ start: new Date(ws).toISOString().slice(0, 10), rows: wr, beta: beta(wr) });
}

console.log(`${B}PUMP WALK-FORWARD — ${H}h forward returns, ${WINDOW_DAYS}-day windows${R}`);
console.log(`${DIM}${rows.length} scored hours ${rows[0].ts.slice(0, 10)} → ${rows[rows.length - 1].ts.slice(0, 10)} | SOL series: ${sol.length} pts | windows: ${windows.length}${R}\n`);

// base-rate per window
console.log(`${B}Window base rates (buy any hour, hold ${H}h):${R}`);
for (const w of windows) {
  const f = w.rows.map(r => r[`f${H}`]);
  const sf = w.rows.map(r => r[`sf${H}`]).filter(x => x !== null);
  console.log(`  ${w.start}  PUMP ${fmt(mean(f))}%  win ${fmt(win(f), 0, 4)}%  n=${String(f.length).padEnd(4)} SOL ${fmt(mean(sf))}%  beta≈${w.beta === null ? " --" : w.beta.toFixed(2)}`);
}

// ─── Per-condition table ───
const results = [];
for (const [name, pred] of Object.entries(CONDS)) {
  const perWin = [];
  for (const w of windows) {
    const base = mean(w.rows.map(r => r[`f${H}`]));
    const hit = w.rows.filter(r => { try { return !!pred(r); } catch { return false; } });
    if (hit.length < 5) { perWin.push({ n: hit.length, excess: null }); continue; }
    const f = hit.map(r => r[`f${H}`]);
    const resid = w.beta === null ? null : hit.filter(r => r[`sf${H}`] !== null).map(r => r[`f${H}`] - w.beta * r[`sf${H}`]);
    const residBase = w.beta === null ? null : w.rows.filter(r => r[`sf${H}`] !== null).map(r => r[`f${H}`] - w.beta * r[`sf${H}`]);
    perWin.push({ n: hit.length, mean: mean(f), win: win(f), excess: mean(f) - base, residExcess: resid && resid.length ? mean(resid) - mean(residBase) : null });
  }
  const valid = perWin.filter(x => x.excess !== null);
  const allHit = evalRows.filter(r => r[`f${H}`] !== null && (() => { try { return !!pred(r); } catch { return false; } })());
  results.push({
    name, perWin,
    n: allHit.length,
    pooledMean: mean(allHit.map(r => r[`f${H}`])),
    pooledWin: win(allHit.map(r => r[`f${H}`])),
    windowsTested: valid.length,
    windowsPositive: valid.filter(x => x.excess > 0).length,
    avgExcess: mean(valid.map(x => x.excess)),
    avgResidExcess: mean(valid.filter(x => x.residExcess !== null).map(x => x.residExcess)),
  });
}
const score = r => r.windowsTested === 0 ? -Infinity : (r.windowsPositive / r.windowsTested) * 100 + (r.avgExcess ?? 0);
results.sort((a, b) => score(b) - score(a));

console.log(`\n${B}Conditions ranked by consistency (windows with positive excess over that window's base rate), then avg excess:${R}`);
console.log(`${DIM}  "excess" = condition mean − base mate of same window.  "resid" = same after removing SOL beta.  Per-window cells show excess.${R}`);
console.log(`  ${"condition".padEnd(40)} ${"n".padStart(4)} ${"mean".padStart(7)} ${"win".padStart(5)} ${"excess".padStart(7)} ${"resid".padStart(7)}  ${"consist".padStart(7)}   ${windows.map(w => w.start.slice(5)).join("  ")}`);
for (const r of results) {
  const cons = r.windowsTested ? `${r.windowsPositive}/${r.windowsTested}` : "--";
  const col = r.windowsTested >= 3 && r.windowsPositive === r.windowsTested && r.avgExcess > 0 ? GRN : r.windowsTested >= 2 && r.windowsPositive === 0 ? RED : "";
  console.log(`  ${col}${r.name.padEnd(40)}${R} ${String(r.n).padStart(4)} ${fmt(r.pooledMean)}% ${fmt(r.pooledWin, 0, 4)}% ${fmt(r.avgExcess)}% ${fmt(r.avgResidExcess)}%  ${cons.padStart(7)}   ${r.perWin.map(x => x.excess === null ? `${DIM}${("n" + x.n).padStart(6)}${R}` : (x.excess > 0 ? GRN : RED) + fmt(x.excess, 0, 6) + R).join("  ")}`);
}

// ─── Right now ───
const last = rows[rows.length - 1];
console.log(`\n${B}Active right now (${last.ts.slice(0, 16)} UTC, $${last.p.toFixed(6)}):${R}`);
for (const r of results) {
  let on = false; try { on = !!CONDS[r.name](last); } catch {}
  if (!on || r.name.startsWith("BASE")) continue;
  const cons = r.windowsTested ? `${r.windowsPositive}/${r.windowsTested} windows` : "untested";
  console.log(`  • ${r.name.padEnd(40)} pooled ${fmt(r.pooledMean)}% (${fmt(r.pooledWin, 0, 3)}% win, n=${r.n}) | excess ${fmt(r.avgExcess)}% | ${cons}`);
}
console.log(`\n${DIM}Reading guide: trust a condition only if consist ≈ all windows AND excess > 0 AND resid > 0. Anything green here is a candidate, not a rule — re-run after each new window.${R}`);
