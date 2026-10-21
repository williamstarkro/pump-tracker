#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  PUMP leveraged momentum setups (3–14 day holds). Runs hourly.
//
//  Built from pump-leverage-study.js (daily, Oct 2025 → Oct 2026, hourly lows
//  from Mar 2026). Only setups whose in-sample intra-hold drawdown made 3x
//  survivable are notified. Base rate for reference: random 7d hold +1.3%,
//  48% win, median worst move -8.7%, liquidated at 5x 18% of the time.
//
//  M1  VOLUME EXPANSION, CALM POSITIONING          (n=10: 7d +13.0% / 70% win / med MAE -0.3% / liq@3x 0%)
//      24h Hyperliquid volume > 2x the trailing 7d daily average, 24h return > 0,
//      7d funding < 20%/yr, premium < 0.05%.  Volume + calm funding = early; volume +
//      hot funding = blowoff (that is the fade, not the entry).
//  M2  DIP INSIDE A CONFIRMED REGIME               (n=9:  7d +9.5% / 78% win / med MAE -6.6% / liq@3x 0%)
//      Daily regime 3/3 AND 7d return < -8% AND calm positioning.
//  M3  FEE ACCELERATION + MOMENTUM (watch, 14d)    (n=12: 14d +13.4% / 67% win / med MAE -14.7% / liq@3x 8%)
//      fees 7d > 30d by 15%+, 3d return > +5%, calm. Lower conviction; 2x at most.
//  Exits for all: time stop (7d for M1/M2, 14d for M3), hard stop -8% from entry on
//  hourly close (= -24% equity at 3x), positioning crowded (7d funding > 40%/yr or
//  premium > 0.08%), or a volume blowoff (24h vol > 4x avg with funding > 25%/yr).
//  DE-RISK: fees 7d < 30d by 15%+ AND fees 30d < 90d → no longs, core to minimum.
//  Every drawdown > 25% in the sample began with either shrinking fees or
//  30d return > +50% at a sub-15% yield.
//
//  Usage: node pump-momentum.js [--no-notify]
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { loadDaily, build, stateOf } from "./pump-regime.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
const STATE_FILE = join(__dirname, "pump-momentum-state.json"), LOG_FILE = join(__dirname, "pump-momentum-log.json");
const NTFY_TOPIC = process.env.NTFY_TOPIC || "pump-entry-signal-wx7k2m";
const args = new Set(process.argv.slice(2));
const B = "\x1b[1m", R = "\x1b[0m", DIM = "\x1b[2m", GRN = "\x1b[32m", RED = "\x1b[31m", YEL = "\x1b[33m";
const HL = "https://api.hyperliquid.xyz/info";
const S = {
  calmFunding: 20, calmPremium: 0.05, crowdedFunding: 40, crowdedPremium: 0.08,
  volX: 2.0, blowoffVolX: 4.0, blowoffFunding: 25,
  dipPct: -8, feeAccel: 15, mom3d: 5,
  stopPct: -8, timeStopDays: { M1: 7, M2: 7, M3: 14 }, leverage: { M1: 3, M2: 3, M3: 2 },
  deriskFeeAccel: -15,
};
async function hl(body) { const r = await fetch(HL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`HL ${r.status}`); return r.json(); }
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
const pct = (x, d = 1) => (x >= 0 ? "+" : "") + x.toFixed(d) + "%";
async function notify(title, message, priority = 4) {
  if (args.has("--no-notify")) { console.log(`\n  [no-notify] ${title}\n  ${message}\n`); return; }
  try { const s = x => x.replace(/[^\x20-\x7E]/g, c => ({ "—": "--", "→": "->", "×": "x", "≤": "<=", "≥": ">=" }[c] || "")); const r = await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, { method: "POST", headers: { Title: s(title), Priority: String(priority), Tags: priority >= 5 ? "rotating_light" : "zap" }, body: s(message) }); console.log(r.ok ? `\n  SENT: ${title}` : `  ntfy failed: ${r.status}`); } catch (e) { console.error("  ntfy failed:", e.message); }
}

