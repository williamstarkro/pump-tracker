#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  PUMP position framework — core spot + tactical leverage + optional SOL hedge.
//
//  CORE (spot, always on):  exposure by regime state  0:0.25 1:0.50 2:0.75 3:1.00
//      — never flat, so the buyback drift is always being collected.
//  TACTICAL (leverage, perps): +0.5x on top of core when the MECHANISM is firing:
//      regime >= 2/3, fees accelerating (7d avg > 30d avg by 10%+), positioning calm
//      (7d funding < 20%/yr, premium < 0.05%), and no blowoff (7d price < +30%).
//      Closes when fees decelerate (7d < 30d by 5%), regime < 2/3, positioning
//      crowded (funding > 40%/yr or premium > 0.08%), or a 7d drop > 15%.
//      Pays realized Hyperliquid funding on the leveraged notional.
//      In-sample this caught Jul 3 -> Aug 21 2026 (+103% per 1x) and lost ~20% on
//      three re-entries after tops. Expect ~40% hit rate; the edge is one big window
//      per cycle, so the leg is sized to survive the whipsaws.
//  HEDGE (optional): short beta x SOL against core when the SOL dial is OFF,
//      isolating the buyback/fee residual.
//
//  Backtest is daily since Oct 2025 (first day with 90d of history), next-day
//  close-to-close, no fees/slippage, in-sample rules. ~2 regimes. Directional.
//
//  Usage: node pump-portfolio.js [--no-notify] [--quiet]
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { loadDaily, build, dials, stateOf } from "./pump-regime.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, "pump-portfolio-state.json");
const LOG_FILE = join(__dirname, "pump-portfolio-log.json");
const NTFY_TOPIC = process.env.NTFY_TOPIC || "";
const args = new Set(process.argv.slice(2));
const B = "\x1b[1m", R = "\x1b[0m", DIM = "\x1b[2m", GRN = "\x1b[32m", RED = "\x1b[31m", YEL = "\x1b[33m";

export const P = {
  core: { 0: 0.25, 1: 0.5, 2: 0.75, 3: 1.0 },
  tactical: { size: 0.5, minState: 2, minFeeAccel: 10, exitFeeAccel: -5, maxFunding7: 20, maxPremium: 0.05, maxP7: 30, exitFunding7: 40, exitPremium: 0.08, exitP7: -15 },
  hedge: { beta: 1.3 },
};

// ─── perps daily aggregates ───
function perpsDaily() {
  const f = join(__dirname, "perps-history.json"); if (!existsSync(f)) return {};
  const out = {};
  for (const r of JSON.parse(readFileSync(f, "utf-8"))) {
    const d = new Date(r.t).toISOString().slice(0, 10); const x = out[d] ??= { f: [], p: [], v: 0 };
    if (r.funding !== undefined) { x.f.push(r.funding); x.p.push(r.premium); } if (r.v) x.v += r.v * r.c;
  }
  return out;
}
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;

export function enrich(rows, pd) {
  const days = Object.keys(pd).sort();
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i];
    const last7 = days.filter(d => d <= r.d).slice(-7);
    const f = last7.flatMap(d => pd[d].f);
    r.funding7 = f.length ? avg(f) * 24 * 365 * 100 : null;              // annualized %
    r.fundingDay = pd[r.d] ? pd[r.d].f.reduce((a, b) => a + b, 0) : 0;   // sum of hourly rates that day (fraction)
    r.premium = pd[r.d] && pd[r.d].p.length ? avg(pd[r.d].p) * 100 : null;
    r.hlVol = pd[r.d]?.v ?? null;
    r.state = stateOf(r); r.dials = dials(r);
    r.streak = 1; for (let j = i - 1; j >= 0 && rows[j].state === r.state; j--) r.streak++;
  }
  return rows;
}
const crowded = r => (r.funding7 !== null && r.funding7 > P.tactical.exitFunding7) || (r.premium !== null && r.premium > P.tactical.exitPremium);
const T = P.tactical;
const tacticalOK = r => r.state >= T.minState && r.fees7v30 > T.minFeeAccel && r.funding7 !== null && r.funding7 < T.maxFunding7 && (r.premium === null || r.premium < T.maxPremium) && r.p7 < T.maxP7;
const tacticalExit = r => r.state < T.minState || r.fees7v30 < T.exitFeeAccel || crowded(r) || r.p7 < T.exitP7;

