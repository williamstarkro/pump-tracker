#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════════
//  PUMP Whale Tracker
//  Detects new large positions, accumulation/distribution patterns,
//  and smart money flow from hourly snapshot diffs.
//  Run standalone or add to cron chain after pump-tracker.js.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = join(__dirname, "pump-tracker-history.json");
const WHALE_STATE_FILE = join(__dirname, "pump-whale-state.json");
const IS_CI = !!process.env.CI;
const NTFY_TOPIC = process.env.NTFY_TOPIC || "";

// ─── Known wallets (exclude from whale tracking) ───
const KNOWN_WALLETS = {
  "FWznbcNXWQuHTawe9RxvQ2LdCENssh12dsznf4RiWB7": "Binance Hot",
  "3PvMKFbMBRZaGMyjFAbbRLMFJoaHdrw3QiMGW7gGP97b": "Binance 3",
  "5tzFkiKscXHK5ZXCGbXZxdw7gTjjD1mBwuoFbhUvuAi9": "Bybit Hot",
  "2ojv9BAiHUrvsm9gxDe7fJSzbNZSJcxZvf8dqnvHcmiN": "OKX Hot",
  "AC5RDfQFmDS1deWZos921JfqscXdByf2BKHs5ACWjtW2": "Kraken Cold",
  "GJRs4FwHtemZ5ZE9Q3MbAe41n39FUbxYguKR2iAV5h4G": "Kraken Hot",
  "2AQdump7YKNyJn65sCQJhfLFo9csy4qGB1GNmShvqmqV": "HyperUnit Hot",
  "BmFdpraQhkiDQE6SnfG5PVRdJ3NTSe57DKjEMBJntaNs": "Unknown Exchange",
  "DdXFVFqLzrGCnnHqYj6cc49a4GqUSt6XGkbeafpPpxhg": "PumpSwap LP",
  "BzLggAxfeGn1LeCjd1HWQNSX8g3kGNkaSvuGVB1d6gm3": "Token Custodian",
  "FiEtxCFaZfFxfawbsUJLikfxZhyBpZRCcPJx6U4y8n2e": "Team (locked)",
  "DeSoLS8e43C6qHhdAt7cPhHa6tiMiJzzD3a5RQ1bcrTH": "Team",
  "9Hp78TcPsfVE2HYbcBiC4bQDqYSyBPDh71TfMCVCdBaS": "Team",
  "HBsMbiWnBsMbgpzyFfTT4PqGGfZ8Zv8qSmP6QMvfZvkh": "Team",
  "CQ5RNiBpM1eJ6AzBoFdqJxAJuBup41KaBpDkei4v3U2S": "Team (distributed)",
  "5GGNrcHnNoGLG7QP7iR9ti7FjVoaVqJCb8Lf9S7QYDMZ": "Ecosystem",
  "7L8s4EWFG66q23QzwifSdsH7aqKRb5ecGg2FXt2fmh1P": "Ecosystem",
};

const TEAM_ECO_ADDRS = new Set(Object.keys(KNOWN_WALLETS).filter(k =>
  KNOWN_WALLETS[k].startsWith("Team") || KNOWN_WALLETS[k].startsWith("Ecosystem") || KNOWN_WALLETS[k].startsWith("Token Custodian")
));

const EXCHANGE_ADDRS = new Set(Object.keys(KNOWN_WALLETS).filter(k =>
  KNOWN_WALLETS[k].includes("Binance") || KNOWN_WALLETS[k].includes("Bybit") ||
  KNOWN_WALLETS[k].includes("OKX") || KNOWN_WALLETS[k].includes("Kraken") ||
  KNOWN_WALLETS[k].includes("HyperUnit") || KNOWN_WALLETS[k].includes("Unknown Exchange")
));

const MIN_WHALE_BALANCE = 1_000_000_000; // 1B tokens = ~$5M at current price
const MIN_MOVE_SIZE = 500_000_000; // 500M tokens = notable move
const NEW_WHALE_THRESHOLD = 2_000_000_000; // 2B tokens = new whale alert

// ─── Notifications ───

