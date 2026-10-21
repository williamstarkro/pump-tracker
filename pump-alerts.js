#!/usr/bin/env node

// ═══════════════════════════════════════════════════════════════════
//  PUMP Entry Signal Alerts
//  Reads tracker history, computes backtested entry signals,
//  sends notifications when conditions change.
//  Run standalone or chained after pump-tracker.js in cron.
// ═══════════════════════════════════════════════════════════════════

import { readFileSync, writeFileSync, existsSync } from "fs";
import { execSync } from "child_process";
import { createTransport } from "nodemailer";
import { fileURLToPath } from "url";
import { dirname, join } from "path";
import { deduplicateSnapshots, smoothSupply, computeEntrySignals, computeEntryScore, findSnapshotAtOffset, LABELED_WALLETS } from "./pump-signals.js";
const REGIME_STATE_FILE = join(dirname(fileURLToPath(import.meta.url)), "pump-regime-state.json");

const __dirname = dirname(fileURLToPath(import.meta.url));
const HISTORY_FILE = join(__dirname, "pump-tracker-history.json");
const STATE_FILE = join(__dirname, "pump-alert-state.json");
const FORECAST_LOG = join(__dirname, "pump-forecast-log.json");

// ─── Configuration ───
const IS_CI = !!process.env.CI;
// Scorer-derived notifications (tier / dip / velocity) are MUTED until the scorer is
// re-validated out of sample (see pump-walkforward.js). Set SCORER_ALERTS=1 to re-enable.
// While muted, every alert is still computed, printed and written to the forecast log.
const SCORER_ALERTS_ENABLED = process.env.SCORER_ALERTS === "1";
const CONFIG = {
  ntfy: {
    enabled: true,
    topic: process.env.NTFY_TOPIC || "pump-entry-signal-wx7k2m",
  },
  macos: {
    enabled: !IS_CI,
  },
  email: {
    enabled: false,  // Set to true after configuring below
    to: "starrwill32@gmail.com",
    from: "starrwill32@gmail.com",
    // Generate an App Password: Google Account → Security → 2-Step Verification → App Passwords
    // Create one for "Mail" on "Mac", paste the 16-char password below
    appPassword: "YOUR_GMAIL_APP_PASSWORD_HERE",
  },
};

// ─── SOL market regime ───