async function main() {
  const now = Date.now();
  // hourly candles (9 days) + funding (8 days) from Hyperliquid
  const [candles, fund, [meta, ctxs]] = await Promise.all([
    hl({ type: "candleSnapshot", req: { coin: "PUMP", interval: "1h", startTime: now - 9 * 864e5, endTime: now } }),
    hl({ type: "fundingHistory", coin: "PUMP", startTime: now - 8 * 864e5 }),
    hl({ type: "metaAndAssetCtxs" }),
  ]);
  const ctx = ctxs[meta.universe.findIndex(a => a.name === "PUMP")];
  const price = parseFloat(ctx.markPx), premium = parseFloat(ctx.premium ?? "0") * 100, oiUsd = parseFloat(ctx.openInterest) * price;
  const c = candles.filter(x => x.T <= now).sort((a, b) => a.t - b.t);
  const volUsd = x => +x.v * +x.c;
  const vol24 = c.slice(-24).reduce((a, x) => a + volUsd(x), 0);
  const vol7dAvg = c.slice(-24 * 8, -24).reduce((a, x) => a + volUsd(x), 0) / 7;
  const volX = vol7dAvg ? vol24 / vol7dAvg : null;
  const px = h => c.length > h ? +c[c.length - 1 - h].c : null;
  const ret = h => px(h) ? (price / px(h) - 1) * 100 : null;
  const r24 = ret(24), r3d = ret(72), r7d = ret(168);
  const f7 = avg(fund.filter(f => f.time >= now - 7 * 864e5).map(f => +f.fundingRate)) * 24 * 365 * 100;
  const calm = f7 < S.calmFunding && premium < S.calmPremium, crowded = f7 > S.crowdedFunding || premium > S.crowdedPremium;
  // daily context (fees, regime)
  let daily = null; try { const rows = build(await loadDaily()); daily = rows[rows.length - 1]; daily.state = stateOf(daily); } catch (e) { console.error("  daily context unavailable:", e.message); }
  const feeAccel = daily?.fees7v30 ?? null, fees30v90 = daily?.fees30v90 ?? null, regime = daily?.state ?? null;
  const derisk = feeAccel !== null && feeAccel < S.deriskFeeAccel && fees30v90 !== null && fees30v90 < 0;

  console.log(`${B}PUMP MOMENTUM — ${new Date(now).toISOString().slice(0, 16)} UTC${R}  $${price.toFixed(6)}  24h ${pct(r24)}  3d ${pct(r3d)}  7d ${pct(r7d)}`);
  console.log(`  HL vol 24h $${(vol24 / 1e6).toFixed(0)}M = ${volX?.toFixed(2)}x 7d avg | 7d funding ${f7.toFixed(0)}%/yr | premium ${premium.toFixed(3)}% | OI $${(oiUsd / 1e6).toFixed(0)}M | positioning ${crowded ? RED + "CROWDED" : calm ? GRN + "calm" : YEL + "warm"}${R}`);
  console.log(`  daily: regime ${regime ?? "?"}/3 | fees 7d vs 30d ${feeAccel === null ? "?" : pct(feeAccel, 0)} | fees 30d vs 90d ${fees30v90 === null ? "?" : pct(fees30v90, 0)}${derisk ? RED + "  >>> DE-RISK: fee base contracting <<<" + R : ""}`);

  const setups = {
    M1: { on: volX !== null && volX > S.volX && r24 > 0 && calm && !derisk, why: `24h vol ${volX?.toFixed(1)}x avg, 24h ${pct(r24)}, funding ${f7.toFixed(0)}%/yr, premium ${premium.toFixed(3)}%`, label: "VOLUME EXPANSION + CALM POSITIONING" },
    M2: { on: regime === 3 && r7d !== null && r7d < S.dipPct && calm && !derisk, why: `regime ${regime ?? "?"}/3, 7d ${r7d === null ? "?" : pct(r7d)}, funding ${f7.toFixed(0)}%/yr`, label: "DIP INSIDE CONFIRMED REGIME" },
    M3: { on: feeAccel !== null && feeAccel > S.feeAccel && r3d > S.mom3d && calm && !derisk, why: `fees 7d vs 30d ${pct(feeAccel, 0)}, 3d ${pct(r3d)}, funding ${f7.toFixed(0)}%/yr`, label: "FEE ACCELERATION + MOMENTUM (watch)" },
  };
  const stats = { M1: "in-sample n=10: 7d +13%, 70% win, median worst move -0.3%, 0% liquidated at 3x", M2: "in-sample n=9: 7d +9.5%, 78% win, median worst move -6.6%, 0% liquidated at 3x", M3: "in-sample n=12: 14d +13%, 67% win, median worst move -15%, 8% liquidated at 3x -- 2x max" };
  console.log(`\n${B}Setups${R}`);
  for (const [k, s] of Object.entries(setups)) console.log(`  ${s.on ? GRN + "ON " : DIM + "off"}${R} ${k} ${s.label}  ${DIM}${s.why}${R}`);

  // state machine: open positions tracked until an exit condition; one position per setup
  const st = existsSync(STATE_FILE) ? JSON.parse(readFileSync(STATE_FILE, "utf-8")) : { open: {}, lastDerisk: false };
  const log = existsSync(LOG_FILE) ? JSON.parse(readFileSync(LOG_FILE, "utf-8")) : [];
  const blowoff = volX > S.blowoffVolX && f7 > S.blowoffFunding;
  for (const [k, pos] of Object.entries(st.open)) {
    const pnl = (price / pos.entry - 1) * 100, days = (now - pos.t) / 864e5;
    const reason = pnl <= S.stopPct ? `hard stop (${pct(pnl)})` : crowded ? `positioning crowded (funding ${f7.toFixed(0)}%/yr, premium ${premium.toFixed(3)}%)` : blowoff ? `volume blowoff (${volX.toFixed(1)}x, funding ${f7.toFixed(0)}%/yr)` : derisk ? "fee base contracting" : days >= S.timeStopDays[k] ? `time stop (${S.timeStopDays[k]}d)` : null;
    if (reason) {
      await notify(`PUMP ${k} EXIT: ${reason}`, `${setups[k].label}. Entry $${pos.entry.toFixed(6)} -> $${price.toFixed(6)} = ${pct(pnl)} underlying (${pct(pnl * S.leverage[k])} at ${S.leverage[k]}x, before funding). Held ${days.toFixed(1)}d.`, pnl < 0 ? 5 : 4);
      log.push({ t: new Date(now).toISOString(), setup: k, event: "exit", reason, entry: pos.entry, exit: price, pnl, days });
      delete st.open[k];
    }
  }
  for (const [k, s] of Object.entries(setups)) {
    if (s.on && !st.open[k] && !(st.lastOpen?.[k] && now - st.lastOpen[k] < 3 * 864e5)) {
      st.open[k] = { entry: price, t: now }; st.lastOpen = { ...(st.lastOpen || {}), [k]: now };
      await notify(`PUMP ${k} LONG SETUP — ${s.label} (${S.leverage[k]}x)`, `${s.why}. Entry ~$${price.toFixed(6)}. Stop $${(price * (1 + S.stopPct / 100)).toFixed(6)} (-8% = ${pct(S.stopPct * S.leverage[k], 0)} equity). Time stop ${S.timeStopDays[k]}d. Exit early if funding > ${S.crowdedFunding}%/yr, premium > ${S.crowdedPremium}%, or volume blowoff. ${stats[k]}.`, 5);
      log.push({ t: new Date(now).toISOString(), setup: k, event: "entry", entry: price, why: s.why, volX, f7, premium, r24, r3d, r7d, regime, feeAccel });
    }
  }
  if (derisk && !st.lastDerisk) await notify("PUMP DE-RISK: fee base contracting", `Fees 7d vs 30d ${pct(feeAccel, 0)}, 30d vs 90d ${pct(fees30v90, 0)}. No new longs; core to minimum. Every >25% drawdown in the sample started with shrinking fees or a 30d return > +50% at a sub-15% yield. PUMP $${price.toFixed(6)}.`, 5);
  st.lastDerisk = derisk; st.lastCheck = new Date(now).toISOString(); st.snapshot = { price, volX, f7, premium, r24, r3d, r7d, regime, feeAccel, fees30v90 };
  writeFileSync(STATE_FILE, JSON.stringify(st, null, 2)); writeFileSync(LOG_FILE, JSON.stringify(log));
  console.log(`\n  open: ${Object.keys(st.open).length ? Object.entries(st.open).map(([k, p]) => `${k} @ $${p.entry.toFixed(6)} (${pct((price / p.entry - 1) * 100)})`).join(", ") : "none"} | log ${log.length} events\n`);
}
main().catch(e => { console.error(e); process.exit(1); });
