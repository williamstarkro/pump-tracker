#!/usr/bin/env node

const HELIUS_API_KEY = process.env.HELIUS_API_KEY || "c09814db-cb2b-46d7-b90b-f8d1432b6e24";
const HELIUS_RPC = `https://mainnet.helius-rpc.com/?api-key=${HELIUS_API_KEY}`;

const TOKEN_MINT = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn";
const DECIMALS = 6;
const TOP_N = 500;

// ─── Burn tracking ───
// Original supply was 1T. On 2026-04-28, ~128.3B tokens were burned (buyback wallets).
// New model: 50% of revenue → programmatic buy & burn (tokens burned immediately, never accumulate).
// Track burns via: ORIGINAL_SUPPLY - currentTotalSupply
const ORIGINAL_SUPPLY = 1_000_000_000_000;
// One-time burn on 2026-04-28 at 20:52 UTC (Buyback Wallet 1 + 2 burned)
const ONE_TIME_BURN = 128_266_289_975; // ~128.3B tokens
const ONE_TIME_BURN_DATE = "2026-04-28T20:52:00Z";
// Revenue allocation: was 100% buyback, now 50% buyback+burn (as of 2026-04-28)
const BUYBACK_PCT_BEFORE = 1.0;
const BUYBACK_PCT_AFTER = 0.5;
const BUYBACK_POLICY_CHANGE_DATE = "2026-04-28T20:52:00Z";

// ─── Labeled wallets ───
const LABELED_WALLETS = [
  { addr: "Cfq1ts1iFr1eUWWBm8eFxUzm5R3YA3UvMZznwiShbgZt", label: "Token Custodian",      category: "ecosystem" },
  { addr: "8UhbNoBXmGoxJr2TeWW8wmSMoWmjS2rTT2tVJxzuTogC", label: "Team (locked Jul 25%)", category: "team" },
  { addr: "G8CcfRffqZWHSAQJXLDfwbAkGE95SddUqVXnTrL4kqjm", label: "Buyback & Burn 1",    category: "buyback_burn" },
  { addr: "8PSmqJy63d4cAKRLKUitJCBLSjuL1cvZxC53vdCyjUey", label: "Buyback & Burn 2",    category: "buyback_burn" },
  { addr: "9pkFKCR1mdS31JxjKdtmWg2awZUg6vJUYVY722DAcXzv", label: "Team",                 category: "team" },
  { addr: "9WzDXwBbmkg8ZTbNMqUxvQRAyrZzDsGYdLVL9zYtAWWM", label: "Binance Hot",          category: "exchange" },
  { addr: "85WTujfJ9meJq5hfjAeb5gftj7n8Q7QTsZJbRqMD5ERS", label: "Team",                 category: "team" },
  { addr: "BBvQteuawKB2UtExfevL8HYLjWWsgmWXsp922vFbvCfT", label: "Ecosystem",            category: "ecosystem" },
  { addr: "GTeSSwovPiVirpvWJpThUWiLDSLsuApmJw621Yom3MhB", label: "Ecosystem",            category: "ecosystem" },
  { addr: "AvqFxKNrYZNvxsj2oWhLW8det68HzCXBqswshoD2TdT6", label: "Team",                 category: "team" },
  { addr: "96HiV4cGWTJNCjGVff3RTHgPXmpYz7MSrGTAmxNKVWM9", label: "Team",                 category: "team" },
  { addr: "9UcygiamY92yGntGkUkBKi4SdApxkBMZd9QSo6wMC2dN", label: "Team (distributed)",    category: "team" },
  { addr: "8UHpWBnhYNeAQURWjAABp8vSrzfYa69o7sfi65vYLC42", label: "Unknown",              category: "unknown" },
  { addr: "ERRGqu3dh6zYBg7MNAHKL33TyVb7efMmaKxnmdukdNYa", label: "Unknown (maybe team)", category: "unknown" },
  { addr: "GhFaBi8sy3M5mgG97YguQ6J3f7XH4JwV5CoW8MbzRgAU", label: "Unknown",              category: "unknown" },
  { addr: "5v7ZZg1D1si417WhUQF9Br2dRQEnd1sTbCfesscUCVKE", label: "Unknown",              category: "unknown" },
  { addr: "AC5RDfQFmDS1deWZos921JfqscXdByf8BKHs5ACWjtW2", label: "Bybit Hot",            category: "exchange" },
  { addr: "9SLPTL41SPsYkgdsMzdfJsxymEANKr5bYoBsQzJyKpKS", label: "HyperUnit Hot",        category: "exchange" },
  { addr: "2WHL4XiNGKW9NgSwsJeG7WG2kD35Bi44rZoLrXHEz3dw", label: "Unknown",              category: "unknown" },
  { addr: "C68a6RCGLiPskbPYtAcsCjhG8tfTWYcoB4JjCrXFdqyo", label: "OKX Hot",              category: "exchange" },
  { addr: "4GZwzZgqSwwTTRVgBoxTDeH3EwDye84dCPb9fALAZFjF", label: "Unknown",              category: "unknown" },
  { addr: "8wM44Ryv9DFCSfkgUnPEPgnsc53arT4cnmXL6LnnC4UW", label: "OKX Hot 2",            category: "exchange" },
  { addr: "7TWnq4WeYcwQWBCwKeEX2Q9xqVtthPGkB7adNvueuVuh", label: "Bitget Cold",          category: "exchange" },
  { addr: "GpCfmwsCgbPtymZTXa3Dixb4MeyxkUHfNHBq3vBAA6SA", label: "Unknown",              category: "unknown" },
  { addr: "H61va8NXmR72rJ5Z4cy2FNrGrptedTsArDxqiH7yZUB8", label: "Unknown",              category: "unknown" },
  { addr: "3Z2AqcKCmdcCZ3iCUiFKtwUbrmuPcefwN3xRLTdY7XyN", label: "Unknown",              category: "unknown" },
  { addr: "77DsB9kw8u8eKesicT44hGirsj5A2SicGdFPQZZEzPXe", label: "Unknown",              category: "unknown" },
  { addr: "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9", label: "Binance 3",            category: "exchange" },
  { addr: "6LY1JzAFVZsP2a2xKrtU6znQMQ5h4i7tocWdgrkZzkzF", label: "Kraken Hot",           category: "exchange" },
  { addr: "2uF4Xh61rDwxnG9woyxsVQP7zuA6kLFpb3NvnRQeoiSd", label: "PumpSwap LP Pool",     category: "lp" },
  { addr: "FkrTb5Q3v1Tw2RKU9YHuiNwZrPsef55whFKijdG73Kz1", label: "Unknown",              category: "unknown" },
  // Additional exchange wallets
  { addr: "3B7XAQrLoEMDEGvX8569F9GRb9PcXXocJmj5wvhhei9z", label: "BtcTurk Cold",          category: "exchange" },
  { addr: "EFE3j1pcSP1paUzA86zW7989ZjsFP2J7ginyUqo4ewqR", label: "Kraken Cold",           category: "exchange" },
  { addr: "u6PJ8DtQuPFnfmwHbGFULQ4u4EgjDiyYKjVEsynXq2w",  label: "Gate.io",               category: "exchange" },
  { addr: "E2RvJg2myWpKcbkhBuF81gfhYr6KvmNcDbSmr5qnatYy", label: "Kraken Cold 2",         category: "exchange" },
  { addr: "5PAhQiYdLBd6SVdjzBQDxUAEFyDdF5ExNPQfcscnPRj5", label: "MEXC",                  category: "exchange" },
  { addr: "A77HErqtfN1hLLpvZ9pCtu66FEtM8BveoaKbbMoZ4RiR", label: "Bitget Hot",            category: "exchange" },
  // Investor/locked wallets (distributed from team, subject to vesting)
  { addr: "EuH2wD3rkVp5uosoL8v5kRTMLT5L6jvbwXAXRSEwzdwG", label: "Investor (locked)",    category: "investor_locked" },
];

// Locked tokens custodied in exchange wallets (not tradeable).
// ~9.3B locked investor tokens sitting in Kraken Hot from Feb 2026 team distribution.
const LOCKED_IN_EXCHANGES = 9_300_000_000;

const LABEL_MAP = new Map(LABELED_WALLETS.map(w => [w.addr, w]));
const HISTORY_FILE = new URL("./pump-tracker-history.json", import.meta.url).pathname;

const fs = await import("fs");

// ─── Helpers ───
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
const shortAddr = (a) => a ? a.slice(0, 6) + "..." + a.slice(-4) : "???";
const fmtNum = (n) => n.toLocaleString(undefined, { maximumFractionDigits: 0 });
const fmtPct = (n) => n.toFixed(2) + "%";
const fmtDelta = (n) => (n >= 0 ? "+" : "") + fmtNum(n);
const pad = (s, n) => String(s).padStart(n);

const CATEGORY_COLORS = {
  team: "\x1b[33m",           // yellow
  ecosystem: "\x1b[32m",      // green
  exchange: "\x1b[36m",       // cyan
  lp: "\x1b[35m",             // magenta
  investor_locked: "\x1b[34m", // blue
  buyback_burn: "\x1b[91m",   // bright red
  unknown: "\x1b[37m",        // white
};
const RESET = "\x1b[0m";
const BOLD = "\x1b[1m";
const DIM = "\x1b[2m";
const RED = "\x1b[31m";
const GREEN = "\x1b[32m";

