#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  Fee-to-holder universe: cross-sectional revenue-growth screen (weekly).
//
//  Universe: every DefiLlama protocol that routes revenue to token holders
//  ("holders revenue": buybacks, burns, staking distributions), grouped by parent,
//  with a CoinGecko id. Prices from coins.llama.fi, market caps from CoinGecko.
//  Feature: holders-revenue growth = 30d avg vs 90d avg. Target: forward 30d return.
//
//  Finding (Aug 2025 – Sep 2026, 54 weekly cross-sections, protocol tokens > $50M):
//  rank IC +0.13 at 30d, positive in 76% of weeks, t ≈ 4.4; top-minus-bottom tercile
//  about +7%/month. Weaker in Mar–Sep 2026 (IC +0.03) than before (IC +0.25).
//  Price momentum has no cross-sectional edge in this universe. Yield is a weaker
//  second factor. The edge is RELATIVE revenue growth across peers, not timing one token.
//
//  Prints the IC summary (recomputed on current data) and the current screen, logs the
//  screen to xsec-log.json, and notifies weekly with the top tercile and PUMP's rank.
//  Usage: node pump-xsec.js [--no-notify] [--quiet]
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const LOG = join(__dirname, "xsec-log.json");
const NTFY_TOPIC = process.env.NTFY_TOPIC || "pump-entry-signal-wx7k2m";
const args = new Set(process.argv.slice(2));
const B = "\x1b[1m", R = "\x1b[0m", DIM = "\x1b[2m", GRN = "\x1b[32m", RED = "\x1b[31m";
const L1 = new Set(["eth", "sol", "trx", "bnb", "avax", "near", "icp", "apt", "mon", "quai", "sui", "ton", "btc"]);
const MIN_MCAP = 50e6, MAX_YIELD = 150, MIN_30D = 100e3;
const sleep = ms => new Promise(r => setTimeout(r, ms));
const j = async u => { const r = await fetch(u); if (!r.ok) throw new Error(`${u} ${r.status}`); return r.json(); };
const day = ts => new Date(ts * 1000).toISOString().slice(0, 10), addDays = (d, n) => new Date(Date.parse(d) + n * 864e5).toISOString().slice(0, 10);
const mean = v => v.reduce((a, b) => a + b, 0) / v.length;
const rank = v => { const s = [...v.keys()].sort((a, b) => v[a] - v[b]); const r = []; s.forEach((i, k) => r[i] = k); return r; };
const spear = (x, y) => { const rx = rank(x), ry = rank(y), n = x.length, mx = (n - 1) / 2; let num = 0, dx = 0, dy = 0; for (let i = 0; i < n; i++) { num += (rx[i] - mx) * (ry[i] - mx); dx += (rx[i] - mx) ** 2; dy += (ry[i] - mx) ** 2; } return num / Math.sqrt(dx * dy); };

