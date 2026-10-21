#!/usr/bin/env node
// ═══════════════════════════════════════════════════════════════════
//  PUMP perps history — Hyperliquid hourly funding/premium since listing
//  (2025-07-10) and hourly candles (volume, trades). Append-only: fetches
//  from the last stored hour. Also snapshots OKX open interest history
//  (recent window only; OKX does not expose deep history).
//
//  Output: perps-history.json  [{ t, funding, premium, o, h, l, c, v, n, okxOI? }]
//  Usage: node pump-perps-history.js
// ═══════════════════════════════════════════════════════════════════
import { readFileSync, writeFileSync, existsSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
const __dirname = dirname(fileURLToPath(import.meta.url));
const FILE = join(__dirname, "perps-history.json");
const HL = "https://api.hyperliquid.xyz/info";
const LISTING = Date.parse("2025-07-10T00:00:00Z");
const sleep = ms => new Promise(r => setTimeout(r, ms));
async function hl(body) { const r = await fetch(HL, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }); if (!r.ok) throw new Error(`HL ${r.status}`); return r.json(); }

async function main() {
  const hist = existsSync(FILE) ? JSON.parse(readFileSync(FILE, "utf-8")) : [];
  const byT = new Map(hist.map(r => [r.t, r]));
  const lastT = hist.length ? hist[hist.length - 1].t : LISTING - 1;
  const now = Date.now();

  // 1) funding + premium, hourly, paged by startTime (500 per call)
  let start = lastT + 1, pages = 0;
  while (start < now) {
    const d = await hl({ type: "fundingHistory", coin: "PUMP", startTime: start });
    if (!d.length) break;
    for (const f of d) { const t = Math.floor(f.time / 3600000) * 3600000; const row = byT.get(t) || { t }; row.funding = parseFloat(f.fundingRate); row.premium = parseFloat(f.premium); byT.set(t, row); }
    start = d[d.length - 1].time + 1; pages++;
    if (d.length < 500) break;
    await sleep(150);
  }
  // 2) candles 1h (volume in PUMP, trade count), chunks of ~5000h
  for (let s = Math.max(LISTING, Math.floor((lastT + 1) / 3600000) * 3600000); s < now; s += 5000 * 3600000) {
    const d = await hl({ type: "candleSnapshot", req: { coin: "PUMP", interval: "1h", startTime: s, endTime: Math.min(now, s + 5000 * 3600000) } });
    for (const c of d) { const row = byT.get(c.t) || { t: c.t }; Object.assign(row, { o: +c.o, h: +c.h, l: +c.l, c: +c.c, v: +c.v, n: c.n }); byT.set(c.t, row); }
    await sleep(150);
  }
  // 3) OKX OI history (USD notional), whatever depth it serves
  try {
    const r = await fetch("https://www.okx.com/api/v5/rubik/stat/contracts/open-interest-history?instId=PUMP-USDT-SWAP&period=1H&limit=1000");
    const d = await r.json();
    for (const [ts, , , oiUsd] of d.data || []) { const t = Math.floor(+ts / 3600000) * 3600000; const row = byT.get(t); if (row) row.okxOIUsd = +oiUsd; }
  } catch (e) { console.error("  OKX OI unavailable:", e.message); }

  const out = [...byT.values()].sort((a, b) => a.t - b.t).filter(r => r.funding !== undefined || r.c !== undefined);
  writeFileSync(FILE, JSON.stringify(out));
  const withF = out.filter(r => r.funding !== undefined).length, withC = out.filter(r => r.c !== undefined).length, withOI = out.filter(r => r.okxOIUsd !== undefined).length;
  console.log(`  perps-history.json: ${out.length} hours ${new Date(out[0].t).toISOString().slice(0, 13)} -> ${new Date(out[out.length - 1].t).toISOString().slice(0, 13)} | funding ${withF}, candles ${withC}, okx OI ${withOI} | ${pages} funding pages fetched`);
}
main().catch(e => { console.error(e); process.exit(1); });
