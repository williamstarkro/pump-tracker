#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  PUMP medium-term regime model (3–30 day horizon). Runs daily.
//
//  Three dials, each ON or OFF, read from daily data:
//    SOL    — SOL 30d trend positive            (PUMP 30d beta to SOL ≈ 1.3)
//    FEES   — pump.fun fee base not shrinking   (30d avg vs 90d avg > -10%)
//    PRICE  — PUMP not in a deepening drawdown  (30d ret > -10% and < 40% below 90d high)
//  Regime state = number of dials ON (0–3). Size from holder-flow yield vs its own 90d.
//
//  Holder-directed flow = 100% of fees before 2026-04-01, 50% after (buyback share).
//  Realized on-chain burn$/fees ≈ 0.50 in Jul–Oct 2026 confirms the 50%.
//
//  Notifies only on a dial flip or state change. Logs every day to pump-regime-log.json
//  and prints the in-sample forward-30d table by state so the evidence is always visible.
//  Everything here is tested on ~2 regimes (down Oct25–Jun26, up Jul–Sep26). Directional.
//
//  Usage: node pump-regime.js [--no-notify] [--quiet]
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, "pump-regime-state.json");
const LOG_FILE = join(__dirname, "pump-regime-log.json");
const NTFY_TOPIC = process.env.NTFY_TOPIC || "pump-entry-signal-wx7k2m";
const args = new Set(process.argv.slice(2));
const B = "\x1b[1m", R = "\x1b[0m", DIM = "\x1b[2m", GRN = "\x1b[32m", RED = "\x1b[31m", YEL = "\x1b[33m";

// ─── Rules (tune here; keep them few and legible) ───
const RULES = {
  solTrendDays: 30,            // SOL dial: return over this many days > 0
  feesShrinkPct: -10,          // FEES dial: fees30/fees90 - 1 must exceed this
  priceRet30Floor: -10,        // PRICE dial: 30d return must exceed this ...
  priceDD90Floor: -40,         //  ... and drawdown from 90d high must exceed this
  cheapRelYieldPct: 10,        // relYld above this => "full" size; below -10 => "half"
  shareBefore: 1.0, shareAfter: 0.5, shareChange: "2026-04-01",
};
const PUMP_MINT = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn";

// ─── Data ───
async function getJSON(url) { const r = await fetch(url); if (!r.ok) throw new Error(`${url} -> HTTP ${r.status}`); return r.json(); }
// coins.llama.fi stamps days anywhere from 23:59:59 to 00:00:01 — round to the nearest UTC day
const dayKey = (ms) => new Date(Math.round(ms / 864e5) * 864e5).toISOString().slice(0, 10);
async function loadDaily() {
  const start = Math.floor(new Date("2025-07-01T00:00:00Z").getTime() / 1000);
  const [fees, pumpPx, solPx] = await Promise.all([
    getJSON("https://api.llama.fi/summary/fees/pump.fun?dataType=dailyFees"),
    getJSON(`https://coins.llama.fi/chart/solana:${PUMP_MINT}?start=${start}&span=500&period=1d`),
    getJSON(`https://coins.llama.fi/chart/coingecko:solana?start=${start}&span=500&period=1d`),
  ]);
  let mcap = {};
  try { const cg = await getJSON("https://api.coingecko.com/api/v3/coins/pump-fun/market_chart?vs_currency=usd&days=365&interval=daily"); for (const [t, v] of cg.market_caps) mcap[dayKey(t)] = v; } catch (e) { console.error("  CoinGecko mcap unavailable:", e.message); }
  const F = {}; for (const [t, v] of fees.totalDataChart) F[dayKey(t * 1000)] = v;
  const P = {}; for (const p of Object.values(pumpPx.coins)[0].prices) P[dayKey(p.timestamp * 1000)] = p.price;
  const S = {}; for (const p of Object.values(solPx.coins)[0].prices) S[dayKey(p.timestamp * 1000)] = p.price;
  // Complete calendar from first PUMP day to the last complete fee day, forward-filling gaps
  const today = new Date().toISOString().slice(0, 10);
  const firstDay = Object.keys(P).sort()[0];
  const lastDay = Object.keys(F).filter(d => d < today && P[d]).sort().pop();
  const days = []; let lp = null, ls = null, lf = null;
  for (let t = new Date(firstDay).getTime(); dayKey(t) <= lastDay; t += 864e5) {
    const d = dayKey(t);
    if (P[d] !== undefined) lp = P[d]; else if (lp !== null) P[d] = lp;
    if (S[d] !== undefined) ls = S[d]; else if (ls !== null) S[d] = ls;
    if (F[d] !== undefined) lf = F[d]; else if (lf !== null) F[d] = lf;
    if (P[d] !== undefined && S[d] !== undefined && F[d] !== undefined) days.push(d);
  }
  return { days, F, P, S, mcap, circFallback: 0.46e12 };
}

