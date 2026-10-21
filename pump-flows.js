#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  PUMP flows by wallet category + confluence reconstruction.
//  Daily balances by category (exchange / team / ecosystem / lp / unknown
//  top-500) from the hourly snapshots, merged with fees (DefiLlama), SOL and
//  Hyperliquid funding/premium/volume. Prints the weekly path over a window
//  and the biggest labeled/unlabeled movers, so a "confluence" can be
//  described by what the categories did, not by price alone.
//
//  Usage: node pump-flows.js [--from 2026-07-13] [--to 2026-10-20] [--weekly|--daily]
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { deduplicateSnapshots, smoothSupply, LABELED_WALLETS } from "./pump-signals.js";
const __dirname = dirname(fileURLToPath(import.meta.url));
const args = Object.fromEntries(process.argv.slice(2).map((a, i, arr) => a.startsWith("--") ? [a.slice(2), arr[i + 1] && !arr[i + 1].startsWith("--") ? arr[i + 1] : true] : null).filter(Boolean));
const FROM = args.from || "2026-07-13", TO = args.to || new Date().toISOString().slice(0, 10), DAILY = !!args.daily;
const B = "\x1b[1m", R = "\x1b[0m", DIM = "\x1b[2m";
const LABEL = new Map(LABELED_WALLETS.map(w => [w.addr, w]));
const CATS = ["exchange", "team", "ecosystem", "investor_locked", "lp", "unknown", "unlabeled500"];

const raw = JSON.parse(readFileSync(join(__dirname, "pump-tracker-history.json"), "utf-8"));
const snaps = smoothSupply(deduplicateSnapshots(raw, 1));
const byDay = {};
for (const s of snaps) byDay[s.timestamp.slice(0, 10)] = s; // last snapshot of each day
const catBal = (s) => { const o = Object.fromEntries(CATS.map(c => [c, 0])); for (const h of s.holders) { const l = LABEL.get(h.addr); o[l ? l.category : "unlabeled500"] += h.balance; } return o; };

// external daily series
const perps = existsSync(join(__dirname, "perps-history.json")) ? JSON.parse(readFileSync(join(__dirname, "perps-history.json"), "utf-8")) : [];
const pDay = {}; for (const r of perps) { const d = new Date(r.t).toISOString().slice(0, 10); const x = pDay[d] ??= { f: [], p: [], v: 0 }; if (r.funding !== undefined) { x.f.push(r.funding); x.p.push(r.premium); } if (r.v) x.v += r.v * r.c; }
const avg = a => a.length ? a.reduce((x, y) => x + y, 0) / a.length : null;
async function fees() { try { const d = await (await fetch("https://api.llama.fi/summary/fees/pump.fun?dataType=dailyFees")).json(); const o = {}; for (const [t, v] of d.totalDataChart) o[new Date(t * 1000).toISOString().slice(0, 10)] = v; return o; } catch { return {}; } }
async function solDaily() { try { const d = await (await fetch(`https://coins.llama.fi/chart/coingecko:solana?start=${Math.floor(Date.parse("2026-06-01") / 1000)}&span=400&period=1d`)).json(); const o = {}; for (const p of Object.values(d.coins)[0].prices) o[new Date(Math.round(p.timestamp / 86400) * 86400000).toISOString().slice(0, 10)] = p.price; return o; } catch { return {}; } }

const F = await fees(), SOL = await solDaily();
const days = Object.keys(byDay).filter(d => d >= FROM && d <= TO).sort();
const fmtB = x => (x / 1e9).toFixed(2), fmtD = x => (x >= 0 ? "+" : "") + (x / 1e9).toFixed(2);
const fees7 = d => { const ks = Object.keys(F).filter(k => k <= d).sort().slice(-7); return ks.length ? avg(ks.map(k => F[k])) : null; };
const f7 = d => { const ks = Object.keys(pDay).filter(k => k <= d).sort().slice(-7); const v = ks.flatMap(k => pDay[k].f); return v.length ? avg(v) * 24 * 365 * 100 : null; };