// ─── simulate ───
export function simulate(rows) {
  const strat = { "Buy & hold": [], "Core by state": [], "Core + tactical": [], "Core + tactical + SOL hedge": [], "Hedged carry (fees ON only)": [] };
  const eq = Object.fromEntries(Object.keys(strat).map(k => [k, 1])), path = Object.fromEntries(Object.keys(strat).map(k => [k, []]));
  let tactOpen = false; const windows = []; let w = null;
  for (let i = 0; i < rows.length - 1; i++) {
    const r = rows[i], n = rows[i + 1];
    const rp = n.price / r.price - 1, rs = n.sol / r.sol - 1;
    // tactical state machine (decided on day i close, applied to i->i+1 return)
    if (!tactOpen && tacticalOK(r)) { tactOpen = true; w = { open: r.d, px: r.price, pnl: 0 }; }
    else if (tactOpen && tacticalExit(r)) { tactOpen = false; w.close = r.d; w.closePx = r.price; windows.push(w); w = null; }
    if (w) { w.pnl += P.tactical.size * rp - P.tactical.size * n.fundingDay; }
    const core = P.core[r.state];
    const tact = tactOpen ? P.tactical.size : 0;
    const hedge = r.dials.SOL ? 0 : P.hedge.beta * core;
    const ret = {
      "Buy & hold": rp,
      "Core by state": core * rp,
      "Core + tactical": core * rp + tact * (rp - n.fundingDay),
      "Core + tactical + SOL hedge": core * rp + tact * (rp - n.fundingDay) - hedge * rs,
      "Hedged carry (fees ON only)": r.dials.FEES ? rp - P.hedge.beta * rs : 0,
    };
    for (const k of Object.keys(strat)) { strat[k].push(ret[k]); eq[k] *= 1 + ret[k]; path[k].push({ d: n.d, eq: eq[k] }); }
  }
  if (w) { w.close = "open"; w.closePx = rows[rows.length - 1].price; windows.push(w); }
  return { strat, eq, path, windows, tactOpen };
}
function metrics(rets, path) {
  const n = rets.length, total = path[path.length - 1].eq - 1, years = n / 365;
  const cagr = Math.pow(1 + total, 1 / years) - 1;
  const m = avg(rets), sd = Math.sqrt(avg(rets.map(x => (x - m) ** 2)));
  const sharpe = sd ? m / sd * Math.sqrt(365) : 0;
  let peak = 1, mdd = 0; for (const p of path) { peak = Math.max(peak, p.eq); mdd = Math.min(mdd, p.eq / peak - 1); }
  const byQ = {}; for (let i = 0; i < rets.length; i++) { const q = `${path[i].d.slice(0, 4)}Q${Math.floor((+path[i].d.slice(5, 7) - 1) / 3) + 1}`; byQ[q] = (byQ[q] ?? 1) * (1 + rets[i]); }
  return { total, cagr, sharpe, mdd, byQ: Object.fromEntries(Object.entries(byQ).map(([k, v]) => [k, v - 1])) };
}
const pct = (x, d = 0) => (x >= 0 ? "+" : "") + (x * 100).toFixed(d) + "%";

async function notify(title, message, priority = 3) {
  if (args.has("--no-notify")) { console.log(`\n  [no-notify] ${title}\n  ${message}\n`); return; }
  if (!NTFY_TOPIC) { console.log(`  [no NTFY_TOPIC] ${title}`); return; }
  try { const s = x => x.replace(/[^\x20-\x7E]/g, c => ({ "—": "--", "→": "->", "≥": ">=", "×": "x" }[c] || "")); const r = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, { method: "POST", headers: { Title: s(title), Priority: String(priority), Tags: priority >= 4 ? "rotating_light" : "briefcase" }, body: s(message) }); console.log(r.ok ? `\n  SENT: ${title}` : `  ntfy failed: ${r.status}`); } catch (e) { console.error("  ntfy failed:", e.message); }
}