async function fetchSOLRegime() {
  try {
    const resp = await fetch(
      "https://api.coingecko.com/api/v3/coins/solana/market_chart?vs_currency=usd&days=7&interval=daily"
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const prices = data.prices;
    if (!prices || prices.length < 2) return null;
    const priceNow = prices[prices.length - 1][1];
    const price7dAgo = prices[0][1];
    const change7d = ((priceNow - price7dAgo) / price7dAgo) * 100;
    let regime;
    if (change7d > 5) regime = "BULL";
    else if (change7d < -5) regime = "BEAR";
    else regime = "NEUTRAL";
    return { price: priceNow, price7dAgo, change7d, regime };
  } catch (e) {
    console.error("  SOL regime fetch failed:", e.message);
    return null;
  }
}

// ─── Fear & Greed Index (contrarian: r=-0.301, #2 predictor) ───

async function fetchFNG() {
  try {
    const resp = await fetch("https://api.alternative.me/fng/?limit=1&format=json");
    if (!resp.ok) return null;
    const data = await resp.json();
    const entry = data.data?.[0];
    if (!entry) return null;
    return { value: parseInt(entry.value), classification: entry.value_classification };
  } catch (e) {
    console.error("  FNG fetch failed:", e.message);
    return null;
  }
}

// ─── BTC price (for BTC-SOL spread — 0% WR when BTC > SOL by >3pp) ───

async function fetchBTCChange() {
  try {
    const resp = await fetch(
      "https://api.coingecko.com/api/v3/coins/bitcoin/market_chart?vs_currency=usd&days=7&interval=daily"
    );
    if (!resp.ok) return null;
    const data = await resp.json();
    const prices = data.prices;
    if (!prices || prices.length < 2) return null;
    const priceNow = prices[prices.length - 1][1];
    const price7dAgo = prices[0][1];
    const change7d = ((priceNow - price7dAgo) / price7dAgo) * 100;
    return { price: priceNow, change7d };
  } catch (e) {
    console.error("  BTC fetch failed:", e.message);
    return null;
  }
}

// ─── Notification dispatch ───

async function notifyMacOS(title, message) {
  if (!CONFIG.macos.enabled) return;
  try {
    const escaped = message.replace(/"/g, '\\"').replace(/\n/g, "\\n");
    const titleEsc = title.replace(/"/g, '\\"');
    execSync(`osascript -e 'display notification "${escaped}" with title "${titleEsc}"'`);
  } catch (e) {
    console.error("  macOS notification failed:", e.message);
  }
}

async function notifyNtfy(title, message, priority = 3) {
  if (!CONFIG.ntfy.enabled) return;
  try {
    const tags = priority >= 4 ? "rotating_light" : priority >= 3 ? "chart_with_upwards_trend" : "eyes";
    const sanitize = s => s.replace(/[^\x20-\x7E]/g, c => ({ "—": "--", "–": "-", "‘": "'", "’": "'", "“": '"', "”": '"' }[c] || ""));
    const resp = await fetch(`https://ntfy.sh/${CONFIG.ntfy.topic}`, {
      method: "POST",
      headers: {
        "Title": sanitize(title),
        "Priority": String(priority),
        "Tags": tags,
      },
      body: sanitize(message),
    });
    if (!resp.ok) console.error("  ntfy failed:", resp.status, await resp.text());
  } catch (e) {
    console.error("  ntfy failed:", e.message);
  }
}

async function notifyEmail(subject, body) {
  if (!CONFIG.email.enabled || CONFIG.email.appPassword === "YOUR_GMAIL_APP_PASSWORD_HERE") return;
  try {
    const transport = createTransport({
      service: "gmail",
      auth: {
        user: CONFIG.email.from,
        pass: CONFIG.email.appPassword,
      },
    });
    await transport.sendMail({
      from: CONFIG.email.from,
      to: CONFIG.email.to,
      subject,
      text: body,
    });
  } catch (e) {
    console.error("  Email failed:", e.message);
  }
}

async function sendAlert(title, message, priority = 3) {
  if (!SCORER_ALERTS_ENABLED) {
    console.log(`\n  [MUTED] ALERT: ${title}`);
    console.log(`  ${message}\n`);
    return;
  }
  console.log(`\n  ALERT: ${title}`);
  console.log(`  ${message}\n`);
  await Promise.all([
    notifyMacOS(title, message),
    notifyNtfy(title, message, priority),
    notifyEmail(`PUMP: ${title}`, message),
  ]);
}

// ─── State management ───

function loadState() {
  try {
    if (existsSync(STATE_FILE)) return JSON.parse(readFileSync(STATE_FILE, "utf-8"));
  } catch {}
  return { lastTier: null, lastScore: 0, lastAlertTime: null, lastAlertTier: null };
}

function saveState(state) {
  writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
}

// ─── Main ───

async function main() {
  const BOLD = "\x1b[1m";
  const RESET = "\x1b[0m";
  const GREEN = "\x1b[32m";
  const RED = "\x1b[31m";
  const YELLOW = "\x1b[33m";
  const CYAN = "\x1b[36m";
  const DIM = "\x1b[2m";

  console.log(`${BOLD}═══════════════════════════════════════════════════════════════════${RESET}`);
  console.log(`${BOLD}  PUMP Entry Signal Monitor${RESET}  —  ${new Date().toISOString()}`);
  console.log(`${BOLD}═══════════════════════════════════════════════════════════════════${RESET}`);

  // Load and deduplicate history
  let raw;
  try {
    raw = JSON.parse(readFileSync(HISTORY_FILE, "utf-8"));
  } catch (e) {
    console.error("Cannot read history:", e.message);
    process.exit(1);
  }

  const snapshots = smoothSupply(deduplicateSnapshots(raw, 1));
  console.log(`  ${DIM}${raw.length} raw snapshots → ${snapshots.length} deduplicated (≥1h gap)${RESET}`);

  if (snapshots.length < 5) {
    console.log("  Not enough data for signal computation. Need at least 5 hourly snapshots.");
    process.exit(0);
  }

  // Compute signals
  const signals = computeEntrySignals(snapshots);
  if (!signals) {
    console.log("  Could not compute signals.");
    process.exit(0);
  }

  // Fetch macro signals in parallel
  const [solRegime, fng, btcData] = await Promise.all([
    fetchSOLRegime(),
    fetchFNG(),
    fetchBTCChange(),
  ]);

  // Compute score (regime + macro aware)
  let { score, tier, components, dangers, regimeWarning } = computeEntryScore(signals, solRegime, fng, btcData);

  // Display
  const tierColor = tier === "STRONG ENTRY" ? GREEN :
                    tier === "GOOD ENTRY" ? GREEN :
                    tier === "DANGER" ? RED :
                    tier === "AVOID" ? RED :
                    YELLOW;

  console.log(`\n  ${BOLD}Price:${RESET}   $${signals.price.toFixed(6)}`);
  console.log(`  ${BOLD}Holders:${RESET} ${signals.holders.toLocaleString()}`);
  if (signals.buybackYield) console.log(`  ${BOLD}Yield:${RESET}   ${signals.buybackYield.toFixed(1)}%`);
  if (signals.buybackDollarRate) console.log(`  ${BOLD}Revenue:${RESET} $${(signals.buybackDollarRate / 1e6).toFixed(2)}M/day`);
  if (solRegime) {
    const regColor = solRegime.regime === "BULL" ? GREEN : solRegime.regime === "BEAR" ? RED : YELLOW;
    console.log(`  ${BOLD}SOL:${RESET}     $${solRegime.price.toFixed(2)} ${regColor}(7d: ${solRegime.change7d > 0 ? "+" : ""}${solRegime.change7d.toFixed(1)}% — ${solRegime.regime})${RESET}`);
  } else {
    console.log(`  ${BOLD}SOL:${RESET}     ${DIM}(fetch failed — regime not scored)${RESET}`);
  }
  if (fng) {
    const fngColor = fng.value < 30 ? GREEN : fng.value < 46 ? YELLOW : fng.value <= 75 ? RED : DIM;
    console.log(`  ${BOLD}FNG:${RESET}     ${fngColor}${fng.value} (${fng.classification})${RESET}`);
  }
  if (btcData) {
    console.log(`  ${BOLD}BTC:${RESET}     $${Math.round(btcData.price).toLocaleString()} (7d: ${btcData.change7d > 0 ? "+" : ""}${btcData.change7d.toFixed(1)}%)`);
    if (solRegime) {
      const spread = btcData.change7d - solRegime.change7d;
      const spreadColor = spread > 3 ? RED : spread < -3 ? GREEN : DIM;
      console.log(`  ${BOLD}Spread:${RESET}  ${spreadColor}BTC-SOL: ${spread > 0 ? "+" : ""}${spread.toFixed(1)}pp${spread > 3 ? " [RISK-OFF]" : spread < -3 ? " [RISK-ON]" : ""}${RESET}`);
    }
  }

  console.log(`\n  ${BOLD}Entry Score: ${tierColor}${score}/100 — ${tier}${RESET}`);
  if (regimeWarning) console.log(`  ${RED}>>> ${regimeWarning} <<<${RESET}`);

  if (components.length > 0) {
    console.log(`\n  ${BOLD}Active signals:${RESET}`);
    for (const c of components) {
      console.log(`    ${GREEN}+${c.pts}${RESET}  ${c.name} ${DIM}(${c.value})${RESET}`);
    }
  }

  if (dangers.length > 0) {
    console.log(`\n  ${BOLD}Danger signals:${RESET}`);
    for (const d of dangers) {
      console.log(`    ${RED}${d.pts}${RESET}  ${d.name} ${DIM}(${d.value})${RESET}`);
    }
  }

  // Key metrics
  console.log(`\n  ${BOLD}Key metrics:${RESET}`);
  if (signals.organicExchFlow7d !== undefined) {
    const flowDir = signals.organicExchFlow7d < 0 ? GREEN : RED;
    console.log(`    Exchange organic flow (7d): ${flowDir}${(signals.organicExchFlow7d / 1e9).toFixed(2)}B${RESET}`);
  }
  if (signals.priceReturn7d !== undefined) {
    const retColor = signals.priceReturn7d > 0 ? GREEN : RED;
    console.log(`    7d price return: ${retColor}${signals.priceReturn7d > 0 ? "+" : ""}${signals.priceReturn7d.toFixed(1)}%${RESET}`);
  }
  if (signals.top20Trend7d !== undefined) {
    console.log(`    Top 20 trend (7d): ${signals.top20Trend7d > 0 ? "+" : ""}${signals.top20Trend7d.toFixed(2)}pp`);
  }
  if (signals.lpIncreasing !== undefined) {
    console.log(`    LP depth: ${signals.lpIncreasing ? GREEN + "increasing" : RED + "decreasing"}${RESET} (${(signals.lpDelta7d / 1e6).toFixed(0)}M)`);
  }
  if (signals.priceReturn3d !== undefined) {
    const r3 = signals.priceReturn3d;
    const label = r3 > 5 ? GREEN + "strong momentum" : r3 < -5 ? YELLOW + "dip (contrarian buy)" : RED + "dead cat zone";
    console.log(`    3d momentum: ${label}${RESET} (${r3 > 0 ? "+" : ""}${r3.toFixed(1)}%)`);
  }

  // Backtested expectations for current regime
  console.log(`\n  ${BOLD}Backtested expectations for current conditions:${RESET}`);
  if (solRegime?.regime === "BEAR") {
    console.log(`    ${RED}SOL BEAR REGIME — on-chain signals unreliable${RESET}`);
    console.log(`    ${RED}Historical BEAR 7d return: -5.1% avg, 33% win rate${RESET}`);
    console.log(`    ${RED}INFLOW + BEAR: -20% avg, 0% WR (n=4)${RESET}`);
    console.log(`    ${YELLOW}Wait for SOL 7d > +3% before entering${RESET}`);
    if (signals.organicExchFlow7d < -500_000_000) {
      console.log(`    ${DIM}On-chain outflow IS active — setup will fire once SOL turns${RESET}`);
    }
    if (signals.isDip) {
      console.log(`    ${DIM}Dip at ${signals.priceReturn3d.toFixed(1)}% — but dip signals untested in BEAR (n=0)${RESET}`);
    }
  } else if (signals.dipConfluence) {
    console.log(`    ${GREEN}DIP + OUTFLOW CONFLUENCE (strongest setup)${RESET}`);
    console.log(`    ${GREEN}Historical fwd 24h: +12.3% avg, 100% win rate (n=6)${RESET}`);
    if (solRegime?.change7d > 3) console.log(`    ${GREEN}SOL uptrend active — best macro for PUMP entries${RESET}`);
    console.log(`    ${GREEN}Sizing: full position $150K at 3x${RESET}`);
  } else if (signals.dipOnly) {
    console.log(`    ${GREEN}DIP ENTRY (mean reversion, no outflow yet)${RESET}`);
    console.log(`    ${GREEN}Historical fwd 24h: +11.8% avg, 100% win rate (n=3)${RESET}`);
    console.log(`    ${YELLOW}Sizing: half position $100K at 2x (single signal)${RESET}`);
  } else if (signals.dipBlocked) {
    console.log(`    ${RED}DIP BLOCKED BY DIVERGENCE${RESET}`);
    console.log(`    ${RED}Historical dip + danger: -3.4% avg, 25% win rate (n=4)${RESET}`);
    console.log(`    ${RED}Mean reversion FAILS during distribution. DO NOT buy this dip.${RESET}`);
  } else if (signals.momentumDivergence) {
    console.log(`    ${RED}MOMENTUM DIVERGENCE REGIME${RESET}`);
    console.log(`    ${RED}Historical 3d return: -6.0% avg, 11% win rate${RESET}`);
    console.log(`    ${RED}DO NOT open leveraged positions${RESET}`);
  } else if (signals.organicExchFlow7d < -1_000_000_000 && signals.priceReturn7d > 0) {
    console.log(`    ${GREEN}OUTFLOW + ${solRegime?.regime || "?"} SOL (best combo)${RESET}`);
    console.log(`    ${GREEN}Historical 7d return: +26-29% avg, 80% win rate${RESET}`);
    console.log(`    ${DIM}Worst historical 3d drawdown: -9.4%${RESET}`);
  } else if (signals.organicExchFlow7d < -500_000_000) {
    console.log(`    ${GREEN}Exchange outflow active + ${solRegime?.regime || "?"} SOL${RESET}`);
    console.log(`    ${GREEN}OUTFLOW + BULL/NEUTRAL: 7d avg +26-29%, 80% WR${RESET}`);
    console.log(`    ${DIM}Worst historical 3d drawdown: -9.4%${RESET}`);
  } else {
    console.log(`    ${YELLOW}Mixed conditions — no strong regime match${RESET}`);
  }
  // Macro overlay
  if (fng) {
    if (fng.value < 30) console.log(`    ${GREEN}EXTREME FEAR (FNG ${fng.value}) — contrarian buy signal active${RESET}`);
    else if (fng.value < 45) console.log(`    ${YELLOW}Fear zone (FNG ${fng.value}) — contrarian favorable${RESET}`);
    else if (fng.value >= 56 && fng.value <= 75) console.log(`    ${RED}GREED ZONE (FNG ${fng.value}) — worst entry window: 15% WR, -7.8% avg${RESET}`);
  }
  if (btcData && solRegime) {
    const spread = btcData.change7d - solRegime.change7d;
    if (spread > 3) console.log(`    ${RED}BTC > SOL by ${spread.toFixed(1)}pp — risk-off rotation: 0% WR, -17.6% avg${RESET}`);
    else if (spread < -3) console.log(`    ${GREEN}SOL > BTC by ${(-spread).toFixed(1)}pp — risk-on environment${RESET}`);
  }

  // ── Confluence tracker — shows how conditions are gearing up ──
  console.log(`\n  ${BOLD}Confluence Tracker:${RESET} ${signals.confluenceMet}/${signals.confluenceTotal} conditions met`);
  for (const c of signals.confluenceConditions) {
    const icon = c.status === "MET" ? GREEN + "[MET]" :
                 c.status === "APPROACHING" ? YELLOW + "[~]  " :
                 c.status === "BLOCKED" ? RED + "[X]  " :
                 RED + "[--] ";
    console.log(`    ${icon}${RESET} ${c.name}: ${c.value}`);
  }
  if (signals.confluenceMet === signals.confluenceTotal) {
    console.log(`    ${GREEN}>>> ALL CONDITIONS MET — CONFLUENCE ACTIVE <<<${RESET}`);
  } else if (signals.confluenceMet >= signals.confluenceTotal - 1 && !signals.momentumDivergence) {
    const missing = signals.confluenceConditions.find(c => c.status !== "MET");
    console.log(`    ${YELLOW}>>> 1 away from confluence — watching: ${missing?.name} <<<${RESET}`);
  }

  // Position sizing guidance
  if (solRegime?.regime === "BEAR" && (signals.dipConfluence || signals.dipOnly || score >= 30)) {
    console.log(`\n  ${BOLD}Position Guidance:${RESET}`);
    console.log(`    ${RED}SOL BEAR — do not enter despite on-chain signals${RESET}`);
    console.log(`    ${YELLOW}Setup: ${signals.dipConfluence ? "DIP + OUTFLOW (strong)" : signals.dipOnly ? "DIP (moderate)" : "building"}${RESET}`);
    console.log(`    ${YELLOW}Enter when SOL 7d flips above +3%${RESET}`);
  } else if (signals.dipConfluence || signals.dipOnly || tier === "GOOD ENTRY" || tier === "STRONG ENTRY") {
    console.log(`\n  ${BOLD}Position Guidance:${RESET}`);
    if (signals.dipConfluence) {
      console.log(`    ${GREEN}DIP + OUTFLOW: $150K at 3x leverage${RESET}`);
      console.log(`    ${DIM}Take profit: 3d return crosses back above +5%${RESET}`);
      console.log(`    ${DIM}Hard stop: 3d return drops below -20%${RESET}`);
      console.log(`    ${DIM}Time stop: 7 days max hold${RESET}`);
    } else if (signals.dipOnly) {
      console.log(`    ${YELLOW}DIP only: $100K at 2x leverage (no outflow confirmation)${RESET}`);
      console.log(`    ${DIM}Take profit: 3d return crosses back above +5%${RESET}`);
      console.log(`    ${DIM}Hard stop: 3d return drops below -20%${RESET}`);
      console.log(`    ${DIM}Time stop: 7 days max hold${RESET}`);
      console.log(`    ${DIM}Upgrade to full size if outflow develops${RESET}`);
    } else if (tier === "STRONG ENTRY") {
      console.log(`    ${GREEN}Structural STRONG: $150K at 3x leverage${RESET}`);
    } else {
      console.log(`    ${YELLOW}Structural GOOD: $100K at 2x leverage${RESET}`);
    }
  }

  // Alert logic
  const state = loadState();
  const now = new Date().toISOString();

  // Hysteresis: a tier must be observed on two consecutive hourly runs before it is
  // acted on. The raw score flipped tier 32 times in 51 hours on Oct 17-19.
  const rawTier = tier;
  const confirmed = !state.lastRawTier || state.lastRawTier === rawTier;
  tier = confirmed ? rawTier : (state.lastTier || rawTier);
  state.lastRawTier = rawTier;
  console.log(`\n  ${BOLD}Confirmed tier:${RESET} ${tier}${confirmed ? "" : DIM + ` (raw ${rawTier} not yet confirmed — needs a second consecutive run)` + RESET}`);
  const alerts = []; // collect all alerts, send highest priority

  // Minimum 30 minutes between tier alerts
  const minAlertGap = 30 * 60 * 1000;
  const timeSinceLastAlert = state.lastAlertTime ? Date.now() - new Date(state.lastAlertTime).getTime() : Infinity;
  // Dip alerts use separate cooldown
  const dipCooldown = 4 * 3600000; // 4 hours between dip alerts
  const timeSinceLastDip = state.lastDipAlertTime ? Date.now() - new Date(state.lastDipAlertTime).getTime() : Infinity;

  // ── Dip alerts (independent track, highest priority) ──
  if (timeSinceLastDip > dipCooldown) {
    if (solRegime?.regime === "BEAR" && (signals.dipConfluence || signals.dipOnly) && state.lastDipAlertType !== "bear_waiting") {
      alerts.push({
        title: "DIP SETUP BLOCKED — SOL BEAR",
        message: `Dip ${signals.priceReturn3d.toFixed(1)}% + ${signals.dipConfluence ? "outflow confluence" : "no outflow"} detected, but SOL is BEAR (${solRegime.change7d.toFixed(1)}% 7d). On-chain setup loading — wait for SOL 7d > +3%. Price: $${signals.price.toFixed(6)}.`,
        priority: 3,
        type: "dip",
        dipType: "bear_waiting",
      });
    } else if (signals.dipConfluence && state.lastDipAlertType !== "confluence" && solRegime?.regime !== "BEAR") {
      const solNote = solRegime ? ` SOL: ${solRegime.regime} (${solRegime.change7d > 0 ? "+" : ""}${solRegime.change7d.toFixed(1)}%).` : "";
      alerts.push({
        title: "DIP + OUTFLOW CONFLUENCE",
        message: `3d return: ${signals.priceReturn3d.toFixed(1)}%. Exchange outflow: ${(signals.organicExchFlow7d / 1e9).toFixed(1)}B. Price: $${signals.price.toFixed(6)}.${solNote} Historical: +12.3% avg fwd 24h, 100% WR (n=6). Full position: $150K at 3x. Stop: 3d < -20%. Take profit: 3d > +5%.`,
        priority: 5,
        type: "dip",
        dipType: "confluence",
      });
    } else if (signals.dipOnly && state.lastDipAlertType !== "diponly" && state.lastDipAlertType !== "confluence" && solRegime?.regime !== "BEAR") {
      alerts.push({
        title: "DIP ENTRY -- 3d return " + signals.priceReturn3d.toFixed(1) + "%",
        message: `Buyback-floor mean reversion active. Price: $${signals.price.toFixed(6)}. No exchange outflow yet -- half size: $100K at 2x. Upgrade if outflow develops. Stop: 3d < -20%. Historical dip-only: +11.8% avg, 100% WR (n=3).`,
        priority: 4,
        type: "dip",
        dipType: "diponly",
      });
    } else if (signals.isApproachingDip && !signals.momentumDivergence && !state.lastDipApproachAlert) {
      const outflowStatus = signals.organicExchFlow7d < -500_000_000 ? "OUTFLOW active" :
                            signals.organicExchFlow7d < 0 ? "outflow building" : "no outflow yet";
      alerts.push({
        title: "DIP APPROACHING -- 3d at " + signals.priceReturn3d.toFixed(1) + "%",
        message: `3d return nearing -5% dip threshold. Price: $${signals.price.toFixed(6)}. Exchange flow: ${outflowStatus} (${(signals.organicExchFlow7d / 1e9).toFixed(2)}B). Confluence ${signals.confluenceMet}/${signals.confluenceTotal} met. Watch for entry.`,
        priority: 3,
        type: "dip",
        dipType: "approaching",
      });
    } else if (signals.dipBlocked && state.lastDipAlertType !== "blocked") {
      alerts.push({
        title: "DIP BLOCKED -- Divergence active",
        message: `3d dip at ${signals.priceReturn3d.toFixed(1)}% BUT momentum divergence active (price +${signals.priceReturn7d?.toFixed(1)}% + exchange inflow). DO NOT buy this dip. Historical dip+danger: -3.4% avg, 25% WR. Wait for divergence to clear.`,
        priority: 4,
        type: "dip",
        dipType: "blocked",
      });
    }
  }

  // Clear dip alert state when dip conditions end
  if (!signals.isDip && !signals.isApproachingDip && state.lastDipAlertType) {
    state.lastDipAlertType = null;
    state.lastDipApproachAlert = false;
  }

  // ── Tier alerts (existing, on cooldown) ──
  if (timeSinceLastAlert >= minAlertGap) {
    if (tier === "DANGER" && state.lastAlertTier !== "DANGER") {
      alerts.push({
        title: "DANGER -- Momentum Divergence",
        message: `Price rising (+${signals.priceReturn7d?.toFixed(1)}%) while exchanges receiving inflow (+${(signals.organicExchFlow7d / 1e9).toFixed(1)}B). Historical 3d return: -6.0%, 11% win rate. CLOSE any leveraged positions.`,
        priority: 5,
        type: "tier",
      });
    } else if (tier === "STRONG ENTRY" && state.lastTier !== "STRONG ENTRY") {
      const macroNote = [
        solRegime ? `SOL: ${solRegime.regime} (${solRegime.change7d > 0 ? "+" : ""}${solRegime.change7d.toFixed(1)}%)` : null,
        fng ? `FNG: ${fng.value}` : null,
        btcData && solRegime ? `BTC-SOL: ${(btcData.change7d - solRegime.change7d).toFixed(1)}pp` : null,
      ].filter(Boolean).join(". ");
      alerts.push({
        title: "STRONG ENTRY Signal",
        message: `Score: ${score}/100. Price: $${signals.price.toFixed(4)}. ${macroNote}. Exchange outflow: ${(signals.organicExchFlow7d / 1e9).toFixed(1)}B (7d). Yield: ${signals.buybackYield?.toFixed(1)}%. ${signals.isDip ? "DIP CONFLUENCE ACTIVE." : ""} OUTFLOW + BULL/NEUTRAL SOL: +26-29% avg 7d, 80% WR.`,
        priority: 4,
        type: "tier",
      });
    } else if (tier === "GOOD ENTRY" && (state.lastTier === "NEUTRAL" || state.lastTier === "AVOID" || !state.lastTier)) {
      const macroNote = [
        solRegime ? `SOL: ${solRegime.regime} (${solRegime.change7d > 0 ? "+" : ""}${solRegime.change7d.toFixed(1)}%)` : null,
        fng ? `FNG: ${fng.value}` : null,
        btcData && solRegime ? `BTC-SOL: ${(btcData.change7d - solRegime.change7d).toFixed(1)}pp` : null,
      ].filter(Boolean).join(". ");
      alerts.push({
        title: "GOOD ENTRY Signal",
        message: `Score: ${score}/100. Price: $${signals.price.toFixed(4)}. ${macroNote}. Exchange flow: ${(signals.organicExchFlow7d / 1e9).toFixed(1)}B (7d). Yield: ${signals.buybackYield?.toFixed(1)}%. ${signals.isDip ? "DIP active -- mean reversion in play." : ""}`,
        priority: 3,
        type: "tier",
      });
    } else if ((tier === "AVOID" || tier === "NEUTRAL") && (state.lastAlertTier === "STRONG ENTRY" || state.lastAlertTier === "GOOD ENTRY")) {
      alerts.push({
        title: "Entry Signals Faded",
        message: `Score dropped to ${score}/100 (${tier}). ${dangers.length > 0 ? "Danger: " + dangers.map(d => d.name).join(", ") : "Positive signals weakened."}`,
        priority: 3,
        type: "tier",
      });
    }
  } else {
    console.log(`\n  ${DIM}Tier alert cooldown: ${Math.round(timeSinceLastAlert / 60000)}m ago${RESET}`);
  }

  // Send the highest-priority alert (or all if different types)
  const sentTypes = new Set();
  for (const alert of alerts.sort((a, b) => b.priority - a.priority)) {
    if (sentTypes.has(alert.type)) continue;
    sentTypes.add(alert.type);

    await sendAlert(alert.title, alert.message, alert.priority);

    if (alert.type === "tier") {
      state.lastAlertTime = now;
      state.lastAlertTier = tier;
    }
    if (alert.type === "dip") {
      state.lastDipAlertTime = now;
      state.lastDipAlertType = alert.dipType;
      if (alert.dipType === "approaching") state.lastDipApproachAlert = true;
    }
  }

  if (alerts.length === 0) {
    console.log(`\n  ${DIM}No alert triggered (tier: ${tier}, dip: ${signals.isDip ? "active" : signals.isApproachingDip ? "approaching" : "no"})${RESET}`);
  }

  // ── Holder velocity alert (fast-twitch, independent of tier) ──
  // Detects demand surges that precede price moves by 1-2 hours.
  // Sep 29 case study: +1111 holders/hr (19x baseline) preceded a +15.7% rip.
  if (snapshots.length >= 25) {
    const latest2 = snapshots.slice(-2);
    const dtHrs = (new Date(latest2[1].timestamp) - new Date(latest2[0].timestamp)) / 3600000;
    const holderVelocity = dtHrs > 0.1 ? (latest2[1].uniqueOwners - latest2[0].uniqueOwners) / dtHrs : 0;

    // Trailing 24h baseline
    const trailing24h = snapshots.filter(s => {
      const t = new Date(s.timestamp).getTime();
      const latest = new Date(latest2[1].timestamp).getTime();
      return t >= latest - 24 * 3600000 && t < latest - 3600000;
    });
    let baselineVelocity = 50; // fallback
    if (trailing24h.length >= 3) {
      const totalGrowth = trailing24h[trailing24h.length - 1].uniqueOwners - trailing24h[0].uniqueOwners;
      const totalHrs = (new Date(trailing24h[trailing24h.length - 1].timestamp) - new Date(trailing24h[0].timestamp)) / 3600000;
      if (totalHrs > 1) baselineVelocity = totalGrowth / totalHrs;
    }

    const velocityRatio = baselineVelocity > 0 ? holderVelocity / baselineVelocity : 0;

    console.log(`\n  ${BOLD}Holder Velocity:${RESET}`);
    const velColor = velocityRatio >= 5 ? RED : velocityRatio >= 3 ? YELLOW : DIM;
    console.log(`    Current: ${velColor}${holderVelocity.toFixed(0)}/hr${RESET} (baseline: ${baselineVelocity.toFixed(0)}/hr, ratio: ${velocityRatio.toFixed(1)}x)`);

    const velCooldown = 2 * 3600000; // 2 hour cooldown for velocity alerts
    const lastVelAlert = state.lastVelocityAlertTime ? Date.now() - new Date(state.lastVelocityAlertTime).getTime() : Infinity;

    if (velocityRatio >= 5 && holderVelocity > 200 && lastVelAlert > velCooldown) {
      const velTitle = "DEMAND SURGE -- " + holderVelocity.toFixed(0) + " new holders/hr (" + velocityRatio.toFixed(0) + "x baseline)";
      const velMsg = "Holder velocity spike detected. Price: $" + signals.price.toFixed(6) + ". Historical pattern: holder surges precede price moves by 1-2 hours. Current entry tier: " + tier + " (score " + score + "/100).";
      console.log(`    ${RED}DEMAND SURGE DETECTED${RESET} — ${velocityRatio.toFixed(0)}x baseline`);
      await sendAlert(velTitle, velMsg, 4);
      state.lastVelocityAlertTime = new Date().toISOString();
    } else if (velocityRatio >= 3) {
      console.log(`    ${YELLOW}Elevated — watching${RESET}`);
    }
  }

  // ── EARLY POSITIONING (spot only) — on-chain accumulation BEFORE confirmation ──
  // The regime/fee/volume triggers confirm a leg after it starts. This alert fires on the
  // pattern that preceded the Jul–Aug 2026 leg by 2–4 weeks: supply leaving exchanges across
  // venues while new large self-custody wallets form, with positioning calm and the fee base
  // not contracting. It is a SPOT instruction (complete the core), never leverage: the same
  // pattern was 0-for-18 in October while price was falling, so it must be held through drawdown.
  // Not muted by SCORER_ALERTS. 24h cooldown.
  try {
    const latestIdx = snapshots.length - 1;
    const labeled = new Set(LABELED_WALLETS.map(w => w.addr));
    const unlabeledBal = snap => snap.holders.filter(h => !labeled.has(h.addr)).reduce((a, h) => a + h.balance, 0);
    const i72 = findSnapshotAtOffset(snapshots, latestIdx, 72);
    const whaleNet3d = i72 !== null ? unlabeledBal(snapshots[latestIdx]) - unlabeledBal(snapshots[i72]) : null;
    const regime = existsSync(REGIME_STATE_FILE) ? JSON.parse(readFileSync(REGIME_STATE_FILE, "utf-8")) : null;
    const perps = raw[raw.length - 1]?.perps || null;
    const fundingAnn = perps ? perps.fundingHourly * 24 * 365 * 100 : null;
    const conds = {
      "exchange outflow 7d > 2B": signals.organicExchFlow7d < -2e9,
      "unlabeled top-500 (new whales) net +1B over 3d": whaleNet3d !== null && whaleNet3d > 1e9,
      "price not in free fall (7d > -10%)": signals.priceReturn7d > -10,
      "regime >= 2/3 (fee base not contracting)": !regime || regime.state >= 2,
      "funding calm (< 25%/yr)": fundingAnn === null || fundingAnn < 25,
    };
    const met = Object.values(conds).filter(Boolean).length, total = Object.keys(conds).length;
    console.log(`\n  ${BOLD}Early positioning (spot):${RESET} ${met}/${total}` + Object.entries(conds).map(([k, v]) => `\n    ${v ? GREEN + "[MET]" : DIM + "[--] "}${RESET} ${k}`).join(""));
    const sinceLast = state.lastEarlyPositioningTime ? Date.now() - new Date(state.lastEarlyPositioningTime).getTime() : Infinity;
    if (met === total && sinceLast > 24 * 3600000) {
      const title = "PUMP EARLY POSITIONING (spot) -- exchanges draining, new whales forming";
      const msg = `Exchange organic flow 7d: ${(signals.organicExchFlow7d / 1e9).toFixed(1)}B. Unlabeled top-500 wallets: +${(whaleNet3d / 1e9).toFixed(1)}B over 3d. 7d price ${signals.priceReturn7d >= 0 ? "+" : ""}${signals.priceReturn7d.toFixed(1)}%. Regime ${regime?.state ?? "?"}/3. Funding ${fundingAnn?.toFixed(0)}%/yr. Price $${signals.price.toFixed(6)}. This is the pattern that preceded the Jul-Aug leg. SPOT ONLY: complete the core to its regime target; size to hold a 15-20% drawdown. Leverage waits for fee acceleration or a volume day (M1/M3).`;
      console.log(`\n  ALERT: ${title}\n  ${msg}\n`);
      await Promise.all([notifyMacOS(title, msg), notifyNtfy(title, msg, 4)]);
      state.lastEarlyPositioningTime = now;
    } else if (met === total) {
      console.log(`    ${DIM}all conditions met — alerted ${Math.round(sinceLast / 3600000)}h ago, cooldown 24h${RESET}`);
    }
  } catch (e) { console.error("  early positioning check failed:", e.message); }

  state.lastTier = tier;
  state.lastScore = score;
  state.lastCheck = now;
  saveState(state);

  // ── Forecast log: one row per run, graded later by pump-scorecard.js ──
  try {
    const latestRaw = raw[raw.length - 1] || {};
    const log = existsSync(FORECAST_LOG) ? JSON.parse(readFileSync(FORECAST_LOG, "utf-8")) : [];
    log.push({
      timestamp: now,
      snapshotTime: signals.timestamp,
      price: signals.price,
      score, rawTier, tier,
      components: components.map(c => c.name.split(" [")[0]),
      dangers: dangers.map(d => d.name),
      signals: {
        priceReturn3d: signals.priceReturn3d ?? null,
        priceReturn7d: signals.priceReturn7d ?? null,
        organicExchFlow7d: signals.organicExchFlow7d ?? null,
        top20Trend7d: signals.top20Trend7d ?? null,
        lpDelta7d: signals.lpDelta7d ?? null,
        buybackYield: signals.buybackYield ?? null,
        buybackDollarRate: signals.buybackDollarRate ?? null,
        holderGrowthPerDay: signals.holderGrowthPerDay ?? null,
        isDip: !!signals.isDip,
        momentumDivergence: !!signals.momentumDivergence,
      },
      macro: {
        solChange7d: solRegime?.change7d ?? null,
        solRegime: solRegime?.regime ?? null,
        fng: fng?.value ?? null,
        btcChange7d: btcData?.change7d ?? null,
      },
      solPrice: latestRaw.solPrice ?? null,
      perps: latestRaw.perps ?? null,
    });
    writeFileSync(FORECAST_LOG, JSON.stringify(log));
    console.log(`  ${DIM}Forecast log: ${log.length} rows${RESET}`);
  } catch (e) {
    console.error("  forecast log write failed:", e.message);
  }

  // Notification status
  console.log(`\n  ${BOLD}Notification channels:${RESET}`);
  console.log(`    macOS:  ${CONFIG.macos.enabled ? GREEN + "ON" : RED + "OFF"}${RESET}`);
  console.log(`    ntfy:   ${CONFIG.ntfy.enabled ? GREEN + "ON" + RESET + DIM + ` (topic: ${CONFIG.ntfy.topic})` : RED + "OFF"}${RESET}`);
  console.log(`    Email:  ${CONFIG.email.enabled && CONFIG.email.appPassword !== "YOUR_GMAIL_APP_PASSWORD_HERE" ? GREEN + "ON" : YELLOW + "NEEDS SETUP"}${RESET}`);

  console.log(`\n${BOLD}═══════════════════════════════════════════════════════════════════${RESET}\n`);
}

main().catch(e => { console.error(e); process.exit(1); });
