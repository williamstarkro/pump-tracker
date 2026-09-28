#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════════
//  PUMP Price Monitor — lightweight 5-min price check via Jupiter
//  Stores rolling 24h history, sends alerts on significant moves.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = join(__dirname, "pump-price-history.json");
const STATE_FILE = join(__dirname, "pump-price-alert-state.json");

const MINT = "pumpCmXqMfrsAkQ5r49WcJnRayYRqmXz6ae8H7H9Dfn";
const SOL_MINT = "So11111111111111111111111111111111111111112";
const DEXSCREENER_URL = `https://api.dexscreener.com/latest/dex/tokens/${MINT}`;
const DEXSCREENER_SOL_URL = `https://api.dexscreener.com/latest/dex/tokens/${SOL_MINT}`;
const NTFY_TOPIC = process.env.NTFY_TOPIC || "pump-entry-signal-wx7k2m";
const IS_CI = !!process.env.CI;
const MAX_ENTRIES = 288; // 24h at 5-min intervals
const ALERT_COOLDOWN_MS = 15 * 60 * 1000; // 15 minutes

// ─── Notifications ───

function notifyMacOS(title, message) {
  if (IS_CI) return;
  try {
    const esc = s => s.replace(/"/g, '\\"').replace(/\n/g, "\\n");
    execSync(`osascript -e 'display notification "${esc(message)}" with title "${esc(title)}"'`);
  } catch {}
}

async function notifyNtfy(title, message, priority = 3) {
  try {
    const sanitize = s => s.replace(/[^\x20-\x7E]/g, "");
    await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: "POST",
      headers: {
        Title: sanitize(title),
        Priority: String(priority),
        Tags: priority >= 4 ? "rotating_light" : "chart_with_upwards_trend",
      },
      body: sanitize(message),
    });
  } catch {}
}

async function sendAlert(type, title, message, priority = 3) {
  const state = loadState();
  const now = Date.now();
  if (state.lastAlerts[type] && now - state.lastAlerts[type] < ALERT_COOLDOWN_MS) return;
  state.lastAlerts[type] = now;
  saveState(state);

  console.log(`  ALERT [${type}]: ${title} — ${message}`);
  notifyMacOS(title, message);
  await notifyNtfy(title, message, priority);
}

// ─── State ───

function loadState() {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {}
  return { lastAlerts: {} };
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── History ───

function loadHistory() {
  try {
    if (existsSync(HISTORY_FILE)) return JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));
  } catch {}
  return [];
}

function saveHistory(history) {
  writeFileSync(HISTORY_FILE, JSON.stringify(history));
}

// ─── Main ───