// ─── Features ───
function build(data) {
  const { days, F, P, S, mcap, circFallback } = data;
  const share = d => d >= RULES.shareChange ? RULES.shareAfter : RULES.shareBefore;
  const avg = (arr) => arr.reduce((a, b) => a + b, 0) / arr.length;
  const rows = [];
  for (let i = 0; i < days.length; i++) {
    if (i < 90) continue;
    const d = days[i];
    const win = n => days.slice(i - n + 1, i + 1);
    const flow = n => avg(win(n).map(x => share(x) * F[x]));
    const ret = (ser, n) => (ser[d] / ser[days[i - n]] - 1) * 100;
    const mc = mcap[d] || P[d] * circFallback;
    const hi90 = Math.max(...win(90).map(x => P[x]));
    const r = {
      d, price: P[d], sol: S[d], mcap: mc,
      fees7: avg(win(7).map(x => F[x])), fees30: avg(win(30).map(x => F[x])), fees90: avg(win(90).map(x => F[x])),
      flow30: flow(30),
      p7: ret(P, 7), p30: ret(P, RULES.solTrendDays), s7: ret(S, 7), s30: ret(S, RULES.solTrendDays),
      dd90: (P[d] / hi90 - 1) * 100, hi90,
      price30ago: P[days[i - 30]], sol30ago: S[days[i - RULES.solTrendDays]],
    };
    r.fees30v90 = (r.fees30 / r.fees90 - 1) * 100;
    r.fees7v30 = (r.fees7 / r.fees30 - 1) * 100;
    r.yld = r.flow30 * 365 / mc * 100;
    rows.push(r);
  }
  for (let i = 0; i < rows.length; i++) {
    const w = rows.slice(Math.max(0, i - 89), i + 1);
    rows[i].relYld = w.length >= 30 ? (rows[i].yld / avg(w.map(x => x.yld)) - 1) * 100 : null;
    const j = rows.findIndex(x => x.d > rows[i].d && (new Date(x.d) - new Date(rows[i].d)) >= 30 * 864e5);
    rows[i].f30 = j > 0 ? (rows[j].price / rows[i].price - 1) * 100 : null;
    rows[i].sf30 = j > 0 ? (rows[j].sol / rows[i].sol - 1) * 100 : null;
  }
  return rows;
}
function dials(r) {
  return {
    SOL: r.s30 > 0,
    FEES: r.fees30v90 > RULES.feesShrinkPct,
    PRICE: r.p30 > RULES.priceRet30Floor && r.dd90 > RULES.priceDD90Floor,
  };
}
const stateOf = r => Object.values(dials(r)).filter(Boolean).length;
const sizing = r => r.relYld === null ? "standard" : r.relYld > RULES.cheapRelYieldPct ? "full (cheap vs own 90d)" : r.relYld < -RULES.cheapRelYieldPct ? "half (rich vs own 90d)" : "standard";
const guidance = (st, r) => st === 3 ? `3/3 ON — regime on. Size: ${sizing(r)}.` : st === 2 ? `2/3 ON — constructive. Half of ${sizing(r)} size; add on the third dial.` : st === 1 ? "1/3 ON — no edge. Flat or core only." : "0/3 ON — regime off. Flat.";

// ─── Notify ───
async function notify(title, message, priority = 3) {
  if (args.has("--no-notify")) { console.log(`\n  [no-notify] ${title}\n  ${message}\n`); return; }
  try {
    const sanitize = s => s.replace(/[^\x20-\x7E]/g, c => ({ "—": "--", "–": "-", "≈": "~", "→": "->" }[c] || ""));
    const resp = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, { method: "POST", headers: { Title: sanitize(title), Priority: String(priority), Tags: priority >= 4 ? "rotating_light" : "bar_chart" }, body: sanitize(message) });
    if (!resp.ok) console.error("  ntfy failed:", resp.status);
    else console.log(`\n  SENT: ${title}`);
  } catch (e) { console.error("  ntfy failed:", e.message); }
}