async function main() {
  const rows = enrich(build(await loadDaily()), perpsDaily()).filter(r => r.funding7 !== null);
  const sim = simulate(rows);
  const now = rows[rows.length - 1];
  const quiet = args.has("--quiet");

  console.log(`${B}PUMP POSITION FRAMEWORK — ${now.d}${R}`);
  console.log(`  State ${now.state}/3 (day ${now.streak})  |  7d funding ${now.funding7.toFixed(0)}%/yr  premium ${now.premium === null ? "n/a" : now.premium.toFixed(3) + "%"}  |  PUMP $${now.price.toFixed(5)}  SOL $${now.sol.toFixed(2)}\n`);

  if (!quiet) {
    console.log(`${B}Backtest ${rows[0].d} → ${now.d} (daily, in-sample rules, no fees/slippage; tactical pays realized funding)${R}`);
    const qs = [...new Set(Object.values(sim.path)[0].map(p => `${p.d.slice(0, 4)}Q${Math.floor((+p.d.slice(5, 7) - 1) / 3) + 1}`))];
    console.log(`  ${"strategy".padEnd(30)} ${"total".padStart(7)} ${"CAGR".padStart(7)} ${"Sharpe".padStart(7)} ${"maxDD".padStart(7)}   ${qs.join("   ")}`);
    for (const k of Object.keys(sim.strat)) { const m = metrics(sim.strat[k], sim.path[k]); console.log(`  ${k.padEnd(30)} ${pct(m.total).padStart(7)} ${pct(m.cagr).padStart(7)} ${m.sharpe.toFixed(2).padStart(7)} ${pct(m.mdd).padStart(7)}   ${qs.map(q => pct(m.byQ[q] ?? 0).padStart(6)).join("   ")}`); }
    console.log(`\n${B}Tactical windows (regime >= ${T.minState}/3, fees 7d > 30d by ${T.minFeeAccel}%+, funding < ${T.maxFunding7}%/yr, premium < ${T.maxPremium}%, 7d price < +${T.maxP7}%)${R}`);
    if (!sim.windows.length) console.log("  none");
    for (const w of sim.windows) console.log(`  ${w.open} → ${w.close.padEnd(10)}  $${w.px.toFixed(5)} → $${w.closePx.toFixed(5)}  leg P&L ${pct(w.pnl / T.size, 1)} per 1x (net of funding; leg is ${T.size}x)`);
  }

  // ─── Recommendation ───
  const core = P.core[now.state];
  const tactNow = sim.tactOpen;
  const hedgeNow = !now.dials.SOL;
  console.log(`\n${B}Recommendation${R}`);
  console.log(`  CORE (spot):     ${GRN}${(core * 100).toFixed(0)}% of core allocation${R}  ${DIM}(state ${now.state}/3)${R}`);
  const why = tactNow ? `exit if regime < ${T.minState}/3, fees 7d vs 30d < ${T.exitFeeAccel}%, funding > ${T.exitFunding7}%/yr, premium > ${T.exitPremium}%, or 7d drop > ${-T.exitP7}%`
    : [now.state < T.minState ? `regime ${now.state}/3 (needs ${T.minState})` : null, now.fees7v30 <= T.minFeeAccel ? `fees 7d vs 30d ${now.fees7v30.toFixed(0)}% (needs > +${T.minFeeAccel}%)` : null, now.funding7 >= T.maxFunding7 ? `funding ${now.funding7.toFixed(0)}%/yr (needs < ${T.maxFunding7})` : null, now.premium !== null && now.premium >= T.maxPremium ? `premium ${now.premium.toFixed(3)}%` : null, now.p7 >= T.maxP7 ? `7d price +${now.p7.toFixed(0)}% (blowoff veto)` : null].filter(Boolean).join("; ") || "conditions met";
  console.log(`  TACTICAL (lev):  ${tactNow ? GRN + "OPEN +" + T.size + "x" : RED + "CLOSED"}${R}  ${DIM}${why}${R}`);
  console.log(`  SOL HEDGE:       ${hedgeNow ? YEL + "ON — short " + (P.hedge.beta * core).toFixed(2) + "x SOL vs core" : DIM + "off (SOL dial ON)"}${R}  ${DIM}optional; isolates buyback/fee residual while SOL trend is down${R}`);
  console.log(`  POSITIONING:     ${crowded(now) ? RED + "CROWDED — no adds, trim tactical" : now.funding7 > P.tactical.maxFunding7 ? YEL + "warm — no new leverage" : GRN + "calm"}${R}  ${DIM}7d funding ${now.funding7.toFixed(0)}%/yr, premium ${now.premium === null ? "n/a" : now.premium.toFixed(3) + "%"}${R}`);

  // ─── notifications on tactical open/close and crowding ───
  const prev = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf-8")) : null;
  const cur = { day: now.d, state: now.state, core, tactical: tactNow, hedge: hedgeNow, crowded: crowded(now) };
  if (prev && prev.day !== now.d) {
    if (cur.tactical && !prev.tactical) await notify(`PUMP TACTICAL WINDOW OPEN (+${T.size}x)`, `Regime ${now.state}/3, fees 7d vs 30d +${now.fees7v30.toFixed(0)}%, funding ${now.funding7.toFixed(0)}%/yr, premium ${now.premium?.toFixed(3)}%, 7d price ${now.p7 >= 0 ? "+" : ""}${now.p7.toFixed(0)}%. Core ${(core * 100).toFixed(0)}%. Exit: fees 7d vs 30d < ${T.exitFeeAccel}%, regime < ${T.minState}/3, funding > ${T.exitFunding7}%/yr, premium > ${T.exitPremium}%, 7d drop > ${-T.exitP7}%. PUMP $${now.price.toFixed(5)}.`, 5);
    if (!cur.tactical && prev.tactical) await notify(`PUMP TACTICAL WINDOW CLOSED`, `${now.state < T.minState ? "Regime dropped to " + now.state + "/3" : now.fees7v30 < T.exitFeeAccel ? "Fees decelerating (7d vs 30d " + now.fees7v30.toFixed(0) + "%)" : crowded(now) ? "Positioning crowded (funding " + now.funding7.toFixed(0) + "%/yr, premium " + now.premium?.toFixed(3) + "%)" : "7d drop " + now.p7.toFixed(0) + "%"}. Back to core ${(core * 100).toFixed(0)}%. PUMP $${now.price.toFixed(5)}.`, 4);
    if (cur.crowded && !prev.crowded) await notify(`PUMP POSITIONING CROWDED`, `7d funding ${now.funding7.toFixed(0)}%/yr, premium ${now.premium?.toFixed(3)}%. Historically next 7d -22%, next 30d -14% at these levels (n=15). No adds; consider trimming leverage.`, 4);
    if (cur.core !== prev.core) await notify(`PUMP CORE ${(prev.core * 100).toFixed(0)}% -> ${(core * 100).toFixed(0)}%`, `Regime ${prev.state}/3 -> ${now.state}/3. Tactical ${tactNow ? "open" : "closed"}. Hedge ${hedgeNow ? "on" : "off"}.`, 3);
  } else if (!prev) {
    await notify(`PUMP PORTFOLIO (initial): core ${(core * 100).toFixed(0)}%, tactical ${tactNow ? "open" : "closed"}, hedge ${hedgeNow ? "on" : "off"}`, `State ${now.state}/3 day ${now.streak}. Funding ${now.funding7.toFixed(0)}%/yr, premium ${now.premium?.toFixed(3)}%. PUMP $${now.price.toFixed(5)}.`, 3);
  }
  writeFileSync(STATE_FILE, JSON.stringify(cur, null, 2));
  const log = existsSync(LOG_FILE) ? JSON.parse(readFileSync(LOG_FILE, "utf-8")) : [];
  if (!log.length || log[log.length - 1].day !== now.d) { log.push({ ...cur, price: now.price, sol: now.sol, funding7: now.funding7, premium: now.premium, streak: now.streak }); writeFileSync(LOG_FILE, JSON.stringify(log)); }
  console.log(`\n  ${DIM}Portfolio log: ${log.length} days${R}\n`);
}
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) main().catch(e => { console.error(e); process.exit(1); });
