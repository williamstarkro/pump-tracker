#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  PUMP forecast scorecard — grades pump-forecast-log.json (written by
//  pump-alerts.js every hourly run) against what the price actually did.
//  This is the only out-of-sample test of the live scorer: every row was
//  written BEFORE the outcome was known.
//
//  Usage: node pump-scorecard.js
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dirname, "pump-forecast-log.json");
const B = "\x1b[1m", R = "\x1b[0m", DIM = "\x1b[2m", GRN = "\x1b[32m", RED = "\x1b[31m";
if (!existsSync(LOG)) { console.log("No forecast log yet — it is written by pump-alerts.js on each hourly run."); process.exit(0); }
const log = JSON.parse(readFileSync(LOG, "utf-8"));
const hist = JSON.parse(readFileSync(join(__dirname, "pump-tracker-history.json"), "utf-8")).map(s => ({ t: new Date(s.timestamp).getTime(), p: s.price })).filter(x => x.p).sort((a, b) => a.t - b.t);
const priceAtOrAfter = (ms, maxLagH = 3) => { let lo = 0, hi = hist.length; while (lo < hi) { const m = (lo + hi) >> 1; if (hist[m].t < ms) lo = m + 1; else hi = m; } return lo < hist.length && hist[lo].t - ms <= maxLagH * 3.6e6 ? hist[lo].p : null; };

const graded = log.map(row => {
  const t = new Date(row.timestamp).getTime();
  const out = { ...row };
  for (const h of [24, 72]) { const p = priceAtOrAfter(t + h * 3.6e6); out[`f${h}`] = p ? (p / row.price - 1) * 100 : null; }
  return out;
});
const mean = v => v.length ? v.reduce((a, b) => a + b, 0) / v.length : null;
const win = v => v.length ? v.filter(x => x > 0).length / v.length * 100 : null;
const fmt = (x, d = 1) => x === null ? "   --" : ((x > 0 ? "+" : "") + x.toFixed(d)).padStart(6);
const n24 = graded.filter(r => r.f24 !== null).length, n72 = graded.filter(r => r.f72 !== null).length;

console.log(`${B}PUMP FORECAST SCORECARD${R}  ${DIM}${log.length} forecasts since ${log[0]?.timestamp.slice(0, 16)} UTC | graded: ${n24} at 24h, ${n72} at 72h | ${log.length - n24} still pending${R}\n`);
function table(title, keyFn) {
  const groups = {};
  for (const r of graded) { const k = keyFn(r); if (k === null || k === undefined) continue; (groups[k] ||= []).push(r); }
  console.log(`${B}${title}${R}`);
  console.log(`  ${"group".padEnd(44)} ${"n".padStart(4)}   ${"24h".padStart(6)} ${"win".padStart(5)}   ${"72h".padStart(6)} ${"win".padStart(5)}`);
  const base24 = mean(graded.map(r => r.f24).filter(x => x !== null)), base72 = mean(graded.map(r => r.f72).filter(x => x !== null));
  for (const [k, rs] of Object.entries(groups).sort((a, b) => b[1].length - a[1].length)) {
    const f24 = rs.map(r => r.f24).filter(x => x !== null), f72 = rs.map(r => r.f72).filter(x => x !== null);
    if (!f24.length) { console.log(`  ${k.padEnd(44)} ${String(rs.length).padStart(4)}   ${DIM}pending${R}`); continue; }
    const c = x => x === null || base72 === null ? "" : x > base72 ? GRN : RED;
    console.log(`  ${k.padEnd(44)} ${String(rs.length).padStart(4)}   ${fmt(mean(f24))}% ${fmt(win(f24), 0)}%   ${c(mean(f72))}${fmt(mean(f72))}%${R} ${fmt(win(f72), 0)}%`);
  }
  console.log(`  ${DIM}${"base rate (all forecasts)".padEnd(44)} ${String(graded.length).padStart(4)}   ${fmt(base24)}%          ${fmt(base72)}%${R}\n`);
}
table("By confirmed tier (what the alerts would have acted on)", r => r.tier);
table("By raw tier (before hysteresis)", r => r.rawTier);
table("By active score component", r => null); // placeholder header; expand below
const comps = {};
for (const r of graded) for (const c of r.components || []) (comps[c] ||= []).push(r);
for (const d of graded.flatMap(r => (r.dangers || []).map(d => [d, r]))) (comps["DANGER: " + d[0]] ||= []).push(d[1]);
console.log(`  ${"component".padEnd(44)} ${"n".padStart(4)}   ${"24h".padStart(6)} ${"win".padStart(5)}   ${"72h".padStart(6)} ${"win".padStart(5)}`);
for (const [k, rs] of Object.entries(comps).sort((a, b) => b[1].length - a[1].length)) {
  const f24 = rs.map(r => r.f24).filter(x => x !== null), f72 = rs.map(r => r.f72).filter(x => x !== null);
  console.log(`  ${k.slice(0, 44).padEnd(44)} ${String(rs.length).padStart(4)}   ${fmt(mean(f24))}% ${fmt(win(f24), 0)}%   ${fmt(mean(f72))}% ${fmt(win(f72), 0)}%`);
}
console.log(`\n${DIM}A tier earns trust when its 72h mean beats the base rate for several weeks running. Until then the scorer stays muted (SCORER_ALERTS=0).${R}`);
