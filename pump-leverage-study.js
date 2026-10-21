#!/usr/bin/env node
// PUMP leveraged-setup study: forward returns AND worst intra-hold move (hourly lows where
// available) for candidate 3-14d long/short triggers, plus the signatures of past drawdowns.
// This is the evidence behind pump-momentum.js. Re-run after each new month of data.
// Usage: node pump-leverage-study.js
import { loadDaily, build, dials, stateOf } from "./pump-regime.js";
import { enrich } from "./pump-portfolio.js";
import { readFileSync } from "fs";
const perps = JSON.parse(readFileSync(new URL("./perps-history.json", import.meta.url), "utf-8"));
const pd = {}; for (const r of perps) { const d = new Date(r.t).toISOString().slice(0, 10); const x = pd[d] ??= { f: [], p: [], v: 0 }; if (r.funding !== undefined) { x.f.push(r.funding); x.p.push(r.premium); } if (r.v) x.v += r.v * r.c; }
const rows = enrich(build(await loadDaily()), pd).filter(r => r.funding7 !== null);
const idx = Object.fromEntries(rows.map((r, i) => [r.d, i]));
// hourly lows/highs from HL candles (since ~Mar 2026); daily-close fallback earlier
const candles = perps.filter(r => r.l !== undefined);
const lowsBetween = (d0, d1) => { const a = Date.parse(d0 + "T00:00:00Z"), b = Date.parse(d1 + "T23:59:59Z"); const c = candles.filter(x => x.t >= a && x.t <= b); return c.length ? { lo: Math.min(...c.map(x => x.l)), hi: Math.max(...c.map(x => x.h)), hourly: true } : null; };
// features
for (let i = 0; i < rows.length; i++) {
  const r = rows[i], w = n => rows.slice(Math.max(0, i - n), i);
  r.p3 = i >= 3 ? (r.price / rows[i - 3].price - 1) * 100 : null;
  r.hi20 = w(20).length ? Math.max(...w(20).map(x => x.price)) : null;
  r.hi30 = w(30).length ? Math.max(...w(30).map(x => x.price)) : null;
  r.lo20 = w(20).length ? Math.min(...w(20).map(x => x.price)) : null;
  r.vol7 = w(7).length ? w(7).reduce((a, x) => a + (x.hlVol || 0), 0) / w(7).length : null;
  r.volX = r.vol7 ? r.hlVol / r.vol7 : null;
  r.s3 = i >= 3 ? (r.sol / rows[i - 3].sol - 1) * 100 : null;
  r.fundChg3 = i >= 3 && rows[i - 3].funding7 !== null ? r.funding7 - rows[i - 3].funding7 : null;
}
function study(name, cond, side = 1, H = [3, 7, 14]) {
  const ev = []; let lastI = -99;
  for (let i = 0; i < rows.length - 14; i++) { const r = rows[i]; let on = false; try { on = !!cond(r); } catch {} if (on && i - lastI >= 3) { ev.push(i); lastI = i; } } // de-cluster: 3-day spacing
  if (!ev.length) { console.log(`\n${name}: no events`); return; }
  const stats = {};
  for (const h of H) {
    const out = ev.map(i => { const r = rows[i], e = rows[Math.min(i + h, rows.length - 1)]; const ret = side * (e.price / r.price - 1) * 100; const lw = lowsBetween(rows[i + 1].d, e.d); let mae; if (lw) mae = side > 0 ? (lw.lo / r.price - 1) * 100 : (1 - lw.hi / r.price) * 100; else { const path = rows.slice(i + 1, i + h + 1).map(x => side * (x.price / r.price - 1) * 100); mae = Math.min(...path); } return { ret, mae, hourly: !!lw }; });
    const rets = out.map(o => o.ret), maes = out.map(o => o.mae);
    stats[h] = { n: out.length, mean: avg(rets), med: med(rets), win: rets.filter(x => x > 0).length / rets.length * 100, maeMed: med(maes), liq3x: maes.filter(m => m <= -30).length / maes.length * 100, liq5x: maes.filter(m => m <= -18).length / maes.length * 100, hourlyN: out.filter(o => o.hourly).length };
  }
  console.log(`\n${name}  (${side > 0 ? "LONG" : "SHORT"}, n=${ev.length} de-clustered entries; dates: ${ev.slice(0, 12).map(i => rows[i].d.slice(2)).join(" ")}${ev.length > 12 ? " …" : ""})`);
  console.log(`  hold   mean     med    win   medMAE  liq@3x  liq@5x  (MAE = worst move against you inside the hold; hourly lows for ${stats[7].hourlyN}/${stats[7].n})`);
  for (const h of H) { const s = stats[h]; console.log(`  ${String(h).padStart(3)}d ${f(s.mean)} ${f(s.med)}  ${s.win.toFixed(0).padStart(4)}%  ${f(s.maeMed)}  ${s.liq3x.toFixed(0).padStart(5)}%  ${s.liq5x.toFixed(0).padStart(5)}%`); }
}
const avg = a => a.reduce((x, y) => x + y, 0) / a.length, med = a => [...a].sort((x, y) => x - y)[Math.floor(a.length / 2)], f = x => ((x >= 0 ? "+" : "") + x.toFixed(1) + "%").padStart(7);
const calm = r => r.funding7 < 20 && (r.premium === null || r.premium < 0.05);
console.log(`Daily rows ${rows[0].d} -> ${rows[rows.length - 1].d}; HL hourly candles from ${new Date(candles[0].t).toISOString().slice(0, 10)}. liq@3x = MAE <= -30% (3x with ~33% buffer); liq@5x = MAE <= -18%.`);
study("BASE: every 3rd day", r => true);
study("L1 20d breakout + fees accel + calm", r => r.hi20 && r.price > r.hi20 && r.fees7v30 > 10 && calm(r));
study("L2 20d breakout + calm (any fees)", r => r.hi20 && r.price > r.hi20 && calm(r));
study("L3 fee accel>15 + 3d mom>5 + calm", r => r.fees7v30 > 15 && r.p3 > 5 && calm(r));
study("L4 SOL 3d>+5 & PUMP lagging SOL + fees ON", r => r.s3 > 5 && r.p3 < r.s3 && r.dials.FEES);
study("L5 volume 2x 7d avg + up day + calm", r => r.volX > 2 && r.p3 > 0 && calm(r));
study("L6 volume 2x + funding rising fast (late/blowoff?)", r => r.volX > 2 && r.fundChg3 > 10);
study("L7 regime>=2 + fees accel>10 + calm (tactical rule)", r => r.state >= 2 && r.fees7v30 > 10 && calm(r) && r.p7 < 30);
study("L8 3/3 + 7d dip < -8% + calm (buy dip in on-regime)", r => r.state === 3 && r.p7 < -8 && calm(r));
study("L9 fees30v90>+20 & 20d breakout", r => r.fees30v90 > 20 && r.hi20 && r.price > r.hi20);
console.log("\n──────── SHORT SIDE ────────");
study("S1 crowded (fund7>35 or prem>0.08) after 7d > +25%", r => (r.funding7 > 35 || (r.premium !== null && r.premium > 0.08)) && r.p7 > 25, -1);
study("S2 fees decel (<-10) + SOL 7d<0 + 3d<0", r => r.fees7v30 < -10 && r.s7 < 0 && r.p3 < 0, -1);
study("S3 fees30v90 < -10 + 20d low break", r => r.fees30v90 < -10 && r.lo20 && r.price < r.lo20, -1);
study("S4 20d low break + SOL 7d < -5", r => r.lo20 && r.price < r.lo20 && r.s7 < -5, -1);
study("S5 7d > +40% & vol 2x (blowoff fade)", r => r.p7 > 40 && r.volX > 1.8, -1);
// drawdown signatures
console.log("\n──────── DRAWDOWN SIGNATURES ────────");
const peaks = [["2025-10-13", "2025-12-18"], ["2026-01-25", "2026-02-23"], ["2026-05-11", "2026-06-24"], ["2026-10-05", "2026-10-19"]];
for (const [a, b] of peaks) { const ra = rows[idx[a]], rb = rows[idx[b]]; if (!ra || !rb) continue; console.log(`  ${a} -> ${b}: PUMP ${f((rb.price / ra.price - 1) * 100)} SOL ${f((rb.sol / ra.sol - 1) * 100)} | at start: state ${ra.state} fees7v30 ${f(ra.fees7v30)} fees30v90 ${f(ra.fees30v90)} fund7 ${ra.funding7.toFixed(0)}% prem ${ra.premium?.toFixed(3)}% p30 ${f(ra.p30)} yld ${ra.yld.toFixed(0)}% | at end: fees30v90 ${f(rb.fees30v90)} yld ${rb.yld.toFixed(0)}%`); }
console.log(`  NOW ${rows[rows.length - 1].d}: state ${rows[rows.length - 1].state} fees7v30 ${f(rows[rows.length - 1].fees7v30)} fees30v90 ${f(rows[rows.length - 1].fees30v90)} fund7 ${rows[rows.length - 1].funding7.toFixed(0)}% prem ${rows[rows.length - 1].premium?.toFixed(3)}% p30 ${f(rows[rows.length - 1].p30)} yld ${rows[rows.length - 1].yld.toFixed(0)}% | price to $0.003 = ${f((0.003 / rows[rows.length - 1].price - 1) * 100)}, to $0.002 = ${f((0.002 / rows[rows.length - 1].price - 1) * 100)}; yield at $0.003 ≈ ${(rows[rows.length - 1].yld * rows[rows.length - 1].price / 0.003).toFixed(0)}%, at $0.002 ≈ ${(rows[rows.length - 1].yld * rows[rows.length - 1].price / 0.002).toFixed(0)}% (if fees unchanged)`);