async function universe() {
  const ov = await j("https://api.llama.fi/overview/fees?excludeTotalDataChart=true&excludeTotalDataChartBreakdown=true&dataType=dailyHoldersRevenue");
  const groups = {}; for (const p of ov.protocols.filter(p => (p.total30d || 0) > MIN_30D)) { const k = p.parentProtocol ? p.parentProtocol.replace(/^parent#/, "") : p.slug; (groups[k] ??= { slug: k, t30: 0 }).t30 += p.total30d; }
  const out = [], seen = new Set();
  for (const g of Object.values(groups).sort((a, b) => b.t30 - a.t30).slice(0, 80)) {
    try { const s = await j(`https://api.llama.fi/summary/fees/${g.slug}?dataType=dailyHoldersRevenue`); if (!s.gecko_id || (s.totalDataChart || []).length < 120 || seen.has(s.gecko_id)) continue; seen.add(s.gecko_id); out.push({ name: s.name || g.slug, slug: g.slug, gecko: s.gecko_id, t30: g.t30, hr: s.totalDataChart }); } catch {}
    await sleep(100);
  }
  const start = Math.floor((Date.now() - 480 * 864e5) / 1000);
  for (const t of out) { try { const d = await j(`https://coins.llama.fi/chart/coingecko:${t.gecko}?start=${start}&span=500&period=1d`); const c = Object.values(d.coins || {})[0]; t.px = (c?.prices || []).map(p => [new Date(Math.round(p.timestamp / 86400) * 86400000).toISOString().slice(0, 10), p.price]); } catch { t.px = []; } await sleep(120); }
  for (let i = 0; i < out.length; i += 50) { try { const m = await j(`https://api.coingecko.com/api/v3/coins/markets?vs_currency=usd&ids=${out.slice(i, i + 50).map(t => t.gecko).join(",")}&per_page=100`); for (const r of m) { const t = out.find(x => x.gecko === r.id); if (t) { t.mcap = r.market_cap; t.circ = r.circulating_supply; t.symbol = r.symbol; } } } catch (e) { console.error("  coingecko markets:", e.message); } await sleep(1500); }
  return out.filter(t => t.px.length > 150 && t.circ && t.mcap);
}
function panel(tokens) {
  const rows = [];
  for (const t of tokens) { const P = Object.fromEntries(t.px), H = {}; for (const [ts, v] of t.hr) H[day(ts)] = v; const days = Object.keys(P).sort();
    for (let i = 90; i < days.length; i++) { const d = days[i]; const win = n => days.slice(i - n + 1, i + 1).map(x => H[x]).filter(v => v !== undefined); const h7 = win(7), h30 = win(30), h90 = win(90); if (h30.length < 20 || h90.length < 60) continue; const a30 = mean(h30), a90 = mean(h90); if (!(a90 > 0)) continue;
      const mc = t.circ * P[d]; const f30 = P[addDays(d, 30)];
      rows.push({ d, sym: t.symbol, name: t.name, l1: L1.has(t.symbol), mcap: mc, growth: (a30 / a90 - 1) * 100, accel: h7.length >= 5 ? (mean(h7) / a30 - 1) * 100 : null, yld: a30 * 365 / mc * 100, rev30: a30, p30: P[days[i - 30]] ? (P[d] / P[days[i - 30]] - 1) * 100 : null, f30: f30 ? (f30 / P[d] - 1) * 100 : null }); } }
  return rows;
}
const tradable = r => !r.l1 && r.mcap > MIN_MCAP && r.yld < MAX_YIELD;
async function notify(title, message) { if (args.has("--no-notify")) { console.log(`\n  [no-notify] ${title}\n  ${message}\n`); return; } try { const s = x => x.replace(/[^\x20-\x7E]/g, ""); await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, { method: "POST", headers: { Title: s(title), Priority: "3", Tags: "bar_chart" }, body: s(message) }); console.log(`\n  SENT: ${title}`); } catch (e) { console.error("  ntfy failed:", e.message); } }

async function main() {
  const tokens = await universe(); const rows = panel(tokens);
  const byDay = {}; for (const r of rows) (byDay[r.d] ??= []).push(r);
  const weeks = Object.keys(byDay).sort().filter((d, i) => i % 7 === 0);
  const ics = [], spr = [];
  for (const w of weeks) { const rs = byDay[w].filter(r => r.f30 !== null && tradable(r)); if (rs.length < 10) continue; ics.push(spear(rs.map(r => r.growth), rs.map(r => r.f30))); const s = [...rs].sort((a, b) => a.growth - b.growth), k = Math.floor(s.length / 3); spr.push(mean(s.slice(-k).map(r => r.f30)) - mean(s.slice(0, k).map(r => r.f30))); }
  const sd = Math.sqrt(ics.map(x => (x - mean(ics)) ** 2).reduce((a, b) => a + b, 0) / (ics.length - 1)), t = mean(ics) / (sd / Math.sqrt(ics.length));
  console.log(`${B}FEE-TO-HOLDER UNIVERSE — revenue-growth screen${R}  ${DIM}${tokens.length} tokens, ${ics.length} weekly cross-sections${R}`);
  console.log(`  Factor check (growth 30d vs 90d → fwd 30d, tradable): IC ${(mean(ics) >= 0 ? "+" : "") + mean(ics).toFixed(3)}, positive ${(ics.filter(x => x > 0).length / ics.length * 100).toFixed(0)}% of weeks, t ${t.toFixed(1)}, top−bottom tercile ${(mean(spr) >= 0 ? "+" : "") + mean(spr).toFixed(1)}%/30d`);
  const last = Object.keys(byDay).sort().pop(); const cur = byDay[last].filter(tradable).sort((a, b) => b.growth - a.growth); const k = Math.floor(cur.length / 3);
  console.log(`\n${B}Screen as of ${last}${R}  ${DIM}(ex-L1, mcap > $${MIN_MCAP / 1e6}M, ${cur.length} names; top tercile = ${k})${R}`);
  console.log(`  ${"#".padStart(2)} ${"sym".padEnd(7)} ${"rev30 $/d".padStart(10)} ${"growth".padStart(8)} ${"accel7".padStart(8)} ${"yield".padStart(7)} ${"p30".padStart(7)} ${"mcap".padStart(8)}`);
  cur.forEach((r, i) => console.log(`  ${String(i + 1).padStart(2)} ${(i < k ? GRN : i >= cur.length - k ? RED : "") + r.sym.padEnd(7) + R} ${("$" + (r.rev30 / 1e3).toFixed(0) + "K").padStart(10)} ${((r.growth >= 0 ? "+" : "") + r.growth.toFixed(0) + "%").padStart(8)} ${(r.accel === null ? "--" : (r.accel >= 0 ? "+" : "") + r.accel.toFixed(0) + "%").padStart(8)} ${(r.yld.toFixed(1) + "%").padStart(7)} ${((r.p30 >= 0 ? "+" : "") + (r.p30 ?? 0).toFixed(0) + "%").padStart(7)} ${("$" + (r.mcap / 1e9).toFixed(2) + "B").padStart(8)}`));
  const pumpIdx = cur.findIndex(r => r.sym === "pump");
  const log = existsSync(LOG) ? JSON.parse(readFileSync(LOG, "utf-8")) : [];
  if (!log.length || log[log.length - 1].d !== last) { log.push({ d: last, ic: mean(ics), t, spread: mean(spr), screen: cur.map(r => ({ sym: r.sym, growth: r.growth, accel: r.accel, yld: r.yld, p30: r.p30, mcap: r.mcap, rev30: r.rev30 })) }); writeFileSync(LOG, JSON.stringify(log)); }
  const prev = log.length > 1 ? log[log.length - 2] : null;
  if (!prev || prev.d !== last) {
    await notify(`FEE-TO-HOLDER SCREEN ${last}: top ${k} by revenue growth`, `${cur.slice(0, k).map(r => `${r.sym.toUpperCase()} ${r.growth >= 0 ? "+" : ""}${r.growth.toFixed(0)}% (yield ${r.yld.toFixed(0)}%)`).join(", ")}. Bottom: ${cur.slice(-k).map(r => r.sym.toUpperCase()).join(", ")}. PUMP rank ${pumpIdx + 1}/${cur.length} (growth ${cur[pumpIdx]?.growth.toFixed(0)}%). Factor IC ${mean(ics).toFixed(2)}, t ${t.toFixed(1)}; top-bottom ${mean(spr).toFixed(0)}%/30d in-sample.`);
  }
  console.log(`\n  ${DIM}PUMP rank ${pumpIdx + 1}/${cur.length} | log ${log.length} screens${R}\n`);
}
main().catch(e => { console.error(e); process.exit(1); });