function notifyMacOS(title, message) {
  if (IS_CI) return;
  try {
    const esc = s => s.replace(/"/g, '\\"').replace(/\n/g, "\\n");
    execSync(`osascript -e 'display notification "${esc(message)}" with title "${esc(title)}"'`);
  } catch {}
}

async function notifyNtfy(title, message, priority = 3) {
  if (!NTFY_TOPIC) { console.log(`  [no NTFY_TOPIC] ${title}`); return; }
  try {
    const sanitize = s => s.replace(/[^\x20-\x7E]/g, "");
    await fetch(`https://ntfy.sh/${NTFY_TOPIC}`, {
      method: "POST",
      headers: {
        Title: sanitize(title),
        Priority: String(priority),
        Tags: priority >= 4 ? "whale" : "mag",
      },
      body: sanitize(message),
    });
  } catch {}
}

// ─── State ───

function loadState() {
  try {
    if (existsSync(WHALE_STATE_FILE)) return JSON.parse(readFileSync(WHALE_STATE_FILE, "utf-8"));
  } catch {}
  return { knownWhales: {}, lastAlertTime: null, alerts: [] };
}

function saveState(state) {
  writeFileSync(WHALE_STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── Helpers ───

function shortAddr(addr) {
  return addr.slice(0, 4) + ".." + addr.slice(-4);
}

function fmtTokens(n) {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(2) + "B";
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(0) + "M";
  return n.toLocaleString();
}

function isUnknownWhale(addr) {
  return !TEAM_ECO_ADDRS.has(addr) && !EXCHANGE_ADDRS.has(addr) && addr !== "DdXFVFqLzrGCnnHqYj6cc49a4GqUSt6XGkbeafpPpxhg";
}

// ─── Analysis ───

function analyzeWhaleMovements(snapshots) {
  if (snapshots.length < 2) return null;

  const latest = snapshots[snapshots.length - 1];
  const price = latest.price;
  const BOLD = "\x1b[1m", RESET = "\x1b[0m", GREEN = "\x1b[32m", RED = "\x1b[31m", DIM = "\x1b[2m", YELLOW = "\x1b[33m", CYAN = "\x1b[36m";

  // Build holder maps for different time horizons
  function holderMap(snap) {
    const m = new Map();
    if (snap?.holders) for (const h of snap.holders) m.set(h.addr, h.balance);
    return m;
  }

  const currentMap = holderMap(latest);

  // Find comparison snapshots
  const findAt = (hoursAgo) => {
    const target = new Date(latest.timestamp).getTime() - hoursAgo * 3600000;
    let best = null, bestDist = Infinity;
    for (const s of snapshots) {
      const dist = Math.abs(new Date(s.timestamp).getTime() - target);
      if (dist < bestDist) { bestDist = dist; best = s; }
    }
    if (best && bestDist < hoursAgo * 3600000 * 0.5) return best;
    return null;
  };

  const snap24h = findAt(24);
  const snap3d = findAt(72);
  const snap7d = findAt(168);

  console.log(`${BOLD}═══════════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  PUMP Whale Tracker${RESET}  —  ${latest.timestamp}`);
  console.log(`${BOLD}═══════════════════════════════════════════════════════════════════${RESET}`);
  console.log(`  ${DIM}Price: $${price.toFixed(6)} | Holders: ${latest.uniqueOwners.toLocaleString()}${RESET}`);

  // ── Current whale census ──
  const whales = [];
  for (const h of latest.holders) {
    if (h.balance >= MIN_WHALE_BALANCE && isUnknownWhale(h.addr)) {
      whales.push(h);
    }
  }

  console.log(`\n  ${BOLD}Whale Census (unknown wallets ≥ 1B tokens)${RESET}`);
  console.log(`  Total: ${whales.length} whales holding ${fmtTokens(whales.reduce((s, w) => s + w.balance, 0))} (${(whales.reduce((s, w) => s + w.balance, 0) / latest.totalSupply * 100).toFixed(1)}% of supply)`);

  // ── Movements vs different timeframes ──
  const movements = [];
  const timeframes = [
    { label: "24h", snap: snap24h },
    { label: "3d", snap: snap3d },
    { label: "7d", snap: snap7d },
  ];

  for (const tf of timeframes) {
    if (!tf.snap) continue;
    const prevMap = holderMap(tf.snap);

    console.log(`\n  ${BOLD}Whale Movements (${tf.label})${RESET}`);

    const movers = [];
    // Check all current whales
    for (const h of latest.holders) {
      if (!isUnknownWhale(h.addr)) continue;
      const prevBal = prevMap.get(h.addr) || 0;
      const delta = h.balance - prevBal;

      if (Math.abs(delta) >= MIN_MOVE_SIZE) {
        movers.push({
          addr: h.addr,
          balance: h.balance,
          prevBalance: prevBal,
          delta,
          pctOfSupply: h.balance / latest.totalSupply * 100,
          isNew: prevBal === 0 || prevBal < MIN_WHALE_BALANCE,
          label: KNOWN_WALLETS[h.addr] || null,
        });
      }
    }

    // Check whales that disappeared (were in prev, not in current or balance dropped)
    for (const [addr, prevBal] of prevMap) {
      if (!isUnknownWhale(addr)) continue;
      if (prevBal < MIN_WHALE_BALANCE) continue;
      const curBal = currentMap.get(addr) || 0;
      const delta = curBal - prevBal;
      if (delta < -MIN_MOVE_SIZE && !movers.find(m => m.addr === addr)) {
        movers.push({
          addr,
          balance: curBal,
          prevBalance: prevBal,
          delta,
          pctOfSupply: curBal / latest.totalSupply * 100,
          isNew: false,
          label: KNOWN_WALLETS[addr] || null,
          exited: curBal < MIN_WHALE_BALANCE,
        });
      }
    }

    movers.sort((a, b) => Math.abs(b.delta) - Math.abs(a.delta));

    if (movers.length === 0) {
      console.log(`    ${DIM}No significant movements${RESET}`);
      continue;
    }

    // Aggregate stats
    const accumulators = movers.filter(m => m.delta > 0);
    const distributors = movers.filter(m => m.delta < 0);
    const netFlow = movers.reduce((s, m) => s + m.delta, 0);

    console.log(`    ${accumulators.length} accumulating, ${distributors.length} distributing | Net: ${netFlow > 0 ? GREEN + "+" : RED}${fmtTokens(netFlow)}${RESET} ($${Math.abs(netFlow * price / 1e6).toFixed(1)}M)`);

    for (const m of movers.slice(0, 10)) {
      const arrow = m.delta > 0 ? GREEN + "▲" : RED + "▼";
      const tag = m.isNew ? ` ${YELLOW}NEW WHALE${RESET}` : m.exited ? ` ${RED}EXITED${RESET}` : "";
      console.log(`    ${arrow}${RESET} ${shortAddr(m.addr)} ${fmtTokens(m.balance)} (${m.pctOfSupply.toFixed(2)}%) ${m.delta > 0 ? "+" : ""}${fmtTokens(m.delta)} ($${Math.abs(m.delta * price / 1e6).toFixed(1)}M)${tag}`);
    }

    if (tf.label === "24h") {
      movements.push(...movers);
    }
  }

  // ── Accumulation Score ──
  // Are whales net accumulating or distributing?
  console.log(`\n  ${BOLD}Whale Accumulation Score${RESET}`);

  const horizons = [];
  for (const tf of timeframes) {
    if (!tf.snap) continue;
    const prevMap = holderMap(tf.snap);
    let accumulating = 0, distributing = 0, netDelta = 0;

    for (const h of latest.holders) {
      if (!isUnknownWhale(h.addr) || h.balance < MIN_WHALE_BALANCE) continue;
      const prev = prevMap.get(h.addr) || 0;
      const delta = h.balance - prev;
      if (delta > MIN_MOVE_SIZE) accumulating++;
      if (delta < -MIN_MOVE_SIZE) distributing++;
      netDelta += delta;
    }

    const ratio = distributing > 0 ? accumulating / distributing : accumulating > 0 ? Infinity : 1;
    const signal = ratio > 2 ? GREEN + "STRONG BUY" : ratio > 1 ? GREEN + "ACCUMULATING" : ratio === 1 ? YELLOW + "NEUTRAL" : ratio > 0.5 ? YELLOW + "MIXED" : RED + "DISTRIBUTING";

    console.log(`    ${tf.label}: ${accumulating} buying, ${distributing} selling, ratio ${ratio === Infinity ? "∞" : ratio.toFixed(1)} → ${signal}${RESET} | Net: ${netDelta > 0 ? "+" : ""}${fmtTokens(netDelta)}`);
    horizons.push({ label: tf.label, accumulating, distributing, ratio, netDelta });
  }

  // ── Concentration trend ──
  console.log(`\n  ${BOLD}Whale Concentration${RESET}`);
  const whalePct = whales.reduce((s, w) => s + w.balance, 0) / latest.totalSupply * 100;

  for (const tf of timeframes) {
    if (!tf.snap) continue;
    const prevWhales = tf.snap.holders.filter(h => h.balance >= MIN_WHALE_BALANCE && isUnknownWhale(h.addr));
    const prevPct = prevWhales.reduce((s, w) => s + w.balance, 0) / tf.snap.totalSupply * 100;
    const deltaPct = whalePct - prevPct;
    const dir = deltaPct > 0.1 ? GREEN + "concentrating" : deltaPct < -0.1 ? RED + "dispersing" : YELLOW + "flat";
    console.log(`    ${tf.label}: ${prevWhales.length} → ${whales.length} whales, ${prevPct.toFixed(1)}% → ${whalePct.toFixed(1)}% (${deltaPct > 0 ? "+" : ""}${deltaPct.toFixed(2)}pp) → ${dir}${RESET}`);
  }

  // ── Top individual whales with trajectory ──
  console.log(`\n  ${BOLD}Top 10 Unknown Whales (with 7d trajectory)${RESET}`);
  const map7d = snap7d ? holderMap(snap7d) : new Map();
  const map24h = snap24h ? holderMap(snap24h) : new Map();

  for (let i = 0; i < Math.min(10, whales.length); i++) {
    const w = whales[i];
    const bal7d = map7d.get(w.addr) || 0;
    const bal24h = map24h.get(w.addr) || 0;
    const d7 = w.balance - bal7d;
    const d24 = w.balance - bal24h;
    const arrow7 = d7 > MIN_MOVE_SIZE ? GREEN + "▲" : d7 < -MIN_MOVE_SIZE ? RED + "▼" : "─";
    const arrow24 = d24 > MIN_MOVE_SIZE ? GREEN + "▲" : d24 < -MIN_MOVE_SIZE ? RED + "▼" : "─";
    console.log(`    ${(i + 1).toString().padStart(2)}. ${shortAddr(w.addr)} ${fmtTokens(w.balance)} (${(w.balance / latest.totalSupply * 100).toFixed(2)}%) | 24h: ${arrow24}${RESET} ${d24 !== 0 ? (d24 > 0 ? "+" : "") + fmtTokens(d24) : "flat"} | 7d: ${arrow7}${RESET} ${d7 !== 0 ? (d7 > 0 ? "+" : "") + fmtTokens(d7) : "flat"}`);
  }

  console.log(`\n${BOLD}═══════════════════════════════════════════════════════════════════${RESET}`);

  // ── Alerts for notable events ──
  const alerts = [];
  for (const m of movements) {
    if (m.isNew && m.balance >= NEW_WHALE_THRESHOLD) {
      alerts.push({
        type: "new_whale",
        title: "NEW WHALE -- " + fmtTokens(m.balance) + " position",
        message: `${shortAddr(m.addr)} appeared with ${fmtTokens(m.balance)} tokens ($${(m.balance * price / 1e6).toFixed(1)}M, ${m.pctOfSupply.toFixed(2)}% of supply)`,
        priority: 4,
      });
    }
    if (m.delta > 5_000_000_000) {
      alerts.push({
        type: "mega_accumulation",
        title: "MEGA ACCUMULATION -- +" + fmtTokens(m.delta),
        message: `${shortAddr(m.addr)} added ${fmtTokens(m.delta)} tokens ($${(m.delta * price / 1e6).toFixed(1)}M) in 24h. Now holds ${fmtTokens(m.balance)} (${m.pctOfSupply.toFixed(2)}%)`,
        priority: 4,
      });
    }
    if (m.delta < -5_000_000_000 && !m.exited) {
      alerts.push({
        type: "mega_distribution",
        title: "WHALE DUMP -- " + fmtTokens(Math.abs(m.delta)),
        message: `${shortAddr(m.addr)} sold ${fmtTokens(Math.abs(m.delta))} tokens ($${(Math.abs(m.delta) * price / 1e6).toFixed(1)}M) in 24h. Remaining: ${fmtTokens(m.balance)}`,
        priority: 5,
      });
    }
  }

  return { whales, movements, horizons, alerts };
}

// ─── Main ───

async function main() {
  const raw = JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));

  // Deduplicate to ~1h gaps
  const snapshots = [raw[0]];
  for (let i = 1; i < raw.length; i++) {
    if (new Date(raw[i].timestamp) - new Date(snapshots[snapshots.length - 1].timestamp) >= 3600000)
      snapshots.push(raw[i]);
  }

  const result = analyzeWhaleMovements(snapshots);
  if (!result) { console.log("  Insufficient data"); return; }

  // Send alerts
  const state = loadState();
  const now = Date.now();
  const cooldown = 60 * 60 * 1000; // 1 hour between same-type alerts

  for (const alert of result.alerts) {
    const lastSent = state.alerts?.find(a => a.type === alert.type)?.time || 0;
    if (now - lastSent < cooldown) continue;

    console.log(`\n  ALERT: ${alert.title}`);
    notifyMacOS(alert.title, alert.message);
    await notifyNtfy(alert.title, alert.message, alert.priority);

    state.alerts = state.alerts || [];
    const existing = state.alerts.find(a => a.type === alert.type);
    if (existing) existing.time = now;
    else state.alerts.push({ type: alert.type, time: now });
  }

  state.lastRun = new Date().toISOString();
  saveState(state);
}

main().catch(e => { console.error(e); process.exit(1); });