async function main() {
  // Fetch price from DexScreener (free, no key, rich data)
  let price, volume24h, txns24h, priceChange1h;
  try {
    const resp = await fetch(DEXSCREENER_URL);
    if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
    const data = await resp.json();
    const pair = data.pairs?.find(p => p.dexId === "pumpswap") || data.pairs?.[0];
    if (!pair) throw new Error("No pair data");
    price = parseFloat(pair.priceUsd);
    volume24h = pair.volume?.h24 || 0;
    txns24h = (pair.txns?.h24?.buys || 0) + (pair.txns?.h24?.sells || 0);
    priceChange1h = pair.priceChange?.h1 || 0;
    if (!price || isNaN(price)) throw new Error("No price in response");
  } catch (e) {
    console.error(`  Price fetch failed: ${e.message}`);
    process.exit(1);
  }

  // Fetch SOL price for correlation tracking
  let solPrice = null;
  try {
    const solResp = await fetch(DEXSCREENER_SOL_URL);
    if (solResp.ok) {
      const solData = await solResp.json();
      const solPair = solData.pairs?.[0];
      if (solPair) solPrice = parseFloat(solPair.priceUsd);
      if (isNaN(solPrice)) solPrice = null;
    }
  } catch {}

  const now = new Date();
  const entry = { timestamp: now.toISOString(), price, pumpPrice: price, solPrice };

  // Load and append history
  const history = loadHistory();
  history.push(entry);

  // Cap at 24h
  while (history.length > MAX_ENTRIES) history.shift();
  saveHistory(history);

  // ─── Compute metrics ───
  const prices = history.map(h => h.price);
  const timestamps = history.map(h => new Date(h.timestamp).getTime());
  const nowMs = now.getTime();

  // Find entries at time offsets
  const findAt = (hoursAgo) => {
    const target = nowMs - hoursAgo * 3600000;
    let best = null, bestDist = Infinity;
    for (let i = 0; i < history.length; i++) {
      const dist = Math.abs(timestamps[i] - target);
      if (dist < bestDist) { bestDist = dist; best = i; }
    }
    // Accept if within 50% of window
    if (best !== null && bestDist < hoursAgo * 3600000 * 0.5) return history[best];
    return null;
  };

  const h1ago = findAt(1);
  const h4ago = findAt(4);
  const high24 = Math.max(...prices);
  const low24 = Math.min(...prices);

  const change1h = h1ago ? ((price - h1ago.price) / h1ago.price) * 100 : null;
  const change4h = h4ago ? ((price - h4ago.price) / h4ago.price) * 100 : null;

  // Volatility: stddev of 5-min returns over last hour
  const oneHourAgo = nowMs - 3600000;
  const recentEntries = history.filter(h => new Date(h.timestamp).getTime() >= oneHourAgo);
  let volatility = null;
  if (recentEntries.length >= 3) {
    const returns = [];
    for (let i = 1; i < recentEntries.length; i++) {
      returns.push((recentEntries[i].price - recentEntries[i - 1].price) / recentEntries[i - 1].price);
    }
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((s, r) => s + (r - mean) ** 2, 0) / returns.length;
    volatility = Math.sqrt(variance) * 100;
  }

  // ─── Display ───
  const fmt = n => n !== null ? (n > 0 ? `+${n.toFixed(2)}%` : `${n.toFixed(2)}%`) : "n/a";

  console.log(`  PUMP $${price.toFixed(6)} | 1h: ${fmt(change1h)} | 4h: ${fmt(change4h)} | 24h H/L: $${high24.toFixed(6)}/$${low24.toFixed(6)}${volatility !== null ? ` | vol: ${volatility.toFixed(3)}%` : ""} | vol24h: $${(volume24h/1e6).toFixed(1)}M | ${history.length} pts`);

  // ─── Alerts ───
  if (change1h !== null) {
    if (change1h <= -5) {
      await sendAlert("dip", `DIP ALERT -- PUMP down ${Math.abs(change1h).toFixed(1)}% in 1h`, `Price: $${price.toFixed(6)} (was $${h1ago.price.toFixed(6)} 1h ago). 24h range: $${low24.toFixed(6)}-$${high24.toFixed(6)}`, 4);
    } else if (change1h >= 5) {
      await sendAlert("spike", `SPIKE ALERT -- PUMP up ${change1h.toFixed(1)}% in 1h`, `Price: $${price.toFixed(6)} (was $${h1ago.price.toFixed(6)} 1h ago). 24h range: $${low24.toFixed(6)}-$${high24.toFixed(6)}`, 4);
    }
  }

  // New 24h high (only if we have at least 1h of data and current price IS the high)
  if (history.length >= 12 && price >= high24 && prices.slice(0, -1).length > 0) {
    const prevHigh = Math.max(...prices.slice(0, -1));
    if (price > prevHigh * 1.001) {
      await sendAlert("high", `NEW 24H HIGH -- $${price.toFixed(6)}`, `Previous high: $${prevHigh.toFixed(6)}. Up ${((price / prevHigh - 1) * 100).toFixed(2)}%`, 3);
    }
  }

  // Breaking 24h low by >3%
  if (history.length >= 12 && price <= low24) {
    const prevLow = Math.min(...prices.slice(0, -1));
    if (prices.slice(0, -1).length > 0 && price < prevLow * 0.97) {
      await sendAlert("low", `BREAKING 24H LOW -- $${price.toFixed(6)}`, `Previous low: $${prevLow.toFixed(6)}. Down ${((1 - price / prevLow) * 100).toFixed(2)}% below`, 5);
    }
  }
}

main().catch(e => { console.error(e); process.exit(1); });