// ─── Fetch ALL token accounts from Helius DAS (real-time on-chain) ───
async function fetchAllHolders() {
  const ownerBalances = new Map(); // owner → total balance (aggregate multiple token accounts)
  let cursor = undefined;
  let pages = 0;
  let totalAccounts = 0;
  const startTime = Date.now();

  process.stdout.write(`  Scanning all PUMP token accounts via Helius DAS...`);

  while (true) {
    const params = {
      mint: TOKEN_MINT,
      limit: 1000,
      options: { showZeroBalance: false },
    };
    if (cursor) params.cursor = cursor;

    let data;
    for (let attempt = 0; attempt < 8; attempt++) {
      const res = await fetch(HELIUS_RPC, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "getTokenAccounts", params }),
      });
      if (res.status === 429 || res.status >= 500) {
        const wait = Math.pow(2, attempt) * 1000;
        process.stdout.write(` [${res.status}, waiting ${wait / 1000}s]`);
        await sleep(wait);
        continue;
      }
      data = await res.json();
      if (data.error?.code === -32429) {
        const wait = Math.pow(2, attempt) * 1000;
        process.stdout.write(` [rate limited, waiting ${wait / 1000}s]`);
        await sleep(wait);
        continue;
      }
      if (data.error) throw new Error(`Helius DAS: ${JSON.stringify(data.error)}`);
      break;
    }
    if (!data) throw new Error("Helius DAS: max retries exceeded");

    const accts = data.result.token_accounts;
    totalAccounts += accts.length;
    pages++;

    for (const a of accts) {
      const balance = a.amount / Math.pow(10, DECIMALS);
      ownerBalances.set(a.owner, (ownerBalances.get(a.owner) || 0) + balance);
    }

    cursor = data.result.cursor;
    if (!cursor || accts.length === 0) break;

    // Progress indicator every 10 pages
    if (pages % 10 === 0) {
      const elapsed = ((Date.now() - startTime) / 1000).toFixed(0);
      process.stdout.write(`\r  Scanning all PUMP token accounts via Helius DAS... ${totalAccounts.toLocaleString()} accounts (${elapsed}s)`);
    }
  }

  const elapsed = ((Date.now() - startTime) / 1000).toFixed(1);
  const totalSupply = [...ownerBalances.values()].reduce((s, b) => s + b, 0);

  // Sort by balance descending, take top N
  const sorted = [...ownerBalances.entries()]
    .map(([addr, balance]) => ({ addr, balance }))
    .sort((a, b) => b.balance - a.balance)
    .slice(0, TOP_N);

  process.stdout.write(`\r  Scanned ${totalAccounts.toLocaleString()} accounts (${ownerBalances.size.toLocaleString()} unique owners) in ${elapsed}s\n`);

  return { holders: sorted, totalSupply, totalAccounts, uniqueOwners: ownerBalances.size };
}

// ─── Fetch token price from Helius DAS ───
async function fetchPrice() {
  const res = await fetch(HELIUS_RPC, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0", id: 1,
      method: "getAsset",
      params: { id: TOKEN_MINT },
    }),
  });
  const data = await res.json();
  return data.result?.token_info?.price_info?.price_per_token || null;
}

// ─── Load history ───
function loadHistory() {
  try {
    const raw = fs.readFileSync(HISTORY_FILE, "utf8");
    const data = JSON.parse(raw);
    if (Array.isArray(data)) return data;
    return [data];
  } catch (e) {
    // Check if file exists but failed to parse — don't silently lose data
    try {
      const stat = fs.statSync(HISTORY_FILE);
      if (stat.size > 1000) {
        console.error(`  ⚠ WARNING: History file exists (${(stat.size / 1024).toFixed(0)}KB) but failed to parse: ${e.message}`);
        console.error(`  ⚠ NOT overwriting. Fix the file or delete it manually to start fresh.`);
        process.exit(1);
      }
    } catch {}
    return [];
  }
}

// ─── Save history ───
function saveHistory(history) {
  // Backup before overwriting if file has significant data
  try {
    const stat = fs.statSync(HISTORY_FILE);
    if (stat.size > 10000) {
      fs.copyFileSync(HISTORY_FILE, HISTORY_FILE + ".bak");
    }
  } catch {}
  fs.writeFileSync(HISTORY_FILE, JSON.stringify(history, null, 2));
}