console.log(`${B}PUMP flows by category — ${FROM} → ${TO}${R}  ${DIM}(balances in billions of PUMP from top-500 snapshot; Δ = change since previous row)${R}\n`);
console.log(`${"day".padEnd(11)}${"price".padStart(9)} ${"SOL".padStart(7)} ${"fees7$M".padStart(8)} ${"holders".padStart(8)} ${"Δhold".padStart(7)} | ${"exch".padStart(6)} ${"Δexch".padStart(6)} | ${"team".padStart(6)} ${"Δteam".padStart(6)} | ${"eco".padStart(6)} ${"Δeco".padStart(6)} | ${"lp".padStart(5)} ${"Δlp".padStart(6)} | ${"unk500".padStart(6)} ${"Δunk".padStart(6)} | ${"fund7".padStart(6)} ${"prem".padStart(7)} ${"HLvol$M".padStart(8)}`);
let prev = null, prevDay = null;
const step = DAILY ? 1 : 7;
for (let i = 0; i < days.length; i += step) {
  const d = days[i], s = byDay[d], c = catBal(s);
  const dl = prev ? (k) => fmtD(c[k] - prev[k]).padStart(6) : () => "     -";
  const pd = pDay[d];
  console.log(`${d.padEnd(11)}${s.price.toFixed(5).padStart(9)} ${(SOL[d] ? SOL[d].toFixed(1) : "-").padStart(7)} ${(fees7(d) ? (fees7(d) / 1e6).toFixed(2) : "-").padStart(8)} ${String(s.uniqueOwners).padStart(8)} ${(prev ? ((s.uniqueOwners - prevUO) >= 0 ? "+" : "") + (s.uniqueOwners - prevUO) : "-").padStart(7)} | ${fmtB(c.exchange).padStart(6)} ${dl("exchange")} | ${fmtB(c.team).padStart(6)} ${dl("team")} | ${fmtB(c.ecosystem).padStart(6)} ${dl("ecosystem")} | ${fmtB(c.lp).padStart(5)} ${dl("lp")} | ${fmtB(c.unlabeled500).padStart(6)} ${dl("unlabeled500")} | ${(f7(d) !== null ? f7(d).toFixed(0) + "%" : "-").padStart(6)} ${(pd && pd.p.length ? (avg(pd.p) * 100).toFixed(3) + "%" : "-").padStart(7)} ${(pd ? (pd.v / 1e6).toFixed(0) : "-").padStart(8)}`);
  prev = c; var prevUO = s.uniqueOwners;
}

// biggest individual movers over the window (labeled and unlabeled), by net change
const first = byDay[days[0]], last = byDay[days[days.length - 1]];
const bal = s => new Map(s.holders.map(h => [h.addr, h.balance]));
const b0 = bal(first), b1 = bal(last);
const movers = [...new Set([...b0.keys(), ...b1.keys()])].map(a => ({ addr: a, d: (b1.get(a) || 0) - (b0.get(a) || 0), now: b1.get(a) || 0, label: LABEL.get(a)?.label || "unlabeled", cat: LABEL.get(a)?.category || "-" })).sort((x, y) => Math.abs(y.d) - Math.abs(x.d)).slice(0, 15);
console.log(`\n${B}Largest net movers ${days[0]} → ${days[days.length - 1]}${R}`);
for (const m of movers) console.log(`  ${m.d >= 0 ? "+" : ""}${(m.d / 1e9).toFixed(2).padStart(6)}B  ${m.addr.slice(0, 6)}…${m.addr.slice(-4)}  ${m.label.padEnd(22)} ${m.cat.padEnd(15)} now ${(m.now / 1e9).toFixed(2)}B`);
console.log(`\n${DIM}Note: unlabeled top-500 ("unk500") is where new whales appear; exchange balances falling = withdrawals to self-custody (bullish in the Jul–Sep run, 0% win in Oct).${R}`);