// ─── Main ───
async function main() {
  const data = await loadDaily();
  const rows = build(data);
  const now = rows[rows.length - 1];
  const D = dials(now), st = stateOf(now);
  const q = r => `${r.d.slice(0, 4)}Q${Math.floor((+r.d.slice(5, 7) - 1) / 3) + 1}`;
  const quiet = args.has("--quiet");

  console.log(`${B}PUMP REGIME — ${now.d} (last complete day)${R}`);
  console.log(`  PUMP $${now.price.toFixed(5)}  SOL $${now.sol.toFixed(2)}  mcap $${(now.mcap / 1e9).toFixed(2)}B  fees7 $${(now.fees7 / 1e6).toFixed(2)}M/d  fees30 $${(now.fees30 / 1e6).toFixed(2)}M/d  holder flow30 $${(now.flow30 / 1e6).toFixed(2)}M/d\n`);
  const onoff = v => v ? GRN + "ON " + R : RED + "OFF" + R;
  console.log(`${B}Dials${R}`);
  console.log(`  ${onoff(D.SOL)}  SOL     30d ${fmtp(now.s30)} (7d ${fmtp(now.s7)})            flips ${D.SOL ? "OFF" : "ON"} if SOL ${D.SOL ? "<" : ">"} $${now.sol30ago.toFixed(2)} (its price 30d ago)`);
  console.log(`  ${onoff(D.FEES)}  FEES    30d vs 90d ${fmtp(now.fees30v90)} (7d vs 30d ${fmtp(now.fees7v30)})  flips ${D.FEES ? "OFF" : "ON"} if 30d avg ${D.FEES ? "<" : ">"} $${(now.fees90 * (1 + RULES.feesShrinkPct / 100) / 1e6).toFixed(2)}M/d`);
  console.log(`  ${onoff(D.PRICE)}  PRICE   30d ${fmtp(now.p30)}, ${fmtp(now.dd90)} vs 90d high   flips ${D.PRICE ? "OFF" : "ON"} below $${Math.max(now.price30ago * (1 + RULES.priceRet30Floor / 100), now.hi90 * (1 + RULES.priceDD90Floor / 100)).toFixed(5)}`);
  const histAll = rows; let streak = 1; for (let i = histAll.length - 2; i >= 0 && stateOf(histAll[i]) === st; i--) streak++;
  console.log(`\n  ${B}State: ${st}/3${R} — ${guidance(st, now)}  ${DIM}(${streak} consecutive day${streak === 1 ? "" : "s"} in this state)${R}`);
  console.log(`  Holder-flow yield ${now.yld.toFixed(0)}%  (${now.relYld === null ? "n/a" : fmtp(now.relYld)} vs own 90d)`);

  // Since-launch residual: is the buyback showing up as drift?
  const first = rows[0]; const pumpAll = (now.price / first.price - 1) * 100, solAll = (now.sol / first.sol - 1) * 100;
  const pairs = rows.filter(r => r.f30 !== null && r.sf30 !== null); const mx = avg(pairs.map(r => r.sf30)), my = avg(pairs.map(r => r.f30));
  const beta = pairs.reduce((a, r) => a + (r.sf30 - mx) * (r.f30 - my), 0) / pairs.reduce((a, r) => a + (r.sf30 - mx) ** 2, 0);
  console.log(`\n${B}SOL beta check${R}  since ${first.d}: PUMP ${fmtp(pumpAll)}, SOL ${fmtp(solAll)}, beta(30d) ${beta.toFixed(2)} => SOL-implied ${fmtp(solAll * beta)}, residual ${fmtp(pumpAll - solAll * beta)} ${DIM}(≈ holder-flow drift + fee growth)${R}`);

  // Evidence table: fwd 30d by state, overall and by quarter (in-sample rule design — directional)
  if (!quiet) {
    const hist = rows.filter(r => r.f30 !== null);
    console.log(`\n${B}Evidence (in-sample): forward 30d return by state${R}  ${DIM}n = days, overlapping; ~2 regimes in sample${R}`);
    const qs = [...new Set(hist.map(q))];
    console.log(`  ${"state".padEnd(7)} ${"n".padStart(4)} ${"mean".padStart(7)} ${"med".padStart(7)} ${"win".padStart(5)}   ${qs.join("   ")}`);
    for (let s = 0; s <= 3; s++) {
      const rs = hist.filter(r => stateOf(r) === s); if (!rs.length) continue;
      const v = rs.map(r => r.f30);
      const byQ = qs.map(qq => { const w = rs.filter(r => q(r) === qq).map(r => r.f30); return w.length >= 5 ? `${fmtp(avg(w), 0).padStart(5)}(${w.length})` : `${DIM}   n${w.length}${R}  `; });
      console.log(`  ${String(s + "/3").padEnd(7)} ${String(v.length).padStart(4)} ${fmtp(avg(v)).padStart(7)} ${fmtp(median(v)).padStart(7)} ${(v.filter(x => x > 0).length / v.length * 100).toFixed(0).padStart(4)}%   ${byQ.join("  ")}`);
    }
    // Trigger vs persistence: the day a regime turns on has been a whipsaw; a regime that has HELD is where returns were
    const stat = (rs) => rs.length ? `n=${rs.length} fwd30 mean ${fmtp(avg(rs.map(r => r.f30)))}, win ${(rs.filter(r => r.f30 > 0).length / rs.length * 100).toFixed(0)}%` : "n=0";
    const sts = hist.map(stateOf);
    const flipsUp = hist.filter((r, i) => i > 0 && sts[i - 1] <= 1 && sts[i] >= 2);
    const flipsTo3 = hist.filter((r, i) => i > 0 && sts[i - 1] < 3 && sts[i] === 3);
    const held = (min, days) => hist.filter((r, i) => i >= days && sts.slice(i - days + 1, i + 1).every(x => x >= min));
    console.log(`  ${DIM}Day a regime turns on (<=1 -> >=2):      ${stat(flipsUp)}${R}`);
    console.log(`  ${DIM}Day it reaches 3/3:                      ${stat(flipsTo3)}${R}`);
    console.log(`  ${DIM}>=2/3 held 7+ consecutive days:          ${stat(held(2, 7))}${R}`);
    console.log(`  ${DIM}3/3 held 7+ consecutive days:            ${stat(held(3, 7))}${R}`);
    console.log(`  ${DIM}<=1/3 held 7+ consecutive days:          ${stat(held(1, 7).filter((r, i, a) => true).filter(r => stateOf(r) <= 1))}${R}`);
  }

  // State machine + notifications (only on change)
  const prev = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf-8")) : null;
  const changed = !prev || prev.state !== st || ["SOL", "FEES", "PRICE"].some(k => prev.dials[k] !== D[k]);
  if (changed && prev && prev.day === now.d) { /* same day re-run, already handled */ }
  else if (changed) {
    const flips = prev ? ["SOL", "FEES", "PRICE"].filter(k => prev.dials[k] !== D[k]).map(k => `${k} -> ${D[k] ? "ON" : "OFF"}`).join(", ") : "initial read";
    const priority = st === 3 ? 5 : (prev && prev.state >= 2 && st <= 1) ? 4 : st === 2 ? 4 : 3;
    const title = prev ? `PUMP REGIME ${prev.state}/3 -> ${st}/3: ${flips}` : `PUMP REGIME ${st}/3 (initial)`;
    const msg = [
      guidance(st, now) + ` Day ${streak} in this state; in-sample, regimes that held 7+ days paid, the flip day itself did not.`,
      `SOL ${D.SOL ? "ON" : "OFF"} (30d ${fmtp(now.s30)}; flips at $${now.sol30ago.toFixed(2)}).`,
      `FEES ${D.FEES ? "ON" : "OFF"} (30d vs 90d ${fmtp(now.fees30v90)}, 7d vs 30d ${fmtp(now.fees7v30)}).`,
      `PRICE ${D.PRICE ? "ON" : "OFF"} (30d ${fmtp(now.p30)}, ${fmtp(now.dd90)} vs 90d high).`,
      `Yield ${now.yld.toFixed(0)}% (${now.relYld === null ? "n/a" : fmtp(now.relYld)} vs own 90d). PUMP $${now.price.toFixed(5)}.`,
    ].join(" ");
    await notify(title, msg, priority);
  } else {
    console.log(`\n  ${DIM}No change in dials since ${prev.day} — no notification.${R}`);
  }
  writeFileSync(STATE_FILE, JSON.stringify({ day: now.d, state: st, dials: D, updated: new Date().toISOString() }, null, 2));
  const log = existsSync(LOG_FILE) ? JSON.parse(readFileSync(LOG_FILE, "utf-8")) : [];
  if (!log.length || log[log.length - 1].d !== now.d) {
    log.push({ d: now.d, price: now.price, sol: now.sol, mcap: now.mcap, fees7: now.fees7, fees30: now.fees30, fees90: now.fees90, flow30: now.flow30, yld: now.yld, relYld: now.relYld, p7: now.p7, p30: now.p30, s7: now.s7, s30: now.s30, dd90: now.dd90, fees30v90: now.fees30v90, fees7v30: now.fees7v30, dials: D, state: st });
    writeFileSync(LOG_FILE, JSON.stringify(log));
  }
  console.log(`  ${DIM}Regime log: ${log.length} days${R}\n`);
}
function fmtp(x, d = 1) { return x === null || x === undefined || isNaN(x) ? "n/a" : (x > 0 ? "+" : "") + x.toFixed(d) + "%"; }
function avg(a) { return a.reduce((x, y) => x + y, 0) / a.length; }
function median(a) { const s = [...a].sort((x, y) => x - y); return s[Math.floor(s.length / 2)]; }
main().catch(e => { console.error(e); process.exit(1); });