// ─── Main ───
async function main() {
  console.log("");

  // Fetch data (price starts immediately, holders scan runs in parallel)
  const [holdersResult, price] = await Promise.all([fetchAllHolders(), fetchPrice()]);
  const { holders, totalSupply, totalAccounts, uniqueOwners } = holdersResult;

  const now = new Date().toISOString();
  const history = loadHistory();
  const baseline = history.length > 0 ? history[0] : null;
  const prevRun = history.length > 1 ? history[history.length - 1] : baseline;
  const prev = baseline; // always compare against baseline

  // Build current snapshot (store top 500 for history)
  const current = {
    timestamp: now,
    price,
    totalSupply,
    uniqueOwners,
    holders: holders.map((h, i) => ({
      rank: i + 1,
      addr: h.addr,
      balance: h.balance,
      pct: (h.balance / totalSupply) * 100,
    })),
  };

  // Build prev lookup
  const prevMap = new Map();
  if (prev) {
    for (const h of prev.holders) prevMap.set(h.addr, h);
  }

  // ─── Header ───
  console.log(`${BOLD}${"═".repeat(120)}${RESET}`);
  console.log(`${BOLD}  PUMP Token Tracker${RESET}  —  ${now.slice(0, 19)} UTC  (run #${history.length + 1})  ${DIM}[Helius on-chain | top ${TOP_N}]${RESET}`);
  if (baseline) console.log(`  Baseline (run #1): ${baseline.timestamp.slice(0, 19)} UTC`);
  if (prevRun && prevRun !== baseline) console.log(`  Previous run (#${history.length}): ${prevRun.timestamp.slice(0, 19)} UTC`);
  const totalBurned = ORIGINAL_SUPPLY - totalSupply;
  console.log(`  Price: $${price ? price.toFixed(10) : "?"} | FDV: $${price ? fmtNum(price * totalSupply) : "?"} | Supply: ${fmtNum(totalSupply)} (of ${fmtNum(ORIGINAL_SUPPLY)} original)`);
  console.log(`  Burned: ${fmtNum(totalBurned)} (${fmtPct((totalBurned / ORIGINAL_SUPPLY) * 100)})${price ? ` = $${fmtNum(totalBurned * price)} at current price` : ""}`);
  console.log(`  Holders: ${uniqueOwners.toLocaleString()} unique owners | ${totalAccounts.toLocaleString()} token accounts`);
  console.log(`${"═".repeat(120)}`);

  // ─── Top 30 labeled wallets ───
  console.log(`\n${BOLD}  LABELED WALLETS (Top 30)${RESET}`);
  console.log(`  ${"#".padStart(3)} ${"Label".padEnd(24)} ${"Category".padEnd(12)} ${"Balance".padStart(22)} ${"% Supply".padStart(9)} ${"Δ Tokens".padStart(18)} ${"Δ USD".padStart(16)}`);
  console.log(`  ${"─".repeat(112)}`);

  for (const h of current.holders.slice(0, 30)) {
    const info = LABEL_MAP.get(h.addr);
    const label = info ? info.label : "???";
    const cat = info ? info.category : "unknown";
    const color = CATEGORY_COLORS[cat] || "";

    const p = prevMap.get(h.addr);
    let deltaStr = "";
    let deltaUsdStr = "";
    if (p) {
      const diff = h.balance - p.balance;
      if (Math.abs(diff) > 100) {
        const diffColor = diff > 0 ? GREEN : RED;
        deltaStr = `${diffColor}${fmtDelta(diff)}${RESET}`;
        if (price) deltaUsdStr = `${diffColor}${fmtDelta(diff * price)}${RESET}`;
      }
    } else if (prev) {
      deltaStr = "NEW";
    }

    console.log(`  ${pad(h.rank, 3)} ${color}${label.padEnd(24)}${RESET} ${cat.padEnd(12)} ${pad(fmtNum(h.balance), 22)} ${pad(fmtPct(h.pct), 9)} ${pad(deltaStr, 28)} ${pad(deltaUsdStr, 26)}`);
  }

  // ─── Category summary (across ALL 500 holders) ───
  console.log(`\n${BOLD}  CATEGORY BREAKDOWN (all ${TOP_N} tracked holders)${RESET}`);
  console.log(`  ${"Category".padEnd(14)} ${"Balance".padStart(22)} ${"% Supply".padStart(9)} ${"Δ Tokens".padStart(18)} ${"Δ USD".padStart(16)}`);
  console.log(`  ${"─".repeat(85)}`);

  const catTotals = { team: 0, ecosystem: 0, buyback_burn: 0, exchange: 0, lp: 0, investor_locked: 0, unknown: 0, unlabeled: 0 };
  for (const h of current.holders) {
    const info = LABEL_MAP.get(h.addr);
    if (info) catTotals[info.category] = (catTotals[info.category] || 0) + h.balance;
    else catTotals.unlabeled += h.balance;
  }

  for (const cat of ["team", "ecosystem", "buyback_burn", "exchange", "lp", "investor_locked", "unknown", "unlabeled"]) {
    const bal = catTotals[cat] || 0;
    if (bal === 0) continue;
    const pct = (bal / totalSupply) * 100;
    const color = CATEGORY_COLORS[cat] || "";
    let deltaStr = "";
    let deltaUsdStr = "";
    if (prev) {
      let prevCatTotal = 0;
      let currCatTotal = 0;
      if (cat === "unlabeled") {
        for (const h of current.holders) {
          if (!LABEL_MAP.has(h.addr)) currCatTotal += h.balance;
        }
        for (const h of prev.holders) {
          if (!LABEL_MAP.has(h.addr)) {
            const curr = current.holders.find(ch => ch.addr === h.addr);
            if (curr) prevCatTotal += h.balance;
          }
        }
      } else {
        for (const w of LABELED_WALLETS) {
          if (w.category !== cat) continue;
          const curr = current.holders.find(h => h.addr === w.addr);
          const p = prevMap.get(w.addr);
          if (curr) currCatTotal += curr.balance;
          if (p) prevCatTotal += p.balance;
        }
      }
      const diff = currCatTotal - prevCatTotal;
      if (Math.abs(diff) > 100) {
        const diffColor = diff > 0 ? GREEN : RED;
        deltaStr = `${diffColor}${fmtDelta(diff)}${RESET}`;
        if (price) deltaUsdStr = `${diffColor}$${fmtDelta(diff * price)}${RESET}`;
      }
    }
    const displayCat = cat === "unlabeled" ? "UNLABELED" : cat.toUpperCase();
    console.log(`  ${color}${displayCat.padEnd(14)}${RESET} ${pad(fmtNum(bal), 22)} ${pad(fmtPct(pct), 9)} ${pad(deltaStr, 28)} ${pad(deltaUsdStr, 26)}`);
  }

  // ─── Concentration brackets ───
  console.log(`\n${BOLD}  CONCENTRATION${RESET}`);
  const brackets = [
    { label: "Top 10", end: 10 },
    { label: "Top 20", end: 20 },
    { label: "Top 30", end: 30 },
    { label: "Top 50", end: 50 },
    { label: "Top 100", end: 100 },
    { label: "Top 200", end: 200 },
    { label: "Top 500", end: 500 },
  ];
  for (const b of brackets) {
    const slice = current.holders.slice(0, Math.min(b.end, current.holders.length));
    const bal = slice.reduce((s, h) => s + h.balance, 0);
    const pct = (bal / totalSupply) * 100;
    let prevPct = null;
    if (prev) {
      const prevSlice = prev.holders.slice(0, Math.min(b.end, prev.holders.length));
      if (prevSlice.length > 0) {
        const prevBal = prevSlice.reduce((s, h) => s + h.balance, 0);
        prevPct = (prevBal / prev.totalSupply) * 100;
      }
    }
    const delta = prevPct !== null ? ` (${(pct - prevPct) >= 0 ? "+" : ""}${(pct - prevPct).toFixed(2)}pp)` : "";
    console.log(`  ${b.label.padEnd(20)} ${pad(fmtPct(pct), 8)}${delta}`);
  }

  // ─── Biggest movers ───
  if (prev) {
    console.log(`\n${BOLD}  BIGGEST MOVERS (since baseline ${baseline.timestamp.slice(0, 19)} UTC)${RESET}`);
    const changes = [];
    for (const h of current.holders) {
      const p = prevMap.get(h.addr);
      const info = LABEL_MAP.get(h.addr);
      // For unlabeled wallets, skip if not in baseline (they just grew into top 500)
      // For labeled wallets, treat new entries as having 0 baseline (genuine new activity)
      if (!p && !info) continue;
      const prevBal = p ? p.balance : 0;
      const diff = h.balance - prevBal;
      if (Math.abs(diff) > 1000) {
        changes.push({ addr: h.addr, rank: h.rank, diff, label: info?.label || "Unlabeled", category: info?.category || "other" });
      }
    }
    changes.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));

    if (changes.length === 0) {
      console.log("  No significant changes detected.");
    } else {
      for (const c of changes.slice(0, 20)) {
        const color = c.diff > 0 ? GREEN : RED;
        const arrow = c.diff > 0 ? "▲" : "▼";
        const usd = price ? ` ($${fmtDelta(c.diff * price)})` : "";
        console.log(`  ${color}${arrow}${RESET} #${pad(c.rank, 3)} ${c.label.padEnd(24)} ${color}${fmtDelta(c.diff).padStart(18)}${RESET}${usd}`);
      }

      // Net flow summary
      const exchangeFlow = changes.filter(c => c.category === "exchange").reduce((s, c) => s + c.diff, 0);
      const ecoFlow = changes.filter(c => c.category === "ecosystem").reduce((s, c) => s + c.diff, 0);
      const unknownFlow = changes.filter(c => c.category === "unknown" || c.category === "other").reduce((s, c) => s + c.diff, 0);

      console.log(`\n  Net flows by category:`);
      if (Math.abs(exchangeFlow) > 100)
        console.log(`    Exchange:  ${exchangeFlow > 0 ? GREEN : RED}${fmtDelta(exchangeFlow)}${RESET}${price ? ` ($${fmtDelta(exchangeFlow * price)})` : ""}`);
      if (Math.abs(ecoFlow) > 100)
        console.log(`    Ecosystem: ${ecoFlow > 0 ? GREEN : RED}${fmtDelta(ecoFlow)}${RESET}${price ? ` ($${fmtDelta(ecoFlow * price)})` : ""}`);
      if (Math.abs(unknownFlow) > 100)
        console.log(`    Unknown:   ${unknownFlow > 0 ? GREEN : RED}${fmtDelta(unknownFlow)}${RESET}${price ? ` ($${fmtDelta(unknownFlow * price)})` : ""}`);
    }
  }

  // ─── Holders #31-100 detail ───
  console.log(`\n${BOLD}  HOLDERS #31-100${RESET}`);
  console.log(`  ${"#".padStart(3)} ${"Address".padEnd(18)} ${"Balance".padStart(20)} ${"% Supply".padStart(8)} ${"Δ Tokens".padStart(18)}`);
  console.log(`  ${"─".repeat(75)}`);

  for (const h of current.holders.slice(30, 100)) {
    const p = prevMap.get(h.addr);
    let deltaStr = "";
    if (p) {
      const diff = h.balance - p.balance;
      if (Math.abs(diff) > 1000) {
        const diffColor = diff > 0 ? GREEN : RED;
        deltaStr = `${diffColor}${fmtDelta(diff)}${RESET}`;
      }
    } else if (prev) {
      deltaStr = "NEW";
    }
    const lblInfo = LABEL_MAP.get(h.addr);
    const displayName = lblInfo ? lblInfo.label : shortAddr(h.addr);
    const displayColor = lblInfo ? (CATEGORY_COLORS[lblInfo.category] || "") : "";
    console.log(`  ${pad(h.rank, 3)} ${displayColor}${displayName.padEnd(18)}${RESET} ${pad(fmtNum(h.balance), 20)} ${pad(fmtPct(h.pct), 8)} ${pad(deltaStr, 28)}`);
  }

  // ─── Holders #101-500 summary ───
  console.log(`\n${BOLD}  HOLDERS #101-500 SUMMARY${RESET}`);
  const tail101_200 = current.holders.slice(100, 200);
  const tail201_500 = current.holders.slice(200, 500);
  const sum101_200 = tail101_200.reduce((s, h) => s + h.balance, 0);
  const sum201_500 = tail201_500.reduce((s, h) => s + h.balance, 0);
  console.log(`  #101-200: ${fmtNum(tail101_200.length)} holders | ${fmtNum(sum101_200)} tokens (${fmtPct((sum101_200 / totalSupply) * 100)}) | range: ${fmtNum(tail101_200[0]?.balance || 0)} - ${fmtNum(tail101_200[tail101_200.length - 1]?.balance || 0)}`);
  console.log(`  #201-500: ${fmtNum(tail201_500.length)} holders | ${fmtNum(sum201_500)} tokens (${fmtPct((sum201_500 / totalSupply) * 100)}) | range: ${fmtNum(tail201_500[0]?.balance || 0)} - ${fmtNum(tail201_500[tail201_500.length - 1]?.balance || 0)}`);

  // Show notable movers in #101-500
  if (prev) {
    const tailMovers = [];
    for (const h of current.holders.slice(100)) {
      const p = prevMap.get(h.addr);
      if (!p) continue;
      const diff = h.balance - p.balance;
      if (Math.abs(diff) > 10_000_000) { // 10M+ token moves
        const info = LABEL_MAP.get(h.addr);
        tailMovers.push({ addr: h.addr, rank: h.rank, diff, label: info?.label || shortAddr(h.addr) });
      }
    }
    if (tailMovers.length > 0) {
      tailMovers.sort((a, b) => Math.abs(b.diff) - Math.abs(a.diff));
      console.log(`\n  Notable movers in #101-500:`);
      for (const m of tailMovers.slice(0, 10)) {
        const color = m.diff > 0 ? GREEN : RED;
        const arrow = m.diff > 0 ? "▲" : "▼";
        console.log(`    ${color}${arrow}${RESET} #${pad(m.rank, 3)} ${m.label.padEnd(18)} ${color}${fmtDelta(m.diff).padStart(18)}${RESET}`);
      }
    }
  }

  // ─── Float estimate ───
  console.log(`\n${BOLD}  FLOAT ESTIMATE${RESET}`);
  const teamTotal = current.holders.filter(h => LABEL_MAP.get(h.addr)?.category === "team").reduce((s, h) => s + h.balance, 0);
  const ecoTotal = current.holders.filter(h => LABEL_MAP.get(h.addr)?.category === "ecosystem").reduce((s, h) => s + h.balance, 0);
  const buybackBurnTotal = current.holders.filter(h => LABEL_MAP.get(h.addr)?.category === "buyback_burn").reduce((s, h) => s + h.balance, 0);
  const exchTotal = current.holders.filter(h => LABEL_MAP.get(h.addr)?.category === "exchange").reduce((s, h) => s + h.balance, 0);
  const lpTotal = current.holders.filter(h => LABEL_MAP.get(h.addr)?.category === "lp").reduce((s, h) => s + h.balance, 0);
  const investorLockedTotal = current.holders.filter(h => LABEL_MAP.get(h.addr)?.category === "investor_locked").reduce((s, h) => s + h.balance, 0);
  const unknownTop30 = current.holders.slice(0, 30).filter(h => {
    const info = LABEL_MAP.get(h.addr);
    return info?.category === "unknown";
  }).reduce((s, h) => s + h.balance, 0);
  const tracked31_500 = current.holders.slice(30).filter(h => !LABEL_MAP.has(h.addr)).reduce((s, h) => s + h.balance, 0);
  const trackedTotal = current.holders.reduce((s, h) => s + h.balance, 0);
  const restOfSupply = totalSupply - trackedTotal;

  const exchTradeable = exchTotal - LOCKED_IN_EXCHANGES;
  const nonFloat = teamTotal + ecoTotal + buybackBurnTotal + investorLockedTotal + LOCKED_IN_EXCHANGES;
  const floatBroad = totalSupply - nonFloat;
  const floatConservative = exchTradeable + lpTotal + tracked31_500 + restOfSupply;

  console.log(`  ${BOLD}Burned (permanent):${RESET}              ${fmtNum(totalBurned)} (${fmtPct((totalBurned / ORIGINAL_SUPPLY) * 100)} of original)${price ? `  = $${fmtNum(totalBurned * price)}` : ""}`);
  console.log(`  Buyback wallets (pending burn):    ${fmtNum(buybackBurnTotal)} (${fmtPct((buybackBurnTotal / totalSupply) * 100)})`);
  console.log(`  Non-circulating (team + ecosystem): ${fmtNum(teamTotal + ecoTotal)} (${fmtPct(((teamTotal + ecoTotal) / totalSupply) * 100)})`);
  console.log(`  Investor locked (vesting):          ${fmtNum(investorLockedTotal)} (${fmtPct((investorLockedTotal / totalSupply) * 100)})`);
  console.log(`  Locked in exchanges (est.):         ${fmtNum(LOCKED_IN_EXCHANGES)} (${fmtPct((LOCKED_IN_EXCHANGES / totalSupply) * 100)})  ${DIM}[~9.3B vesting tokens in Kraken]${RESET}`);
  console.log(`  Exchange holdings (tradeable):      ${fmtNum(exchTradeable)} (${fmtPct((exchTradeable / totalSupply) * 100)})  ${DIM}[${fmtNum(exchTotal)} gross - ${fmtNum(LOCKED_IN_EXCHANGES)} locked]${RESET}`);
  console.log(`  LP pools:                           ${fmtNum(lpTotal)} (${fmtPct((lpTotal / totalSupply) * 100)})`);
  console.log(`  Unknown top-30:                     ${fmtNum(unknownTop30)} (${fmtPct((unknownTop30 / totalSupply) * 100)})`);
  console.log(`  Tracked #31-500 (unlabeled):        ${fmtNum(tracked31_500)} (${fmtPct((tracked31_500 / totalSupply) * 100)})`);
  console.log(`  #501+ holders (untracked):          ${fmtNum(restOfSupply)} (${fmtPct((restOfSupply / totalSupply) * 100)})`);
  console.log(`  ─────────────────────────────────────`);
  console.log(`  ${BOLD}Float (broad):${RESET}        ${fmtNum(floatBroad)} (${fmtPct((floatBroad / totalSupply) * 100)})  ${price ? "= $" + fmtNum(floatBroad * price) : ""}`);
  console.log(`  ${BOLD}Float (conservative):${RESET} ${fmtNum(floatConservative)} (${fmtPct((floatConservative / totalSupply) * 100)})  ${price ? "= $" + fmtNum(floatConservative * price) : ""}`);

  // ─── Stickiness Analysis ───
  if (history.length >= 1) {
    const allSnaps = [...history, current];
    const daySpan = ((new Date(current.timestamp) - new Date(allSnaps[0].timestamp)) / 86400000).toFixed(1);
    console.log(`\n${BOLD}  STICKINESS ANALYSIS${RESET}  (${allSnaps.length} snapshots over ${daySpan} days)`);

    // Build timeline: addr → [{snapIdx, balance}, ...]
    const walletTimeline = new Map();
    for (let si = 0; si < allSnaps.length; si++) {
      for (const h of allSnaps[si].holders) {
        if (!walletTimeline.has(h.addr)) walletTimeline.set(h.addr, []);
        walletTimeline.get(h.addr).push({ snapIdx: si, balance: h.balance });
      }
    }

    const MOVE_THRESHOLD = 1_000_000;

    const buckets = {
      burned:      { label: "Burned (permanent removal)",  tokens: totalBurned, wallets: [{addr: "BURNED", balance: totalBurned}], sticky: true },
      buyback:     { label: "Buyback wallets (pending burn)", tokens: 0, wallets: [], sticky: true },
      team_eco:    { label: "Team + Eco + Investor (locked)", tokens: 0, wallets: [], sticky: true },
      dormant:     { label: "Dormant (no movement)",        tokens: 0, wallets: [], sticky: true },
      accumulator: { label: "Pure Accumulators (only buy)", tokens: 0, wallets: [], sticky: true },
      exchange:    { label: "Exchanges",                    tokens: 0, wallets: [], sticky: false },
      lp:          { label: "LP Pools",                     tokens: 0, wallets: [], sticky: false },
      trader:      { label: "Mixed / Traders",              tokens: 0, wallets: [], sticky: false },
      reducer:     { label: "Pure Reducers (only sell)",    tokens: 0, wallets: [], sticky: false },
      new_entry:   { label: "New Entrants (< 3 snapshots)", tokens: 0, wallets: [], sticky: null },
    };

    for (const h of current.holders) {
      const info = LABEL_MAP.get(h.addr);
      if (info) {
        if (info.category === "buyback_burn") { buckets.buyback.tokens += h.balance; buckets.buyback.wallets.push(h); continue; }
        if (info.category === "team" || info.category === "ecosystem" || info.category === "investor_locked") {
          buckets.team_eco.tokens += h.balance; buckets.team_eco.wallets.push(h); continue;
        }
        if (info.category === "exchange") { buckets.exchange.tokens += h.balance; buckets.exchange.wallets.push(h); continue; }
        if (info.category === "lp") { buckets.lp.tokens += h.balance; buckets.lp.wallets.push(h); continue; }
      }

      // Behavioral classification
      const tl = walletTimeline.get(h.addr) || [];
      if (tl.length < 2) { buckets.new_entry.tokens += h.balance; buckets.new_entry.wallets.push(h); continue; }

      let ups = 0, downs = 0;
      for (let i = 1; i < tl.length; i++) {
        const diff = tl[i].balance - tl[i - 1].balance;
        if (diff > MOVE_THRESHOLD) ups++;
        else if (diff < -MOVE_THRESHOLD) downs++;
      }

      if (ups === 0 && downs === 0) { buckets.dormant.tokens += h.balance; buckets.dormant.wallets.push(h); }
      else if (downs === 0) { buckets.accumulator.tokens += h.balance; buckets.accumulator.wallets.push(h); }
      else if (ups === 0) { buckets.reducer.tokens += h.balance; buckets.reducer.wallets.push(h); }
      else { buckets.trader.tokens += h.balance; buckets.trader.wallets.push(h); }
    }

    // Display table
    const order = ["burned", "buyback", "team_eco", "dormant", "accumulator", "exchange", "lp", "trader", "reducer", "new_entry"];
    const supplyDenom = ORIGINAL_SUPPLY; // use original 1T so burned tokens show as %
    console.log(`  ${"Category".padEnd(36)} ${"#".padStart(3)} ${"Tokens".padStart(18)} ${"% Orig".padStart(9)}  Sticky`);
    console.log(`  ${"─".repeat(80)}`);

    let stickyTotal = 0, unstickyTotal = 0;
    for (const key of order) {
      const b = buckets[key];
      if (b.wallets.length === 0 && b.tokens === 0) continue;
      const pct = (b.tokens / supplyDenom) * 100;
      const stickyLabel = b.sticky === true ? `${GREEN}YES${RESET}` : b.sticky === false ? `${RED}NO${RESET}` : "  ?";
      if (b.sticky === true) stickyTotal += b.tokens;
      else unstickyTotal += b.tokens;
      console.log(`  ${b.label.padEnd(36)} ${String(b.wallets.length).padStart(3)} ${fmtNum(b.tokens).padStart(18)} ${fmtPct(pct).padStart(9)}  ${stickyLabel}`);
    }

    // Adjust for locked tokens custodied in exchange wallets
    if (LOCKED_IN_EXCHANGES > 0) {
      console.log(`  ${"Locked in exchanges (vesting)".padEnd(36)} ${"".padStart(3)} ${fmtNum(LOCKED_IN_EXCHANGES).padStart(18)} ${fmtPct((LOCKED_IN_EXCHANGES / totalSupply) * 100).padStart(9)}  ${GREEN}YES${RESET}  ${DIM}[moved from exchange → sticky]${RESET}`);
      stickyTotal += LOCKED_IN_EXCHANGES;
      unstickyTotal -= LOCKED_IN_EXCHANGES;
    }

    // Notable accumulators
    if (buckets.accumulator.wallets.length > 0) {
      console.log(`\n  Top accumulators (only bought, never sold across ${allSnaps.length} snapshots):`);
      const sorted = [...buckets.accumulator.wallets].sort((a, b) => b.balance - a.balance);
      for (const w of sorted.slice(0, 8)) {
        const tl = walletTimeline.get(w.addr);
        const firstBal = tl[0].balance;
        const gained = w.balance - firstBal;
        const gainPct = firstBal > 0 ? ((gained / firstBal) * 100).toFixed(0) : "new";
        console.log(`    ${shortAddr(w.addr).padEnd(16)} ${fmtNum(w.balance).padStart(16)}  ${GREEN}+${fmtNum(gained)}${RESET} (${gainPct}% increase)`);
      }
    }

    // Notable reducers
    if (buckets.reducer.wallets.length > 0) {
      console.log(`\n  Top reducers (only sold, never bought across ${allSnaps.length} snapshots):`);
      const sorted = [...buckets.reducer.wallets].sort((a, b) => {
        const tlA = walletTimeline.get(a.addr);
        const tlB = walletTimeline.get(b.addr);
        return (a.balance - tlA[0].balance) - (b.balance - tlB[0].balance); // most sold first
      });
      for (const w of sorted.slice(0, 8)) {
        const tl = walletTimeline.get(w.addr);
        const firstBal = tl[0].balance;
        const lost = w.balance - firstBal;
        const lossPct = firstBal > 0 ? ((lost / firstBal) * 100).toFixed(0) : "?";
        console.log(`    ${shortAddr(w.addr).padEnd(16)} ${fmtNum(w.balance).padStart(16)}  ${RED}${fmtDelta(lost)}${RESET} (${lossPct}% of position)`);
      }
    }

    // Summary — separate burned from live sticky for display
    const stickyLive = stickyTotal - totalBurned; // sticky tokens that still exist
    const stickyLivePct = (stickyLive / totalSupply) * 100;
    const unstickyPct = (unstickyTotal / totalSupply) * 100;
    const stickyRatio = (stickyLive / (stickyLive + unstickyTotal)) * 100;

    console.log(`\n  ─────────────────────────────────────`);
    console.log(`  ${BOLD}Burned:${RESET}           ${fmtNum(totalBurned)} (${fmtPct((totalBurned / ORIGINAL_SUPPLY) * 100)} of original)  ${GREEN}GONE FOREVER${RESET}`);
    console.log(`  ${BOLD}Sticky (live):${RESET}    ${fmtNum(stickyLive)} (${fmtPct(stickyLivePct)})  ${GREEN}■■■■■■■■■■${RESET}`);
    console.log(`  ${BOLD}Unsticky:${RESET}         ${fmtNum(unstickyTotal)} (${fmtPct(unstickyPct)})  ${RED}■■■${RESET}`);
    console.log(`  ${BOLD}Sticky ratio:${RESET}     ${stickyRatio.toFixed(1)}% of live classified supply is in non-selling hands`);
    console.log(`  Note: #${TOP_N + 1}+ holders (${fmtNum(restOfSupply)}, ${fmtPct((restOfSupply / totalSupply) * 100)}) not individually tracked`);

    // ─── CYCLE SIGNALS / MANIA DASHBOARD ───
    console.log(`\n${BOLD}  CYCLE SIGNALS / MANIA DASHBOARD${RESET}`);

    const daysSinceBaseline = baseline ? (new Date(current.timestamp) - new Date(baseline.timestamp)) / 86400000 : 0;

    // ─── Buyback+burn rate calculation ───
    // Pre-burn: tracked via buyback wallet balance accumulation
    // Post-burn: tracked via total supply reduction (tokens are burned immediately)
    // We need to compute the ONGOING rate, excluding the one-time burn event.
    //
    // Total supply removed = ORIGINAL_SUPPLY - totalSupply = totalBurned
    // Ongoing programmatic burns = totalBurned - ONE_TIME_BURN - buybackBurnTotal (pending in wallets)
    // But we also need to account for the pre-burn period where tokens accumulated in wallets.
    //
    // Best approach: use the last snapshot before the burn to get pre-burn buyback rate,
    // and supply reduction after burn date for post-burn rate.

    const burnDate = new Date(ONE_TIME_BURN_DATE);
    const now_date = new Date(current.timestamp);
    const isPastBurn = now_date >= burnDate;

    let dailyBuybackTokens, dailyBuybackUsd, annualBuybackUsd;

    // Helper: compute pre-burn buyback rate from wallet accumulation, scaled to 50%
    function estimateFromPreBurn() {
      const preBurnSnaps = allSnaps.filter(s => new Date(s.timestamp) <= burnDate);
      if (preBurnSnaps.length >= 2) {
        const firstPre = preBurnSnaps[0];
        const lastPre = preBurnSnaps[preBurnSnaps.length - 1];
        const daysPre = (new Date(lastPre.timestamp) - new Date(firstPre.timestamp)) / 86400000;
        const BUYBACK_ADDRS = LABELED_WALLETS.filter(w => w.category === "buyback_burn").map(w => w.addr);
        const bbFirst = BUYBACK_ADDRS.reduce((s, addr) => s + (firstPre.holders.find(h => h.addr === addr)?.balance || 0), 0);
        const bbLast = BUYBACK_ADDRS.reduce((s, addr) => s + (lastPre.holders.find(h => h.addr === addr)?.balance || 0), 0);
        const preBurnRate = daysPre > 0 ? (bbLast - bbFirst) / daysPre : 0;
        return preBurnRate * (BUYBACK_PCT_AFTER / BUYBACK_PCT_BEFORE); // scale 100% → 50%
      }
      return 0;
    }

    let buybackEstimated = false; // flag if we're using estimate vs measured

    if (isPastBurn) {
      // Post-burn: measure ongoing burns via supply reduction + wallet accumulation
      // Need at least 1 day of post-burn data for a meaningful rate
      const postBurnSnaps = allSnaps.filter(s => new Date(s.timestamp) > burnDate);
      const daySpanPost = postBurnSnaps.length >= 2 ?
        (new Date(postBurnSnaps[postBurnSnaps.length - 1].timestamp) - new Date(postBurnSnaps[0].timestamp)) / 86400000 : 0;

      if (postBurnSnaps.length >= 2 && daySpanPost >= 1) {
        // Enough post-burn data — measure directly
        const firstPost = postBurnSnaps[0];
        const lastPost = postBurnSnaps[postBurnSnaps.length - 1];
        const BUYBACK_ADDRS = LABELED_WALLETS.filter(w => w.category === "buyback_burn").map(w => w.addr);
        const bbBalFirst = BUYBACK_ADDRS.reduce((s, addr) => s + (firstPost.holders.find(h => h.addr === addr)?.balance || 0), 0);
        const bbBalLast = BUYBACK_ADDRS.reduce((s, addr) => s + (lastPost.holders.find(h => h.addr === addr)?.balance || 0), 0);
        const supplyBurned = (firstPost.totalSupply - lastPost.totalSupply);
        const walletAccum = bbBalLast - bbBalFirst;
        const totalBought = supplyBurned + walletAccum;
        dailyBuybackTokens = totalBought / daySpanPost;
      } else {
        // Not enough post-burn data — estimate from pre-burn rate scaled to 50%
        dailyBuybackTokens = estimateFromPreBurn();
        buybackEstimated = true;
      }
    } else {
      // Pre-burn: old method — track buyback wallet accumulation
      const BUYBACK_ADDRS = LABELED_WALLETS.filter(w => w.category === "buyback_burn").map(w => w.addr);
      const buybackNow = BUYBACK_ADDRS.reduce((s, addr) => s + (current.holders.find(h => h.addr === addr)?.balance || 0), 0);
      const buybackBaseline = BUYBACK_ADDRS.reduce((s, addr) => s + (baseline?.holders.find(h => h.addr === addr)?.balance || 0), 0);
      dailyBuybackTokens = daysSinceBaseline > 0 ? (buybackNow - buybackBaseline) / daysSinceBaseline : 0;
    }

    dailyBuybackUsd = dailyBuybackTokens * price;
    annualBuybackUsd = dailyBuybackUsd * 365;

    // Circulating supply: exclude custodian, burned, and buyback wallet (pending burn)
    const CUSTODIAN_ADDR = "Cfq1ts1iFr1eUWWBm8eFxUzm5R3YA3UvMZznwiShbgZt";
    const custodianBal = current.holders.find(h => h.addr === CUSTODIAN_ADDR)?.balance || 0;
    const permanentlyRemoved = totalBurned + buybackBurnTotal + custodianBal;
    const circulatingSupply = ORIGINAL_SUPPLY - permanentlyRemoved;
    const circMcap = price * circulatingSupply;
    const fdv = price * totalSupply;

    // Buyback yield on circulating
    const buybackYield = circMcap > 0 ? (annualBuybackUsd / circMcap) * 100 : 0;
    const circMcapAt2_5 = annualBuybackUsd > 0 ? annualBuybackUsd / 0.025 : 0;
    const priceAt2_5 = circulatingSupply > 0 ? circMcapAt2_5 / circulatingSupply : 0;
    const upside = circMcap > 0 ? circMcapAt2_5 / circMcap : 0;
    const pRevenue = annualBuybackUsd > 0 ? circMcap / annualBuybackUsd : 0;

    // Also compute on broad float
    const floatMcap = price * floatBroad;
    const buybackYieldOnFloat = floatMcap > 0 ? (annualBuybackUsd / floatMcap) * 100 : 0;

    // --- Valuation ---
    console.log(`\n  ${BOLD}① Valuation${RESET}`);
    console.log(`    ${DIM}─── Burn summary ───${RESET}`);
    console.log(`    Total burned:        ${fmtNum(totalBurned)} tokens (${fmtPct((totalBurned / ORIGINAL_SUPPLY) * 100)} of original 1T)`);
    console.log(`    Pending burn:        ${fmtNum(buybackBurnTotal)} tokens (in buyback wallets)`);
    console.log(`    Revenue policy:      ${isPastBurn ? "50% → buy & burn (programmatic, locked 1yr)" : "100% → buyback (pre-burn era)"}`);
    console.log(`    ${DIM}─── Buyback rate ───${RESET}`);
    console.log(`    Daily:               $${fmtNum(dailyBuybackUsd)}/day (${fmtNum(dailyBuybackTokens)} tokens/day)${buybackEstimated ? `  ${DIM}[est. from pre-burn rate × 50%]${RESET}` : ""}`);
    console.log(`    Annual:              $${fmtNum(annualBuybackUsd)}/year${buybackEstimated ? `  ${DIM}[estimated]${RESET}` : ""}`);
    console.log(`    ${DIM}─── Market cap basis ───${RESET}`);
    console.log(`    FDV (live supply):   $${fmtNum(fdv)} (${fmtNum(totalSupply)} tokens)`);
    console.log(`    Circ MC:             $${fmtNum(circMcap)} (${fmtNum(circulatingSupply)} tokens)  ${DIM}[excl. burned + custodian + buyback wallets]${RESET}`);
    console.log(`    Float MC:            $${fmtNum(floatMcap)} (${fmtNum(floatBroad)} tokens)  ${DIM}[only tradeable supply]${RESET}`);
    console.log(`    ${DIM}─── Buyback yield ───${RESET}`);
    console.log(`    On circulating:      ${buybackYield.toFixed(1)}%  ${DIM}(Apple: 2.5%, S&P 500 avg: ~2%)${RESET}`);
    console.log(`    On float:            ${buybackYieldOnFloat.toFixed(1)}%  ${DIM}(annual buyback / float market cap)${RESET}`);
    console.log(`    P/Buyback:           ${pRevenue.toFixed(1)}x  ${DIM}(circ MC / annual buyback)${RESET}`);
    console.log(`    ${DIM}─── Fair value (2.5% yield on circ) ───${RESET}`);
    console.log(`    Circ MC at 2.5%:     $${fmtNum(circMcapAt2_5)} → $${priceAt2_5.toFixed(4)}/token → ${GREEN}${upside.toFixed(1)}x from here${RESET}`);

    let yieldSignal, yieldColor;
    if (buybackYield > 10) { yieldSignal = `MASSIVELY UNDERVALUED — ${(buybackYield / 2.5).toFixed(0)}x Apple's yield on circ`; yieldColor = GREEN; }
    else if (buybackYield > 5) { yieldSignal = `UNDERVALUED — ${(buybackYield / 2.5).toFixed(1)}x Apple's yield on circ`; yieldColor = GREEN; }
    else if (buybackYield > 2.5) { yieldSignal = `APPROACHING FAIR VALUE — nearing Apple parity`; yieldColor = "\x1b[33m"; }
    else if (buybackYield > 1.5) { yieldSignal = `FULLY VALUED — mania premium present`; yieldColor = RED; }
    else { yieldSignal = `OVERHEATED — yield well below Apple, likely mania top territory`; yieldColor = RED; }
    console.log(`    → ${yieldColor}${yieldSignal}${RESET}`);

    // --- Price Momentum ---
    console.log(`\n  ${BOLD}② Price Momentum${RESET}`);
    if (baseline && price && baseline.price) {
      const priceChangePct = ((price - baseline.price) / baseline.price) * 100;
      const annualizedReturn = daysSinceBaseline > 0 ? (Math.pow(price / baseline.price, 365 / daysSinceBaseline) - 1) * 100 : 0;
      console.log(`    Since baseline:     ${priceChangePct >= 0 ? GREEN : RED}${priceChangePct >= 0 ? "+" : ""}${priceChangePct.toFixed(1)}%${RESET} over ${daysSinceBaseline.toFixed(1)} days`);
      console.log(`    Annualized:         ${annualizedReturn >= 0 ? GREEN : RED}${annualizedReturn >= 0 ? "+" : ""}${fmtNum(annualizedReturn)}%${RESET}`);

      // Price velocity: compare recent snapshots vs earlier
      if (allSnaps.length >= 20) {
        const recentN = Math.min(10, Math.floor(allSnaps.length / 4));
        const recent = allSnaps.slice(-recentN);
        const prior = allSnaps.slice(-recentN * 2, -recentN);
        const recentAvg = recent.reduce((s, snap) => s + (snap.price || 0), 0) / recent.length;
        const priorAvg = prior.reduce((s, snap) => s + (snap.price || 0), 0) / prior.length;
        const velChange = priorAvg > 0 ? ((recentAvg - priorAvg) / priorAvg) * 100 : 0;
        const accel = velChange > 2 ? `${GREEN}ACCELERATING ↑${RESET}` : velChange < -2 ? `${RED}DECELERATING ↓${RESET}` : `STEADY →`;
        console.log(`    Velocity:           ${accel} (recent avg $${recentAvg.toFixed(6)} vs prior $${priorAvg.toFixed(6)}, ${velChange >= 0 ? "+" : ""}${velChange.toFixed(1)}%)`);
      }

      // Parabolic check: is price accelerating exponentially?
      if (annualizedReturn > 1000) console.log(`    ${RED}⚠ PARABOLIC MOVE — annualized return exceeds 1000%, unsustainable${RESET}`);
      else if (annualizedReturn > 500) console.log(`    \x1b[33m⚡ Strong momentum — watch for parabolic acceleration${RESET}`);
    }

    // Holder count
    console.log(`    Holders:            ${fmtNum(uniqueOwners)}`);
    const firstWithHolders = allSnaps.find(s => s.uniqueOwners);
    if (firstWithHolders && firstWithHolders !== current && current.uniqueOwners) {
      const holderDays = (new Date(current.timestamp) - new Date(firstWithHolders.timestamp)) / 86400000;
      if (holderDays > 0.1) {
        const holderGrowth = current.uniqueOwners - firstWithHolders.uniqueOwners;
        const holderGrowthPerDay = holderGrowth / holderDays;
        const holderGrowthPct = (holderGrowth / firstWithHolders.uniqueOwners) * 100;
        console.log(`    Holder growth:      ${holderGrowth >= 0 ? GREEN : RED}${fmtDelta(holderGrowth)}${RESET} (${holderGrowthPerDay >= 0 ? "+" : ""}${holderGrowthPerDay.toFixed(0)}/day, ${holderGrowthPct >= 0 ? "+" : ""}${holderGrowthPct.toFixed(1)}%)`);
        if (holderGrowthPerDay > 5000) console.log(`    ${RED}⚠ RETAIL MANIA — holder count exploding (>5K/day)${RESET}`);
        else if (holderGrowthPerDay > 1000) console.log(`    \x1b[33m⚡ Accelerating adoption — watch for FOMO wave${RESET}`);
      }
    }

    // --- Float Dynamics ---
    console.log(`\n  ${BOLD}③ Float Dynamics${RESET}`);
    const floatBurnPerDay = dailyBuybackTokens;
    const daysToConsumeFloat = floatBurnPerDay > 0 ? floatConservative / floatBurnPerDay : Infinity;
    const monthlyFloatBurn = floatBurnPerDay * 30;
    const monthlyBurnPct = floatConservative > 0 ? (monthlyFloatBurn / floatConservative) * 100 : 0;

    console.log(`    Conservative float:  ${fmtNum(floatConservative)} (${fmtPct((floatConservative / totalSupply) * 100)}) = $${fmtNum(floatConservative * price)}`);
    console.log(`    Float burn rate:     ${fmtNum(floatBurnPerDay)}/day ($${fmtNum(floatBurnPerDay * price)}/day)`);
    console.log(`    Monthly burn:        ${fmtNum(monthlyFloatBurn)} tokens (${monthlyBurnPct.toFixed(1)}% of float/month)`);
    console.log(`    Days to consume float (flat price): ${daysToConsumeFloat === Infinity ? "∞" : fmtNum(daysToConsumeFloat)} days (${(daysToConsumeFloat / 30).toFixed(1)} months)`);

    // LP depth as liquidity proxy
    const lpNow = lpTotal;
    const lpBaseline = baseline?.holders.find(h => LABEL_MAP.get(h.addr)?.category === "lp")?.balance || 0;
    if (lpBaseline > 0) {
      const lpChange = lpNow - lpBaseline;
      const lpChangePct = (lpChange / lpBaseline) * 100;
      console.log(`    LP depth:            ${fmtNum(lpNow)} (${lpChange >= 0 ? GREEN : RED}${fmtDelta(lpChange)}${RESET}, ${lpChangePct >= 0 ? "+" : ""}${lpChangePct.toFixed(1)}%)`);
      if (lpChangePct < -20) console.log(`    ${RED}⚠ LP depth shrinking significantly — price impact per $ increasing${RESET}`);
    }

    // Total removed from circulation since baseline
    if (baseline) {
      // Tokens removed = supply reduction + accumulation in buyback wallets
      const supplyReduction = (baseline.totalSupply || ORIGINAL_SUPPLY) - totalSupply;
      const totalRemoved = supplyReduction + buybackBurnTotal;
      console.log(`    Removed since base:  ${GREEN}${fmtNum(totalRemoved)}${RESET} tokens ($${fmtNum(totalRemoved * price)})  ${DIM}[${fmtNum(supplyReduction)} burned + ${fmtNum(buybackBurnTotal)} pending]${RESET}`);
    }

    // --- Seller Exhaustion ---
    console.log(`\n  ${BOLD}④ Seller Exhaustion${RESET}`);
    const reducerData = [];
    for (const w of buckets.reducer.wallets) {
      const tl = walletTimeline.get(w.addr);
      const startBal = tl[0].balance;
      const remaining = w.balance;
      const sold = startBal - remaining;
      const daySpanW = (new Date(current.timestamp) - new Date(allSnaps[tl[0].snapIdx].timestamp)) / 86400000;
      const dailySellRate = daySpanW > 0 ? sold / daySpanW : 0;
      const daysLeft = dailySellRate > 0 ? remaining / dailySellRate : Infinity;
      reducerData.push({ addr: w.addr, startBal, remaining, sold, remainingPct: startBal > 0 ? (remaining / startBal) * 100 : 0, dailySellRate, daysLeft });
    }

    const totalReducerTokens = reducerData.reduce((s, r) => s + r.remaining, 0);
    const totalReducerStart = reducerData.reduce((s, r) => s + r.startBal, 0);
    const avgRemainingPct = totalReducerStart > 0 ? (totalReducerTokens / totalReducerStart) * 100 : 0;
    const reducerFeedsDays = dailyBuybackTokens > 0 ? totalReducerTokens / dailyBuybackTokens : Infinity;

    console.log(`    Active reducers:     ${reducerData.length} wallets, ${fmtNum(totalReducerTokens)} tokens remaining`);
    console.log(`    Avg position left:   ${avgRemainingPct.toFixed(1)}% of starting position`);
    console.log(`    Reducer pool feeds:  ${reducerFeedsDays === Infinity ? "∞" : reducerFeedsDays.toFixed(0)} days of buyback`);

    // Top reducers with runway
    reducerData.sort((a, b) => b.remaining - a.remaining);
    for (const r of reducerData.slice(0, 3)) {
      const info = LABEL_MAP.get(r.addr);
      const name = info?.label || shortAddr(r.addr);
      console.log(`      ${name}: ${fmtNum(r.remaining)} left (${r.remainingPct.toFixed(0)}%), ~${r.daysLeft === Infinity ? "∞" : r.daysLeft.toFixed(0)} days runway`);
    }

    if (avgRemainingPct < 30) console.log(`    ${GREEN}⚡ Sellers nearly exhausted — supply crunch approaching${RESET}`);
    if (reducerFeedsDays < 30) console.log(`    ${GREEN}⚡ Reducer pool exhausts in <30 days — price breakout imminent${RESET}`);

    // ─── PRECOMPUTE RATE-BASED SIGNALS (used in Smart Money + Sell Triggers) ───
    const YELLOW = "\x1b[33m";
    const WINDOW_DAYS = 7;
    const windowCutoffDate = new Date(new Date(current.timestamp).getTime() - WINDOW_DAYS * 86400000);

    const recentSnapsIdx = [];
    for (let i = allSnaps.length - 1; i >= 0; i--) {
      if (new Date(allSnaps[i].timestamp) >= windowCutoffDate) recentSnapsIdx.push(i);
      else break;
    }
    const windowStart = recentSnapsIdx.length > 1 ? recentSnapsIdx[recentSnapsIdx.length - 1] : 0;

    // Accumulator flips in 7-day window
    let recentAccFlips = 0;
    const recentAccFlipList = [];
    for (const w of [...buckets.trader.wallets, ...buckets.reducer.wallets]) {
      const tl = walletTimeline.get(w.addr);
      if (tl.length < 4) continue;
      const beforeWindow = tl.filter(t => t.snapIdx <= windowStart);
      const inWindow = tl.filter(t => t.snapIdx > windowStart);
      if (beforeWindow.length < 2 || inWindow.length < 1) continue;
      let wasAccumulating = true;
      for (let i = 1; i < beforeWindow.length; i++) {
        if (beforeWindow[i].balance - beforeWindow[i - 1].balance < -MOVE_THRESHOLD) { wasAccumulating = false; break; }
      }
      let hadBuys = false;
      for (let i = 1; i < beforeWindow.length; i++) {
        if (beforeWindow[i].balance - beforeWindow[i - 1].balance > MOVE_THRESHOLD) { hadBuys = true; break; }
      }
      if (!wasAccumulating || !hadBuys) continue;
      let soldInWindow = false;
      for (let i = 0; i < inWindow.length; i++) {
        const prev_i = i === 0 ? beforeWindow[beforeWindow.length - 1] : inWindow[i - 1];
        if (inWindow[i].balance - prev_i.balance < -MOVE_THRESHOLD) { soldInWindow = true; break; }
      }
      if (soldInWindow) { recentAccFlips++; recentAccFlipList.push(w); }
    }

    // Dormant wake-ups in 7-day window
    let recentDormantWakeups = 0;
    let recentDormantSelling = 0;
    for (const w of [...buckets.trader.wallets, ...buckets.reducer.wallets]) {
      const tl = walletTimeline.get(w.addr);
      if (tl.length < 4) continue;
      const beforeWindow = tl.filter(t => t.snapIdx <= windowStart);
      const inWindow = tl.filter(t => t.snapIdx > windowStart);
      if (beforeWindow.length < 3 || inWindow.length < 1) continue;
      let wasDormant = true;
      for (let i = 1; i < beforeWindow.length; i++) {
        if (Math.abs(beforeWindow[i].balance - beforeWindow[i - 1].balance) > MOVE_THRESHOLD) { wasDormant = false; break; }
      }
      if (!wasDormant) continue;
      let movedInWindow = false;
      for (let i = 0; i < inWindow.length; i++) {
        const prev_i = i === 0 ? beforeWindow[beforeWindow.length - 1] : inWindow[i - 1];
        if (Math.abs(inWindow[i].balance - prev_i.balance) > MOVE_THRESHOLD) { movedInWindow = true; break; }
      }
      if (movedInWindow) {
        recentDormantWakeups++;
        if (w.balance < (beforeWindow[beforeWindow.length - 1]?.balance || tl[0].balance) - MOVE_THRESHOLD) recentDormantSelling++;
      }
    }

    // 7-day price return
    const windowStartPrice = allSnaps[windowStart]?.price || price;
    const sevenDayReturn = windowStartPrice > 0 ? ((price - windowStartPrice) / windowStartPrice) * 100 : 0;

    // Holder growth rate
    const holderGrowthPerDay = (() => {
      const firstH = allSnaps.find(s => s.uniqueOwners);
      if (!firstH || firstH === current || !current.uniqueOwners) return 0;
      const days = (new Date(current.timestamp) - new Date(firstH.timestamp)) / 86400000;
      return days > 0.1 ? (current.uniqueOwners - firstH.uniqueOwners) / days : 0;
    })();

    // Revenue vs price divergence (14-day window)
    const DIVERGENCE_WINDOW = 14;
    const divCutoff = new Date(new Date(current.timestamp).getTime() - DIVERGENCE_WINDOW * 86400000);
    const divStartSnap = allSnaps.find(s => new Date(s.timestamp) >= divCutoff) || allSnaps[0];
    const divDays = (new Date(current.timestamp) - new Date(divStartSnap.timestamp)) / 86400000;

    let revenueGrowthRate = null, priceGrowthRate = null, revenueDiverging = false, dailyBuybackUsdAtDivStart = null;
    if (divDays >= 3 && divStartSnap.price && divStartSnap.totalSupply) {
      priceGrowthRate = divStartSnap.price > 0 ? ((price - divStartSnap.price) / divStartSnap.price) * 100 : 0;
      const divStartIdx = allSnaps.indexOf(divStartSnap);
      if (divStartIdx >= 1) {
        const prevOfStart = allSnaps[Math.max(0, divStartIdx - 5)];
        const spanStart = (new Date(divStartSnap.timestamp) - new Date(prevOfStart.timestamp)) / 86400000;
        if (spanStart > 0.5) {
          const burnRateStart = (prevOfStart.totalSupply - divStartSnap.totalSupply) / spanStart;
          dailyBuybackUsdAtDivStart = burnRateStart * divStartSnap.price;
        }
      }
      if (dailyBuybackUsdAtDivStart && dailyBuybackUsdAtDivStart > 0) {
        revenueGrowthRate = ((dailyBuybackUsd - dailyBuybackUsdAtDivStart) / dailyBuybackUsdAtDivStart) * 100;
        revenueDiverging = priceGrowthRate > 0 && revenueGrowthRate !== null && priceGrowthRate > revenueGrowthRate + 10;
      }
    }

    const yieldTrap = dailyBuybackUsdAtDivStart !== null && dailyBuybackUsd < dailyBuybackUsdAtDivStart * 0.9 && priceGrowthRate > 5;

    // Yield trend over recent snapshots
    let yieldTrending = null;
    if (allSnaps.length >= 10) {
      const recentYields = [];
      const yieldCheckSnaps = allSnaps.slice(-Math.min(20, allSnaps.length));
      for (const snap of yieldCheckSnaps) {
        if (!snap.price || !snap.totalSupply) continue;
        const snapCirc = ORIGINAL_SUPPLY - (ORIGINAL_SUPPLY - snap.totalSupply) - custodianBal;
        const snapCircMcap = snap.price * snapCirc;
        if (snapCircMcap > 0) recentYields.push((annualBuybackUsd / snapCircMcap) * 100);
      }
      if (recentYields.length >= 5) {
        const firstHalf = recentYields.slice(0, Math.floor(recentYields.length / 2));
        const secondHalf = recentYields.slice(Math.floor(recentYields.length / 2));
        const avgFirst = firstHalf.reduce((s, y) => s + y, 0) / firstHalf.length;
        const avgSecond = secondHalf.reduce((s, y) => s + y, 0) / secondHalf.length;
        const yieldChange = avgFirst > 0 ? ((avgSecond - avgFirst) / avgFirst) * 100 : 0;
        if (yieldChange < -15) yieldTrending = "down";
        else if (yieldChange > 15) yieldTrending = "up";
        else yieldTrending = "flat";
      }
    }

    // Exchange flow computation
    const exchAddrs = LABELED_WALLETS.filter(w => w.category === "exchange").map(w => w.addr);
    let exchNowTotal = 0, exchBaseTotal = 0;
    for (const addr of exchAddrs) {
      const curr = current.holders.find(h => h.addr === addr);
      const base = baseline?.holders.find(h => h.addr === addr);
      if (curr) exchNowTotal += curr.balance;
      if (base) exchBaseTotal += base.balance;
    }
    const exchNetFlow = exchNowTotal - exchBaseTotal;
    const krakenAddrs = exchAddrs.filter(a => LABEL_MAP.get(a)?.label?.includes("Kraken"));
    let krakenNow = 0, krakenBase = 0;
    for (const addr of krakenAddrs) {
      const curr = current.holders.find(h => h.addr === addr);
      const base = baseline?.holders.find(h => h.addr === addr);
      if (curr) krakenNow += curr.balance;
      if (base) krakenBase += base.balance;
    }
    const krakenFlow = krakenNow - krakenBase;
    const organicExchFlow = exchNetFlow - krakenFlow;

    // Exchange organic inflow persistence
    let exchInflowPersistent = false;
    if (allSnaps.length >= 4) {
      const checkPoints = [allSnaps.length - 1, Math.max(0, allSnaps.length - 4), Math.max(0, allSnaps.length - 8)];
      let inflowRuns = 0;
      for (const idx of checkPoints) {
        if (idx === allSnaps.length - 1) {
          if (organicExchFlow > 0) inflowRuns++;
        } else {
          const snapA = allSnaps[Math.max(0, idx - 3)];
          const snapB = allSnaps[idx];
          let exchA = 0, exchB = 0;
          for (const addr of exchAddrs) {
            exchA += snapA.holders.find(h => h.addr === addr)?.balance || 0;
            exchB += snapB.holders.find(h => h.addr === addr)?.balance || 0;
          }
          if (exchB > exchA) inflowRuns++;
        }
      }
      exchInflowPersistent = inflowRuns >= 2;
    }

    // Reducer pool expanding
    const prevReducerCount = (() => {
      if (allSnaps.length < 10) return reducerData.length;
      const midIdx = Math.floor(allSnaps.length / 2);
      const midSnap = allSnaps[midIdx];
      let count = 0;
      for (const h of midSnap.holders) {
        const info = LABEL_MAP.get(h.addr);
        if (info) continue;
        const tl = walletTimeline.get(h.addr);
        if (!tl || tl.length < 2) continue;
        const tlToMid = tl.filter(t => t.snapIdx <= midIdx);
        if (tlToMid.length < 2) continue;
        let ups = 0, downs = 0;
        for (let i = 1; i < tlToMid.length; i++) {
          const diff = tlToMid[i].balance - tlToMid[i - 1].balance;
          if (diff > MOVE_THRESHOLD) ups++;
          else if (diff < -MOVE_THRESHOLD) downs++;
        }
        if (ups === 0 && downs > 0) count++;
      }
      return count;
    })();
    const reducerPoolExpanding = reducerData.length > prevReducerCount + 5;

    // Top 20 deconcentration
    const top20Deconcentration = (() => {
      if (!baseline) return 0;
      const top20NowPct = (current.holders.slice(0, 20).reduce((s, h) => s + h.balance, 0) / totalSupply) * 100;
      const top20BasePct = (baseline.holders.slice(0, 20).reduce((s, h) => s + h.balance, 0) / baseline.totalSupply) * 100;
      return top20NowPct - top20BasePct;
    })();

    const lpCritical = lpTotal < 1_500_000_000;

    // --- Smart Money Signals ---
    console.log(`\n  ${BOLD}⑤ Smart Money Signals${RESET}`);

    // Accumulator flips (cumulative for context, but trigger uses 7-day rate)
    let accFlips = 0;
    const accFlipList = [];
    for (const w of [...buckets.trader.wallets, ...buckets.reducer.wallets]) {
      const tl = walletTimeline.get(w.addr);
      if (tl.length < 6) continue;
      const mid = Math.floor(tl.length / 2);
      let firstHalfClean = true;
      let hadUps = false;
      for (let i = 1; i < mid; i++) {
        const diff = tl[i].balance - tl[i - 1].balance;
        if (diff < -MOVE_THRESHOLD) { firstHalfClean = false; break; }
        if (diff > MOVE_THRESHOLD) hadUps = true;
      }
      if (firstHalfClean && hadUps) {
        accFlips++;
        accFlipList.push(w);
      }
    }

    console.log(`    Accumulator flips:   ${accFlips} total (${recentAccFlips} in last 7d)`);
    if (accFlipList.length > 0) {
      for (const w of accFlipList.slice(0, 3)) {
        console.log(`      → ${shortAddr(w.addr)} (${fmtNum(w.balance)} tokens)`);
      }
    }

    // Dormant wake-ups (cumulative for context, trigger uses 7-day rate)
    let dormantWakeups = 0;
    let dormantWakeupSelling = 0;
    for (const w of [...buckets.trader.wallets, ...buckets.reducer.wallets]) {
      const tl = walletTimeline.get(w.addr);
      if (tl.length < 6) continue;
      const cutoff = Math.floor(tl.length * 0.6);
      let wasDormant = true;
      for (let i = 1; i < cutoff; i++) {
        if (Math.abs(tl[i].balance - tl[i - 1].balance) > MOVE_THRESHOLD) { wasDormant = false; break; }
      }
      if (wasDormant) {
        dormantWakeups++;
        if (w.balance < tl[0].balance - MOVE_THRESHOLD) dormantWakeupSelling++;
      }
    }
    console.log(`    Dormant wake-ups:    ${dormantWakeups} total (${recentDormantWakeups} in last 7d, ${recentDormantSelling} selling)`);

    console.log(`    Exchange flow:       ${exchNetFlow < 0 ? GREEN : RED}${fmtDelta(exchNetFlow)}${RESET} total (${exchNetFlow < 0 ? "outflow" : "inflow"})`);
    console.log(`      Kraken (locked):   ${fmtDelta(krakenFlow)} (vesting distribution, not organic)`);
    console.log(`      Organic:           ${organicExchFlow < 0 ? GREEN : RED}${fmtDelta(organicExchFlow)}${RESET} ${organicExchFlow < 0 ? "(net organic outflow ✓)" : "(net organic inflow ⚠)"}`);

    // Concentration shift (top 10/20 vs baseline = distribution indicator)
    if (baseline) {
      const top20Now = current.holders.slice(0, 20).reduce((s, h) => s + h.balance, 0);
      const top20Base = baseline.holders.slice(0, 20).reduce((s, h) => s + h.balance, 0);
      const top20NowPct = (top20Now / totalSupply) * 100;
      const top20BasePct = (top20Base / baseline.totalSupply) * 100;
      const concShift = top20NowPct - top20BasePct;
      console.log(`    Concentration:       Top 20 ${concShift >= 0 ? "+" : ""}${concShift.toFixed(2)}pp since baseline ${concShift < -2 ? RED + "(distribution)" + RESET : concShift > 0 ? "(concentrating)" : "(stable)"}`);
      if (concShift < -5) console.log(`      ${RED}⚠ HEAVY DISTRIBUTION — whales dumping to retail${RESET}`);
    }

    console.log(`    Pure accumulators:   ${GREEN}${buckets.accumulator.wallets.length} wallets${RESET} (only ever bought, never sold)`);

    // --- Overall Phase Assessment ---
    console.log(`\n  ${BOLD}⑥ PHASE ASSESSMENT${RESET}`);

    // Phase thresholds based on buyback yield on CIRCULATING supply
    // Apple buyback yield on market cap (shares outstanding) is ~2.5%
    // Circulating here excludes buyback wallet + custodian (permanently non-circulating)
    let phase, phaseNum, phaseColor;
    const effectiveYield = buybackEstimated ? buybackYield : buybackYield;
    if (buybackYield > 20 || (buybackEstimated && buybackYield > 10)) { phase = "MECHANICAL REPRICING"; phaseNum = 1; phaseColor = GREEN; }
    else if (buybackYield > 10) { phase = "RECOGNITION"; phaseNum = 2; phaseColor = GREEN; }
    else if (buybackYield > 5) { phase = "EARLY MANIA"; phaseNum = 3; phaseColor = "\x1b[33m"; }
    else if (buybackYield > 2.5) { phase = "LATE MANIA"; phaseNum = 4; phaseColor = RED; }
    else if (buybackEstimated) { phase = "MECHANICAL REPRICING (estimated)"; phaseNum = 1; phaseColor = GREEN; }
    else { phase = "OVERSHOOT / BLOW-OFF TOP"; phaseNum = 5; phaseColor = RED; }

    // Phase progress bar
    const phaseLabels = ["Mechanical", "Recognition", "Early Mania", "Late Mania", "Blow-off"];
    const progressBar = phaseLabels.map((p, i) => {
      if (i + 1 === phaseNum) return `${phaseColor}${BOLD}▶ ${p}${RESET}`;
      if (i + 1 < phaseNum) return `${DIM}✓ ${p}${RESET}`;
      return `${DIM}○ ${p}${RESET}`;
    }).join("  →  ");
    console.log(`    ${progressBar}`);
    console.log(`    Phase:        ${phaseColor}${phase}${RESET}`);

    // --- Display restructured triggers ---
    console.log(`\n    ${BOLD}Sell trigger checklist:${RESET}`);
    const yieldReliable = !buybackEstimated;

    console.log(`    ${DIM}─── Tier 1: Valuation (primary anchors) ───${RESET}`);
    const t1a = { label: "Buyback yield < 10% → TRIM", met: yieldReliable && buybackYield < 10 };
    const t1b = { label: "Buyback yield < 5% → REDUCE", met: yieldReliable && buybackYield < 5 };
    const t1c = { label: "Buyback yield < 2.5% (Apple parity) → EXIT", met: yieldReliable && buybackYield < 2.5 };
    const t1d = { label: `Yield trend declining (last ${allSnaps.length >= 10 ? Math.min(20, allSnaps.length) : "?"} snapshots)`, met: yieldTrending === "down" };
    for (const t of [t1a, t1b, t1c, t1d]) {
      const icon = t.met ? `${RED}☑${RESET}` : `${GREEN}☐${RESET}`;
      console.log(`      ${icon} ${t.label}${t.met ? ` ${RED}← ACTIVE${RESET}` : ""}`);
    }

    console.log(`    ${DIM}─── Tier 2: Revenue divergence (meta-signal) ───${RESET}`);
    const t2a = { label: "Revenue declining while price rising (YIELD TRAP)", met: yieldTrap };
    const t2b = { label: `Price outpacing revenue (14d: price ${priceGrowthRate !== null ? (priceGrowthRate >= 0 ? "+" : "") + priceGrowthRate.toFixed(0) + "%" : "?"} vs rev ${revenueGrowthRate !== null ? (revenueGrowthRate >= 0 ? "+" : "") + revenueGrowthRate.toFixed(0) + "%" : "?"})`, met: revenueDiverging };
    for (const t of [t2a, t2b]) {
      const icon = t.met ? `${RED}☑${RESET}` : `${GREEN}☐${RESET}`;
      console.log(`      ${icon} ${t.label}${t.met ? ` ${RED}← DANGER${RESET}` : ""}`);
    }

    console.log(`    ${DIM}─── Tier 3: Flow & structure (confirms direction) ───${RESET}`);
    const t3a = { label: `Exchange organic inflow sustained (${exchInflowPersistent ? "persistent" : "not persistent"})`, met: exchInflowPersistent };
    const t3b = { label: `Reducer pool expanding (${prevReducerCount} → ${reducerData.length} reducers)`, met: reducerPoolExpanding };
    const t3c = { label: `Top 20 deconcentrating > 2pp (${top20Deconcentration >= 0 ? "+" : ""}${top20Deconcentration.toFixed(1)}pp)`, met: top20Deconcentration < -2 };
    const t3d = { label: `LP depth critical < 1.5B (${(lpTotal / 1e9).toFixed(1)}B)`, met: lpCritical };
    for (const t of [t3a, t3b, t3c, t3d]) {
      const icon = t.met ? `${RED}☑${RESET}` : `${GREEN}☐${RESET}`;
      console.log(`      ${icon} ${t.label}${t.met ? ` ${YELLOW}← WARNING${RESET}` : ""}`);
    }

    console.log(`    ${DIM}─── Tier 4: Behavioral mania (rate-based, 7-day window) ───${RESET}`);
    const t4a = { label: `Accumulator flips in 7d: ${recentAccFlips} (threshold: >5)`, met: recentAccFlips > 5 };
    const t4b = { label: `Dormant wake-ups selling in 7d: ${recentDormantSelling} (threshold: >5)`, met: recentDormantSelling > 5 };
    const t4c = { label: `Holder growth > 1K/day (${holderGrowthPerDay.toFixed(0)}/day)`, met: holderGrowthPerDay > 1000 };
    const t4d = { label: `7-day price return > 50% (${sevenDayReturn >= 0 ? "+" : ""}${sevenDayReturn.toFixed(1)}%)`, met: sevenDayReturn > 50 };
    for (const t of [t4a, t4b, t4c, t4d]) {
      const icon = t.met ? `${RED}☑${RESET}` : `${GREEN}☐${RESET}`;
      console.log(`      ${icon} ${t.label}${t.met ? ` ${YELLOW}← MANIA${RESET}` : ""}`);
    }

    // Aggregate scoring
    const tier1Active = [t1a, t1b, t1c, t1d].filter(t => t.met).length;
    const tier2Active = [t2a, t2b].filter(t => t.met).length;
    const tier3Active = [t3a, t3b, t3c, t3d].filter(t => t.met).length;
    const tier4Active = [t4a, t4b, t4c, t4d].filter(t => t.met).length;
    const totalActive = tier1Active + tier2Active + tier3Active + tier4Active;

    console.log(`\n    ${BOLD}Signal summary:${RESET}`);
    console.log(`      Tier 1 (Valuation):  ${tier1Active}/4 ${tier1Active >= 2 ? RED + "← TRIM/REDUCE" + RESET : tier1Active >= 1 ? YELLOW + "← WATCH" + RESET : GREEN + "✓ clear" + RESET}`);
    console.log(`      Tier 2 (Revenue):    ${tier2Active}/2 ${tier2Active >= 1 ? RED + "← OVERRIDE: revenue failing" + RESET : GREEN + "✓ revenue tracking price" + RESET}`);
    console.log(`      Tier 3 (Structure):  ${tier3Active}/4 ${tier3Active >= 2 ? YELLOW + "← structural stress" + RESET : GREEN + "✓ intact" + RESET}`);
    console.log(`      Tier 4 (Mania):      ${tier4Active}/4 ${tier4Active >= 3 ? RED + "← LATE MANIA" + RESET : tier4Active >= 1 ? YELLOW + "← early signs" + RESET : GREEN + "✓ no mania" + RESET}`);

    // Decision logic
    let sellDecision, sellDecisionColor;
    if (tier2Active >= 1) {
      sellDecision = "TRIM NOW — revenue diverging from price";
      sellDecisionColor = RED;
    } else if (t1c.met) {
      sellDecision = "EXIT — yield at/below Apple parity";
      sellDecisionColor = "\x1b[41m\x1b[37m"; // red bg
    } else if (t1b.met) {
      sellDecision = "REDUCE — yield below 5%";
      sellDecisionColor = RED;
    } else if (t1a.met && tier3Active + tier4Active >= 3) {
      sellDecision = "TRIM — yield <10% + multiple structural/mania signals";
      sellDecisionColor = RED;
    } else if (t1a.met) {
      sellDecision = "PREPARE — yield approaching fair value";
      sellDecisionColor = YELLOW;
    } else if (tier4Active >= 3) {
      sellDecision = "WATCH — mania signals despite healthy yield";
      sellDecisionColor = YELLOW;
    } else {
      sellDecision = "HOLD — yield strong, structure intact";
      sellDecisionColor = GREEN;
    }
    console.log(`\n    ${BOLD}→ ${sellDecisionColor}${sellDecision}${RESET}`);

    // Key watch items
    console.log(`\n    ${BOLD}Key watch items:${RESET}`);
    const topReducerSorted = [...reducerData].sort((a, b) => b.remaining - a.remaining);
    if (topReducerSorted.length > 0) {
      const tr = topReducerSorted[0];
      const trName = LABEL_MAP.get(tr.addr)?.label || shortAddr(tr.addr);
      console.log(`      • Top seller ${trName}: ~${tr.daysLeft === Infinity ? "∞" : tr.daysLeft.toFixed(0)} days until exhaustion`);
    }
    console.log(`      • Reducer pool: ${fmtNum(totalReducerTokens)} tokens, ${reducerFeedsDays.toFixed(0)} days of buyback`);
    console.log(`      • Yield: ${buybackYield.toFixed(1)}% → TRIM at <10%, REDUCE at <5%, EXIT at <2.5%`);
    if (revenueGrowthRate !== null) {
      console.log(`      • Revenue trend (14d): ${revenueGrowthRate >= 0 ? GREEN + "+" : RED}${revenueGrowthRate.toFixed(0)}%${RESET} — ${revenueGrowthRate > 0 ? "growing (bullish)" : revenueGrowthRate > -10 ? "flat (neutral)" : "declining (DANGER)"}`);
    }
    console.log(`      • Price targets: TRIM ~$${(price * (buybackYield / 10)).toFixed(4)} (10% yield), REDUCE ~$${(price * (buybackYield / 5)).toFixed(4)} (5% yield), EXIT ~$${priceAt2_5.toFixed(4)} (2.5% yield)`);
    const teamUnlock = new Date("2026-07-11");
    const daysToUnlock = (teamUnlock - new Date(current.timestamp)) / 86400000;
    if (daysToUnlock > 0) {
      console.log(`      • Team unlock (25%): ~${daysToUnlock.toFixed(0)} days away — potential sell pressure event`);
    } else {
      console.log(`      • Team unlock (25%): ${RED}PASSED${RESET} ${(-daysToUnlock).toFixed(0)} days ago`);
    }
  }

  // ─── Save to history ───
  history.push(current);
  saveHistory(history);
  console.log(`\n  History saved (${history.length} snapshots) to ${HISTORY_FILE}`);
  console.log(`${"═".repeat(120)}\n`);
}

main().catch(console.error);
