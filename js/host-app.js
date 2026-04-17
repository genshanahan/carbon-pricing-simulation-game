/**
 * Host (Facilitator) App — drives game state, renders the projected view.
 */

import {
  buildConfig, createInitialState, initRegimeData, REGIMES, REGIME_LABELS,
  processRound, processPermitTrade, completeRegime,
  computeTotalEconomicOutput, computeBudgetUsed, undoLastRound, defaultPermitsPerFirm,
  maxAllowedProduction, maxAffordable, unitsPerPermit, permitsRemaining,
  maxProductionFromPermits, normalizeStateFromRemote, totalTaxPaidByFirm,
  regimeSequence, nextRegimeAfter, previousRegimeInSession, resizeFirmsList,
  setCleanTech, OPTIONAL_REGIMES, deriveSessionParams,
} from './game-engine.js';

import {
  pushState, onStateChange, onSubmissions, clearSubmissions,
  onStudentConnections, deleteRoom, onProposals,
  mirrorCleanTechClaim, onCleanTechClaims, fetchCleantechClaims,
} from './firebase-sync.js';

import {
  fmt, fmtMoney, renderCO2Meter, firmColor, cleanBadge,
  regimeUsesCleanTech, regimeUsesTax, regimeUsesPermits, regimeHasCap,
  regimeHasPermitMarket, qrCodeUrl, regimeDescription, debriefPrompt,
  outputBudgetAnalogy, formatTotalEconomicOutput, formatBudgetUsed, budgetUsedStyle,
  facilitatorNotes, onboardingGuide, renderRoundHistory, renderCO2Extra,
  renderDiscussionCard, renderComparisonTable,
} from './ui-helpers.js';

/* ── Globals ── */

const params = new URLSearchParams(window.location.search);
const ROOM = params.get('room');
if (!ROOM) { window.location.href = 'index.html'; }

let state = null;
let studentConnections = {};
let currentSubmissions = {};
let submissionUnsub = null;
let submissionKey = null;
let currentProposals = {};
let proposalUnsub = null;
let proposalRegime = null;
let cleantechUnsub = null;
let cleantechKey = null;
let roundFormErrorsByRegime = {};
let tradeFormErrorsByRegime = {};
let hostDebriefRegime = null;

/**
 * RTDB `cleantech/{regime}` snapshots, keyed by regime.
 * This is the source of truth for student self-claims.
 * We NEVER merge this into `state` or call sync() from the listener,
 * because that creates a race: sync() → onStateChange → rebuild state → wipe merge.
 * Instead we overlay at render time via firmHasCleanTech / countCleanTechSlots.
 */
const cleantechClaimsByRegime = {};

let resultsChartInstances = [];

const CHART_REGIME_COLORS = {
  freemarket: '#0072B2',
  cac: '#D55E00',
  tax: '#009E73',
  trade: '#CC79A7',
  trademarket: '#E69F00',
};

function destroyResultsCharts() {
  resultsChartInstances.forEach(ch => { try { ch.destroy(); } catch (_) { /* noop */ } });
  resultsChartInstances = [];
}

function sessionRegimes() {
  return state ? regimeSequence(state.config) : REGIMES;
}

function escAttr(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;');
}

function parseWholeNumberInput(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (text.length === 0) return null;
  if (!/^-?\d+$/.test(text)) return null;
  return parseInt(text, 10);
}

function mountResultsCharts() {
  if (typeof Chart === 'undefined' || !state) return;
  const seq = sessionRegimes();
  const completed = state.completedRegimes.filter(r => seq.includes(r));
  if (completed.length === 0) return;

  const maxR = Math.max(...completed.map(r => state.regimeData[r].rounds.length), 1);
  const ppmLabels = Array.from({ length: maxR + 1 }, (_, i) => (i === 0 ? 'Start' : `Round ${i}`));

  const ppmDatasets = completed.map(r => {
    const d = state.regimeData[r];
    const pts = [state.config.startPpm];
    for (const round of d.rounds) pts.push(round.ppmAfter);
    while (pts.length < maxR + 1) pts.push(pts[pts.length - 1]);
    return {
      label: REGIME_LABELS[r],
      data: pts.slice(0, maxR + 1),
      borderColor: CHART_REGIME_COLORS[r] || '#333',
      backgroundColor: 'transparent',
      tension: 0.15,
      fill: false,
    };
  });

  ppmDatasets.push({
    label: `Catastrophe threshold (${state.config.triggerPpm} ppm)`,
    data: Array(ppmLabels.length).fill(state.config.triggerPpm),
    borderColor: '#c0392b',
    borderWidth: 2,
    borderDash: [8, 4],
    pointRadius: 0,
    backgroundColor: 'transparent',
    fill: false,
    tension: 0,
  });

  const elPpm = document.getElementById('chartPpmByRound');
  if (elPpm) {
    resultsChartInstances.push(new Chart(elPpm, {
      type: 'line',
      data: { labels: ppmLabels, datasets: ppmDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 2,
        plugins: {
          title: { display: true, text: 'CO\u2082 concentration (ppm) after each round' },
          legend: { position: 'bottom' },
        },
        scales: {
          y: { title: { display: true, text: 'ppm' } },
        },
      },
    }));
  }

  const firmLabels = state.firms.map(f => f.name);
  const profitDatasets = completed.map(r => ({
    label: REGIME_LABELS[r],
    data: state.firms.map((_, i) => state.regimeData[r].firms[i].totalProfit),
    backgroundColor: CHART_REGIME_COLORS[r] || '#888',
  }));

  const elBar = document.getElementById('chartProfitByFirm');
  if (elBar) {
    resultsChartInstances.push(new Chart(elBar, {
      type: 'bar',
      data: { labels: firmLabels, datasets: profitDatasets },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        aspectRatio: 1.6,
        plugins: {
          title: { display: true, text: 'Total profit by firm ($)' },
          legend: { position: 'bottom' },
        },
        scales: {
          x: { stacked: false, title: { display: true, text: 'Firm' } },
          y: { title: { display: true, text: 'Profit ($)' } },
        },
      },
    }));
  }
}

/** Does firm `i` have clean tech in `regime`? (union of state + RTDB claims cache) */
function firmHasCleanTech(regime, i) {
  const rd = state && state.regimeData[regime];
  if (rd && rd.firms[i] && rd.firms[i].cleanTech) return true;
  const c = cleantechClaimsByRegime[regime];
  return !!(c && c[String(i)]);
}

/** How many firms have clean tech (union of state + RTDB cache). */
function countCleanTechSlots(regime) {
  if (!state) return 0;
  const n = state.config.numFirms;
  let count = 0;
  for (let i = 0; i < n; i++) if (firmHasCleanTech(regime, i)) count++;
  return count;
}

const content = document.getElementById('content');
const navEl = document.getElementById('regimeNav');
const roomCodeEl = document.getElementById('roomCodeDisplay');
const connDotsEl = document.getElementById('connDots');

/* ── Init ── */

export async function init() {
  roomCodeEl.textContent = ROOM;

  const joinUrl = new URL('index.html', window.location.href);
  joinUrl.searchParams.set('room', ROOM);
  const qrEl = document.getElementById('qrCode');
  if (qrEl) qrEl.src = qrCodeUrl(joinUrl.toString());

  const joinUrlEl = document.getElementById('joinUrl');
  if (joinUrlEl) {
    joinUrlEl.textContent = joinUrl.toString();
    joinUrlEl.href = joinUrl.toString();
  }

  onStudentConnections(ROOM, conns => {
    studentConnections = conns;
    renderConnectionDots();
  });

  onStateChange(ROOM, newState => {
    try {
      state = normalizeStateFromRemote(newState);
      if (!state) {
        content.innerHTML = `<div class="card"><h2>Room not found</h2><p>No game state exists for room <strong>${ROOM}</strong>. The room may have expired, never been created, or the URL may be wrong.</p><p><a href="index.html" class="btn btn-primary">Back to landing page</a></p></div>`;
        return;
      }
      state.config = buildConfig(state.config);
      console.log(`[HOST] onStateChange: regime=${state.regime}, cleantechCache=`, JSON.stringify(cleantechClaimsByRegime));
      renderNav();
      listenForSubmissions();
      if (sessionRegimes().includes(state.regime)) {
        const rd = state.regimeData[state.regime];
        if (rd && rd.debriefActive) listenForProposals(state.regime);
      }
      listenForCleanTechClaims();
      render();
    } catch (err) {
      console.error(err);
      content.innerHTML = `<div class="card"><h2>Something went wrong</h2><p>${String(err.message || err)}</p><p>Check the browser console for details.</p></div>`;
    }
  });
}

/* ── Firebase push helper ── */

async function sync() {
  const plain = JSON.parse(JSON.stringify(state));
  await pushState(ROOM, plain);
}

/* ── Navigation ── */

function renderNav() {
  if (!state) return;
  const navFree = !!state.facilitatorNavUnlocked;
  const seq = sessionRegimes();
  const jumpOptions = [
    ['', 'Skip to\u2026'],
    ['setup', 'Setup'],
    ...seq.map((r, idx) => [r, `${idx + 1}. ${REGIME_LABELS[r]}`]),
    ['results', 'Results'],
  ].map(([val, label]) => `<option value="${val}">${label}</option>`).join('');
  navEl.innerHTML = `
    <div class="regime-nav-row">
    <button class="regime-btn ${state.regime === 'setup' ? 'active' : ''} ${state.completedRegimes.includes('setup') ? 'completed' : ''}"
            onclick="window.hostApp.switchRegime('setup')">Setup</button>
    ${seq.map((r, idx) => {
      const visible = navFree || state.completedRegimes.includes(getPrevRegime(r)) || state.regime === r || state.completedRegimes.includes(r);
      const active = state.regime === r;
      const completed = state.completedRegimes.includes(r);
      return `<button class="regime-btn ${active ? 'active' : ''} ${completed ? 'completed' : ''} ${!visible ? 'locked' : ''}"
                      onclick="window.hostApp.switchRegime('${r}')"
                      ${!visible ? 'disabled' : ''}>${idx + 1}. ${REGIME_LABELS[r]}</button>`;
    }).join('')}
    <button class="regime-btn ${state.regime === 'results' ? 'active' : ''}"
            onclick="window.hostApp.switchRegime('results')">Results</button>
    </div>
    <div class="facilitator-nav-tools" style="margin-top:0.45rem;padding-top:0.45rem;border-top:1px solid var(--border, #d4e6f1);display:flex;flex-wrap:wrap;align-items:center;gap:0.65rem 1rem;font-size:0.82rem;color:var(--text-secondary);">
      <label style="display:inline-flex;align-items:center;gap:0.35rem;cursor:pointer;">
        <input type="checkbox" ${navFree ? 'checked' : ''} onchange="window.hostApp.setFacilitatorNavUnlocked(this.checked)">
        <span>Unlock all regime tabs</span>
      </label>
      <span style="opacity:0.45;">|</span>
      <label style="display:inline-flex;align-items:center;gap:0.35rem;">
        <span>Jump</span>
        <select class="host-jump-select" title="Go straight to a screen (e.g. resume next week or test one regime)"
                onchange="if(this.value) window.hostApp.jumpToRegime(this.value)">
          ${jumpOptions}
        </select>
      </label>
    </div>
  `;
}

function getPrevRegime(regime) {
  if (!state) return 'setup';
  return previousRegimeInSession(state.config, regime);
}

function renderConnectionDots() {
  if (!state || !connDotsEl) return;
  connDotsEl.innerHTML = state.firms.map((f, i) => {
    const connected = studentConnections[i] === true;
    return `<span class="connection-dot ${connected ? 'connected' : ''}" title="${f.name}: ${connected ? 'connected' : 'disconnected'}"></span>`;
  }).join('');
}

/* ── Regime switching ── */

window.hostApp = {
  switchRegime(regime) {
    if (!state) return;
    const seq = sessionRegimes();
    if (state.regime === 'setup' && regime !== 'setup' && seq.includes(regime)) {
      state.gameStarted = true;
    }
    state.regime = regime;
    if (seq.includes(regime) && !state.regimeData[regime]) {
      state.regimeData[regime] = initRegimeData(state.config);
    }
    delete roundFormErrorsByRegime[regime];
    delete tradeFormErrorsByRegime[regime];
    listenForSubmissions();
    sync();
  },

  jumpToRegime(regime) {
    if (!state) return;
    if (regime !== 'setup' && regime !== 'results' && !REGIMES.includes(regime)) return;
    window.hostApp.switchRegime(regime);
    const sel = document.querySelector('.host-jump-select');
    if (sel) sel.value = '';
  },

  setFacilitatorNavUnlocked(unlocked) {
    if (!state) return;
    state.facilitatorNavUnlocked = !!unlocked;
    renderNav();
    sync();
  },

  setFirmName(i, name) {
    state.firms[i].name = name;
    sync();
  },

  async setCleanTech(regime, i, val) {
    if (val) {
      const result = setCleanTech(state, regime, i);
      if (result.error) { alert(result.error); return; }
    } else {
      const fd = state.regimeData[regime].firms[i];
      if (fd.cleanTech) {
        fd.capital += fd.cleanTechInvestment;
        fd.totalProfit += fd.cleanTechInvestment;
        fd.cleanTechInvestment = 0;
        fd.cleanTech = false;
      }
    }
    cleantechClaimsByRegime[regime] = cleantechClaimsByRegime[regime] || {};
    if (val) cleantechClaimsByRegime[regime][String(i)] = true;
    else delete cleantechClaimsByRegime[regime][String(i)];
    try {
      await mirrorCleanTechClaim(ROOM, regime, i, val);
    } catch (e) {
      console.error('[HOST] mirrorCleanTechClaim failed', e);
    }
    sync();
  },

  setPermits(regime, i, val) {
    const parsed = parseWholeNumberInput(val);
    state.regimeData[regime].firms[i].permits = parsed == null ? 0 : Math.max(0, parsed);
    sync();
  },

  async submitRound(regime) {
    const d = state.regimeData[regime];
    bakeCleanTechIntoState(regime);
    const production = [];
    for (let i = 0; i < state.config.numFirms; i++) {
      const el = document.getElementById(`prod-${regime}-${i}`);
      const fromSubmission = currentSubmissions[i];
      let val;
      if (el) {
        const parsed = parseWholeNumberInput(el.value);
        if (parsed == null || parsed < 0) {
          roundFormErrorsByRegime[regime] = `Enter a whole non-negative number for ${state.firms[i].name}.`;
          render();
          return;
        }
        val = parsed;
      } else {
        val = fromSubmission ? Number(fromSubmission.quantity) || 0 : 0;
      }
      production.push(val);
    }
    delete roundFormErrorsByRegime[regime];
    const prevRound = d.currentRound;
    processRound(state, regime, production);
    const newRound = d.currentRound;
    console.log(`[HOST] submitRound: processed ${regime} round ${prevRound} → now ${newRound}`);
    await clearSubmissions(ROOM, regime, prevRound);
    console.log(`[HOST] submitRound: cleared submissions for ${regime}_${prevRound}`);
    currentSubmissions = {};
    submissionKey = null;
    sync();
    console.log(`[HOST] submitRound: synced, submissionKey reset — listenForSubmissions will rebind on next onStateChange`);
  },

  goToDebrief(regime) {
    hostDebriefRegime = regime;
    render();
  },

  backToRegime(regime) {
    hostDebriefRegime = null;
    render();
  },

  startDebrief(regime) {
    state.regimeData[regime].debriefActive = true;
    listenForProposals(regime);
    sync();
  },

  completeAndAdvance(regime, next) {
    bakeCleanTechIntoState(regime);
    hostDebriefRegime = null;
    state.regimeData[regime].debriefActive = false;
    if (proposalUnsub) { proposalUnsub(); proposalUnsub = null; proposalRegime = null; }
    currentProposals = {};
    completeRegime(state, regime);
    state.regime = next;
    if (sessionRegimes().includes(next) && !state.regimeData[next]) {
      state.regimeData[next] = initRegimeData(state.config);
    }
    listenForSubmissions();
    sync();
  },

  recordTrade(regime) {
    const seller = parseWholeNumberInput(document.getElementById('tm-seller')?.value);
    const buyer = parseWholeNumberInput(document.getElementById('tm-buyer')?.value);
    const qtyRaw = document.getElementById('tm-qty')?.value;
    const qty = parseWholeNumberInput(qtyRaw);
    const priceRaw = document.getElementById('tm-price')?.value;
    const price = Number(priceRaw);
    if (seller == null || buyer == null) {
      tradeFormErrorsByRegime[regime] = 'Select both a seller and a buyer.';
      render();
      return;
    }
    if (qty == null || qty <= 0) {
      tradeFormErrorsByRegime[regime] = 'Permits traded must be a whole number of at least 1.';
      render();
      return;
    }
    if (!Number.isFinite(price) || price < 0) {
      tradeFormErrorsByRegime[regime] = 'Price per permit must be a non-negative number.';
      render();
      return;
    }
    const result = processPermitTrade(state, regime, seller, buyer, qty, price);
    if (result.error) { tradeFormErrorsByRegime[regime] = result.error; render(); return; }
    delete tradeFormErrorsByRegime[regime];
    sync();
  },

  undoRound(regime) {
    if (confirm('Undo the last round? This cannot be re-done.')) {
      undoLastRound(state, regime);
      sync();
    }
  },

  applySessionConfig() {
    if (!state || state.gameStarted) return;
    const numFirms = Math.max(3, Math.min(8, parseInt(document.getElementById('cfg-num-firms')?.value, 10) || 5));
    const numRounds = Math.max(3, Math.min(7, parseInt(document.getElementById('cfg-num-rounds')?.value, 10) || 5));
    const enabled = [];
    for (const r of OPTIONAL_REGIMES) {
      const el = document.getElementById(`cfg-regime-${r}`);
      if (el && el.checked) enabled.push(r);
    }
    const nextCfg = buildConfig({
      ...state.config,
      numFirms,
      numRounds,
      enabledRegimes: enabled,
    });
    state.config = nextCfg;
    state.firms = resizeFirmsList(state.firms, numFirms);
    sync();
  },

  resetGame() {
    if (confirm('Reset the entire game? All data will be lost.')) {
      const config = buildConfig(state.config);
      state = createInitialState(config);
      state.regime = 'setup';
      sync();
    }
  },
};

/**
 * Copy RTDB cleantech claims into state.regimeData[regime].firms[].cleanTech
 * so the game engine (processRound, etc.) sees the correct flags.
 * Called just before submitRound / completeAndAdvance — the only times
 * the engine actually needs cleanTech in state.
 */
function bakeCleanTechIntoState(regime) {
  if (!state) return;
  const rd = state.regimeData[regime];
  if (!rd) return;
  const n = state.config.numFirms;
  for (let i = 0; i < n; i++) {
    const shouldHave = firmHasCleanTech(regime, i);
    if (shouldHave && !rd.firms[i].cleanTech) {
      setCleanTech(state, regime, i);
    }
  }
}

/* ── Submission listener ── */

function listenForSubmissions() {
  if (!state || !sessionRegimes().includes(state.regime)) {
    if (submissionUnsub) { submissionUnsub(); submissionUnsub = null; submissionKey = null; }
    return;
  }
  const d = state.regimeData[state.regime];
  if (!d || d.currentRound >= state.config.numRounds) {
    if (submissionUnsub) { submissionUnsub(); submissionUnsub = null; submissionKey = null; }
    return;
  }
  const wantKey = `${state.regime}_${d.currentRound}`;
  if (wantKey === submissionKey) {
    console.log(`[HOST] listenForSubmissions: already on ${wantKey}, skipping`);
    return;
  }
  console.log(`[HOST] listenForSubmissions: switching ${submissionKey} → ${wantKey}`);
  if (submissionUnsub) { submissionUnsub(); submissionUnsub = null; }
  submissionKey = wantKey;
  currentSubmissions = {};
  submissionUnsub = onSubmissions(ROOM, state.regime, d.currentRound, subs => {
    console.log(`[HOST] onSubmissions callback for ${wantKey}:`, JSON.stringify(subs));
    currentSubmissions = subs;
    render();
  });
}

/* ── Clean-tech claims listener ── */

function listenForCleanTechClaims() {
  if (!state || !sessionRegimes().includes(state.regime)) {
    console.log('[HOST] listenForCleanTechClaims: no state or not a regime, unsubscribing');
    if (cleantechUnsub) { cleantechUnsub(); cleantechUnsub = null; cleantechKey = null; }
    return;
  }
  const regime = state.regime;
  const d = state.regimeData[regime];
  if (!regimeUsesCleanTech(regime) || !d || d.currentRound !== 0 || d.rounds.length > 0) {
    console.log(`[HOST] listenForCleanTechClaims: skipping for ${regime} (usesClean=${regimeUsesCleanTech(regime)}, round=${d?.currentRound}, rounds=${d?.rounds?.length})`);
    if (cleantechUnsub) { cleantechUnsub(); cleantechUnsub = null; cleantechKey = null; }
    return;
  }
  if (cleantechKey === regime && cleantechUnsub) {
    console.log(`[HOST] listenForCleanTechClaims: already listening on ${regime}`);
    return;
  }
  if (cleantechUnsub) { cleantechUnsub(); cleantechUnsub = null; }
  cleantechKey = regime;
  console.log(`[HOST] listenForCleanTechClaims: subscribing to cleantech/${regime}`);
  cleantechUnsub = onCleanTechClaims(ROOM, regime, claims => {
    const parsed = claims && typeof claims === 'object' && !Array.isArray(claims) ? claims : {};
    console.log(`[HOST] onCleanTechClaims callback for ${regime}:`, JSON.stringify(parsed));
    cleantechClaimsByRegime[regime] = parsed;
    render();
  });
}

/* ── Proposal listener ── */

function listenForProposals(regime) {
  if (proposalRegime === regime) return;
  if (proposalUnsub) { proposalUnsub(); proposalUnsub = null; }
  proposalRegime = regime;
  currentProposals = {};
  proposalUnsub = onProposals(ROOM, regime, proposals => {
    currentProposals = proposals;
    render();
  });
}

/* ── Main render ── */

function render() {
  if (!state) { content.innerHTML = '<div class="card"><p>Loading…</p></div>'; return; }

  destroyResultsCharts();
  switch (state.regime) {
    case 'setup': content.innerHTML = renderSetup(); break;
    case 'results': content.innerHTML = renderResults(); break;
    default:
      if (sessionRegimes().includes(state.regime)) {
        if (hostDebriefRegime === state.regime) {
          content.innerHTML = renderHostDebrief(state.regime);
        } else {
          content.innerHTML = renderRegime(state.regime);
        }
      } else {
        content.innerHTML = `<div class="card"><h2>Unrecognised game state</h2><p>Regime is <code>${String(state.regime)}</code>. Try resetting the game or creating a new room.</p><button class="btn btn-primary" onclick="window.hostApp.resetGame()">Reset Game</button></div>`;
      }
  }
  if (state.regime === 'results') {
    requestAnimationFrame(() => mountResultsCharts());
  }
}

/* ── Setup ── */

function renderSetup() {
  const joinUrl = new URL('index.html', window.location.href);
  joinUrl.searchParams.set('room', ROOM);
  const seq = sessionRegimes();
  const regimeCountLabel = seq.length === 1 ? 'one regime (free market only)' : `${seq.length} regulatory regimes`;

  const nameInputs = state.firms.map((f, i) => `
    <div class="prod-input-card">
      <div class="firm-name" style="color:${firmColor(i)}">Firm ${i + 1}</div>
      <input type="text" value="${escAttr(f.name)}"
             onchange="window.hostApp.setFirmName(${i}, this.value)" placeholder="Firm name" aria-label="Name for firm ${i + 1}">
    </div>`).join('');

  const derived = deriveSessionParams(state.config.numFirms, state.config.numRounds, state.config);
  const derivedSummary = `
    <div class="info-box accent" style="margin-top:0.75rem;font-size:0.84rem;">
      <strong>Auto-tuned parameters</strong> (calibrated from your firm/round choices)
      <div style="margin-top:0.5rem;">
        <div class="stat-row" style="border-bottom:1px solid rgba(0,0,0,0.06);"><span class="stat-label">Starting capital</span><span class="stat-value">${fmtMoney(derived.startCapital)}</span></div>
        <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.35rem;margin-top:0.15rem;">Set so free-market growth triggers catastrophe before the final round</div>
        <div class="stat-row" style="border-bottom:1px solid rgba(0,0,0,0.06);"><span class="stat-label">Clean tech slots</span><span class="stat-value">${derived.maxCleanTech} of ${state.config.numFirms} firms</span></div>
        <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.35rem;margin-top:0.15rem;">Maintains firm heterogeneity for Carbon Tax and Cap regimes</div>
        <div class="stat-row" style="border-bottom:1px solid rgba(0,0,0,0.06);"><span class="stat-label">Clean tech investment (sunk)</span><span class="stat-value">${fmtMoney(derived.cleanTechCost)} one-off</span></div>
        <div style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.35rem;margin-top:0.15rem;">Deducted from capital when chosen; clean firms start behind but catch up via halved tax/emissions</div>
        <div class="stat-row"><span class="stat-label">Permits per firm (Cap regimes)</span><span class="stat-value">${derived.permitsPerFirm}</span></div>
        <div style="font-size:0.78rem;color:var(--text-secondary);margin-top:0.15rem;">Ensures permits actually constrain production below free-market levels</div>
      </div>
    </div>`;

  const sessionOptionsCard = !state.gameStarted ? `
    <div class="card">
      <h2>Session options</h2>
      <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:1rem;">
        Set these before you begin Round 1. Once the game starts, session options are locked (use <strong>Reset game</strong> to change them).
      </p>
      <div class="two-col">
        <div class="form-group">
          <label for="cfg-num-firms">Number of firms</label>
          <input type="number" id="cfg-num-firms" min="3" max="8" value="${state.config.numFirms}" step="1" inputmode="numeric" pattern="[0-9]*">
        </div>
        <div class="form-group">
          <label for="cfg-num-rounds">Rounds per regime</label>
          <input type="number" id="cfg-num-rounds" min="3" max="7" value="${state.config.numRounds}" step="1" inputmode="numeric" pattern="[0-9]*">
        </div>
      </div>
      <fieldset class="regime-toggle-fieldset">
        <legend>Regimes after free market</legend>
        <p style="font-size:0.8rem;color:var(--text-secondary);margin-bottom:0.5rem;">
          Free market is always first. Cap &amp; Trade automatically includes Cap if selected.
        </p>
        ${OPTIONAL_REGIMES.map(r => `
          <label class="checkbox-inline"><input type="checkbox" id="cfg-regime-${r}" value="${r}"
            ${state.config.enabledRegimes.includes(r) ? 'checked' : ''}> ${REGIME_LABELS[r]}</label>`).join('')}
      </fieldset>
      <button type="button" class="btn btn-outline btn-block" onclick="window.hostApp.applySessionConfig()">
        Apply session options
      </button>
      ${derivedSummary}
    </div>` : `
    <div class="card">
      <h2>Session options (locked)</h2>
      <p style="font-size:0.88rem;color:var(--text-secondary);">
        ${state.config.numFirms} firms, ${state.config.numRounds} rounds per regime, starting capital ${fmtMoney(state.config.startCapital)}.
        Regimes: ${seq.map(r => REGIME_LABELS[r]).join(' \u2192 ')}.
      </p>
      ${derivedSummary}
    </div>`;

  return `
    <div class="card room-hero">
      <div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0.25rem;">Room Code</div>
      <div class="room-code" aria-label="Room code">${ROOM}</div>
      <img class="qr-img" src="${qrCodeUrl(joinUrl.toString())}" alt="QR code to join this game room" width="200" height="200">
      <div class="join-url">${joinUrl.toString()}</div>
    </div>

    ${onboardingGuide()}

    ${sessionOptionsCard}

    <div class="card">
      <h2>Game Setup</h2>
      <div class="info-box accent">
        <strong>Carbon Pricing Simulation Game</strong> &mdash; ${state.config.numFirms} firms compete across
        ${regimeCountLabel}. Each thingamabob costs ${fmtMoney(state.config.costPerUnit)},
        sells for ${fmtMoney(state.config.revenuePerUnit)}, and adds ${state.config.ppmPer1000} ppm
        CO\u2082 per 1,000 produced. Starting capital: ${fmtMoney(state.config.startCapital)}.
        Starting CO\u2082: ${state.config.startPpm} ppm. Catastrophe at ${state.config.triggerPpm} ppm.
      </div>
      <h3>Name the firms</h3>
      <div class="prod-grid">${nameInputs}</div>
      <div class="mt-1">
        <button class="btn btn-primary btn-block" onclick="window.hostApp.switchRegime('freemarket')">
          Begin Round 1: Free Market &rarr;
        </button>
      </div>
    </div>`;
}

function renderIndustryTotals(regime, d, config) {
  const totalProfit = d.firms.reduce((s, f) => s + f.totalProfit, 0);
  const roundsRemaining = Math.max(0, config.numRounds - d.currentRound);
  return `
    <div class="card industry-totals-card">
      <h3>Live Industry Totals</h3>
      <div class="stat-row"><span class="stat-label">Regime</span><span class="stat-value">${REGIME_LABELS[regime]}</span></div>
      <div class="stat-row"><span class="stat-label">Total industry profit</span><span class="stat-value">${fmtMoney(totalProfit)}</span></div>
      <div class="stat-row"><span class="stat-label">Current CO\u2082 concentration</span><span class="stat-value">${fmt(d.ppm)} ppm</span></div>
      <div class="stat-row"><span class="stat-label">Rounds remaining</span><span class="stat-value">${fmt(roundsRemaining)}</span></div>
    </div>`;
}

/* ── Generic regime renderer ── */

function renderRegime(regime) {
  const d = state.regimeData[regime];
  if (!d) return '';
  const config = state.config;
  const roundDone = d.currentRound >= config.numRounds;
  const isCaC = regimeHasCap(regime);
  const isTax = regimeUsesTax(regime);
  const isTrade = regimeUsesPermits(regime);
  const hasMarket = regimeHasPermitMarket(regime);
  const usesClean = regimeUsesCleanTech(regime);

  const nextRegime = nextRegimeAfter(state.config, regime);
  const nextLabel = nextRegime === 'results' ? 'Results' : REGIME_LABELS[nextRegime];

  const fnotes = facilitatorNotes(regime);
  let fnotesHtml = '';
  const _output = computeTotalEconomicOutput(state, regime);
  const _budgetUsed = computeBudgetUsed(state, regime);
  const efficiencyAnalog = outputBudgetAnalogy(_output, _budgetUsed);
  const analogSection = efficiencyAnalog
    ? `<div class="efficiency-analogy-box" style="margin-top:1rem;"><p>${efficiencyAnalog}</p></div>`
    : '';
  if (fnotes || efficiencyAnalog) {
    const fnotesBody = fnotes ? `
          <p><strong>Timing:</strong> ${fnotes.timing}</p>
          <p><strong>Key points:</strong></p>
          <ul>${fnotes.keyPoints.map(p => `<li>${p}</li>`).join('')}</ul>
          <p><strong>Expected dynamics:</strong></p>
          <ul>${fnotes.expectedDynamics.map(p => `<li>${p}</li>`).join('')}</ul>
          <p><strong>Debrief tips:</strong></p>
          <ul>${fnotes.debriefTips.map(p => `<li>${p}</li>`).join('')}</ul>` : '';
    fnotesHtml = `
      <details class="facilitator-notes">
        <summary>Facilitator Notes — ${REGIME_LABELS[regime]}</summary>
        <div class="fn-body">
          ${fnotesBody}
          ${analogSection}
        </div>
      </details>`;
  }

  let html = `
    <div class="card">
      <h2>${REGIME_LABELS[regime]}</h2>
      <div class="info-box accent">${regimeDescription(regime, config)}</div>
    </div>
    ${fnotesHtml}
    ${!roundDone ? renderCO2Meter(d.ppm, config, renderCO2Extra(d.ppm, config, isTax ? `<div style="margin-top:0.4rem;font-size:0.85rem;">Tax revenue: <strong>${fmtMoney(d.totalTaxRevenue)}</strong></div>` : '')) : ''}
    ${!roundDone ? renderIndustryTotals(regime, d, config) : ''}
  `;

  if (usesClean && d.currentRound === 0 && d.rounds.length === 0) {
    html += renderCleanTechAssignment(regime, d);
  }

  if (isTrade && d.currentRound === 0 && d.rounds.length === 0) {
    html += renderPermitAllocation(regime, d, config);
  }

  if (hasMarket && !roundDone) {
    html += renderPermitMarket(regime, d, config);
  }

  if (!roundDone) {
    html += renderProductionInput(regime, d, config);
  }

  if (d.rounds.length > 0) {
    html += renderRoundHistory(regime, d, state.firms, state.config, null);
    if (d.rounds.length > 0 && !roundDone) {
      html += `<div class="card text-center">
        <button class="btn btn-outline btn-sm" onclick="window.hostApp.undoRound('${regime}')">
          Undo Last Round
        </button>
      </div>`;
    }
  }

  if (roundDone) {
    html += `<div class="card text-center">
      <p style="margin-bottom:0.75rem;color:var(--text-secondary);">All ${config.numRounds} rounds complete.</p>
      <button class="btn btn-primary btn-block" onclick="window.hostApp.goToDebrief('${regime}')" style="font-size:1rem;padding:0.7rem;">
        View Regime Summary &amp; Debrief &rarr;
      </button>
    </div>`;
  }

  return html;
}

/* ── Clean tech assignment (uses overlay helpers) ── */

function renderCleanTechAssignment(regime, d) {
  const maxSlots = state.config.maxCleanTech ?? 3;
  const slotsUsed = countCleanTechSlots(regime);
  console.log(`[HOST] renderCleanTechAssignment: regime=${regime}, slotsUsed=${slotsUsed}, cache=`, JSON.stringify(cleantechClaimsByRegime[regime]), 'state firms cleanTech=', d.firms.map(f => f.cleanTech));
  return `
    <div class="card">
      <h3>Clean Technology Assignment</h3>
      <p style="font-size:0.88rem;color:var(--text-secondary);margin-bottom:0.6rem;">
        Up to <strong>${maxSlots}</strong> firms may have clean production technology (first-come on student devices, or assign here).
        Halves emissions per unit; requires a one-off investment of ${fmtMoney(state.config.cleanTechCost)} deducted from capital immediately.
        <strong>${slotsUsed}</strong> of <strong>${maxSlots}</strong> slots in use.
      </p>
      <div class="prod-grid">
        ${state.firms.map((f, i) => {
          const hasCT = firmHasCleanTech(regime, i);
          return `<div class="prod-input-card">
            <div class="firm-name" style="color:${firmColor(i)}">${f.name}</div>
            <label><input type="checkbox" ${hasCT ? 'checked' : ''}
                   onchange="window.hostApp.setCleanTech('${regime}', ${i}, this.checked)"> Clean Tech</label>
          </div>`;
        }).join('')}
      </div>
    </div>`;
}

/* ── Permit allocation ── */

function renderPermitAllocation(regime, d, config) {
  const perFirm = defaultPermitsPerFirm(config);
  d.firms.forEach(fd => { if (fd.permits === 0) fd.permits = perFirm; });

  return `
    <div class="card">
      <h3>Permit Allocation</h3>
      <p style="font-size:0.88rem;color:var(--text-secondary);margin-bottom:0.6rem;">
        Each permit = ${config.ppmPer1000} ppm CO\u2082 = 1,000 units (standard) or 2,000 units (clean tech).
      </p>
      <div class="prod-grid">
        ${state.firms.map((f, i) => {
          const fd = d.firms[i];
          return `<div class="prod-input-card">
            <div class="firm-name" style="color:${firmColor(i)}">${f.name}</div>
            <label>Permits</label>
            <input type="number" min="0" value="${fd.permits}"
                   onchange="window.hostApp.setPermits('${regime}', ${i}, this.value)"
                   step="1" inputmode="numeric" pattern="[0-9]*">
          </div>`;
        }).join('')}
      </div>
      <div class="stat-row mt-1">
        <span class="stat-label">Total permits issued</span>
        <span class="stat-value">${d.firms.reduce((s, f) => s + f.permits, 0)}</span>
      </div>
    </div>`;
}

/* ── Permit market ── */

function renderPermitMarket(regime, d, config) {
  const opts = state.firms.map((f, i) => `<option value="${i}">${f.name}</option>`).join('');
  const trades = d.trades || [];
  const prices = trades.map(t => t.price);
  const totalVol = trades.reduce((s, t) => s + t.quantity, 0);
  const avg = prices.length ? prices.reduce((a, b) => a + b, 0) / prices.length : null;
  const tradeError = tradeFormErrorsByRegime[regime] || '';

  const holdingsRows = state.firms.map((f, i) => {
    const fd = d.firms[i];
    const pr = permitsRemaining(fd);
    return `<tr>
      <td style="color:${firmColor(i)};font-weight:600;">${f.name}</td>
      <td class="num">${fmt(fd.permits)}</td>
      <td class="num">${fmt(pr)}</td>
      <td class="num">${fmtMoney(fd.capital)}</td>
    </tr>`;
  }).join('');

  const tradeRows = trades.map((t, ti) => `<tr>
    <td>${ti + 1}</td>
    <td style="color:${firmColor(t.seller)};font-weight:600;">${state.firms[t.seller].name}</td>
    <td style="color:${firmColor(t.buyer)};font-weight:600;">${state.firms[t.buyer].name}</td>
    <td class="num">${fmt(t.quantity)}</td>
    <td class="num">${fmtMoney(t.price)}</td>
    <td class="num">${fmtMoney(t.quantity * t.price)}</td>
  </tr>`).join('');

  return `
    <div class="card">
      <h3>Permit Market (facilitator log)</h3>
      <p style="font-size:0.88rem;color:var(--text-secondary);margin-bottom:0.75rem;">
        When firms agree a deal verbally, record it here.
      </p>
      <div class="two-col">
        <div class="form-group"><label>Seller</label><select id="tm-seller">${opts}</select></div>
        <div class="form-group"><label>Buyer</label>
          <select id="tm-buyer">${state.firms.map((f, i) => `<option value="${i}" ${i === 1 ? 'selected' : ''}>${f.name}</option>`).join('')}</select>
        </div>
      </div>
      <div class="two-col">
        <div class="form-group"><label>Permits traded</label><input type="number" id="tm-qty" min="1" value="1" step="1" inputmode="numeric" pattern="[0-9]*"></div>
        <div class="form-group"><label>Price per permit ($)</label><input type="number" id="tm-price" min="0" step="1" value="150" inputmode="numeric" pattern="[0-9]*"></div>
      </div>
      ${tradeError ? `<div class="form-error">${tradeError}</div>` : ''}
      <button class="btn btn-success" onclick="window.hostApp.recordTrade('${regime}')">Record Trade</button>

      <div class="two-col mt-1">
        <div>
          <h3 style="margin-bottom:0.4rem;">Market Summary</h3>
          <div class="stat-row"><span class="stat-label">Permits traded</span><span class="stat-value">${fmt(totalVol)}</span></div>
          <div class="stat-row"><span class="stat-label">Average price</span><span class="stat-value">${avg != null ? fmtMoney(avg) : '\u2014'}</span></div>
          <div class="stat-row"><span class="stat-label">Min / Max</span><span class="stat-value">${prices.length ? fmtMoney(Math.min(...prices)) + ' / ' + fmtMoney(Math.max(...prices)) : '\u2014'}</span></div>
        </div>
        <div>
          <h3 style="margin-bottom:0.4rem;">Current Holdings</h3>
          <table>
            <thead><tr><th>Firm</th><th class="num">Held</th><th class="num">Avail</th><th class="num">Capital</th></tr></thead>
            <tbody>${holdingsRows}</tbody>
          </table>
        </div>
      </div>
      ${trades.length ? `<div class="trade-log"><h3 style="margin-top:0.5rem;">Trade Log</h3>
        <table><thead><tr><th>#</th><th>Seller</th><th>Buyer</th><th class="num">Qty</th><th class="num">$/permit</th><th class="num">Total</th></tr></thead>
        <tbody>${tradeRows}</tbody></table></div>` : ''}
    </div>`;
}

/* ── Production input (uses overlay helpers for tech badge) ── */

function renderProductionInput(regime, d, config) {
  const isCaC = regimeHasCap(regime);
  const isTax = regimeUsesTax(regime);
  const isTrade = regimeUsesPermits(regime);
  const usesClean = regimeUsesCleanTech(regime);
  const roundNum = d.currentRound + 1;
  const totalSubmitted = Object.keys(currentSubmissions).length;
  const roundError = roundFormErrorsByRegime[regime] || '';

  return `
    <div class="card">
      <h3>Round ${roundNum} of ${config.numRounds} &mdash; Production Decisions
        <span style="float:right;font-size:0.8rem;color:var(--text-secondary);">
          ${totalSubmitted}/${config.numFirms} submitted digitally
        </span>
      </h3>
      <div class="prod-grid">
        ${state.firms.map((f, i) => {
          const fd = d.firms[i];
          const hasCT = usesClean && firmHasCleanTech(regime, i);
          const fdEff = hasCT ? { ...fd, cleanTech: true } : fd;
          const maxAllowed = maxAllowedProduction(fdEff, config, regime);
          const sub = currentSubmissions[i];
          const prefilledVal = sub ? sub.quantity : 0;
          const techBadge = usesClean ? cleanBadge(fdEff) : '';
          let extraInfo = `Capital: ${fmtMoney(fd.capital)}`;
          if (isCaC) extraInfo += ` | Cap: ${fmt(config.cacCap)}`;
          if (isTrade) {
            const pr = permitsRemaining(fdEff);
            const upp = unitsPerPermit(fdEff);
            extraInfo += ` | Permits: ${fmt(pr)} (=${fmt(pr * upp)} units)`;
          }

          return `<div class="prod-input-card" style="${sub ? 'border-color:var(--success);' : ''}">
            <div class="firm-name" style="color:${firmColor(i)}">${f.name} ${techBadge}</div>
            <div style="font-size:0.78rem;color:var(--text-secondary);">${extraInfo}</div>
            ${sub
              ? `<span class="submission-status received">Submitted: ${fmt(sub.quantity)}</span>`
              : '<span class="submission-status pending">Waiting…</span>'}
            <input type="number" id="prod-${regime}-${i}" min="0" max="${maxAllowed}"
                   value="${prefilledVal}" style="margin-top:0.3rem;" step="1" inputmode="numeric" pattern="[0-9]*" onkeydown="if(event.key==='Enter')window.hostApp.submitRound('${regime}')">
          </div>`;
        }).join('')}
      </div>
      ${roundError ? `<div class="form-error mt-1">${roundError}</div>` : ''}
      <div class="mt-1">
        <button class="btn btn-success btn-block" onclick="window.hostApp.submitRound('${regime}')">
          Submit Round ${roundNum}
        </button>
      </div>
    </div>`;
}

/* ── Round history — now uses shared renderRoundHistory from ui-helpers.js ── */

/* ── Regime summary ── */

function renderRegimeSummary(regime, d, config, nextRegime, nextLabel) {
  const totalProd = d.firms.reduce((s, f) => s + f.totalProduced, 0);
  const totalProfit = d.firms.reduce((s, f) => s + f.totalProfit, 0);
  const isTax = regimeUsesTax(regime);
  const hasMarket = regimeHasPermitMarket(regime);

  const showTaxCol = regime === 'tax';
  const showPermitCol = regime === 'trade' || regime === 'trademarket';

  const firmRows = state.firms.map((f, i) => {
    const fd = d.firms[i];
    const taxCell = showTaxCol ? `<td class="num">${fmtMoney(totalTaxPaidByFirm(d, i, config))}</td>` : '';
    const permitCell = showPermitCol ? `<td class="num">${fmt(permitsRemaining(fd))}</td>` : '';
    return `<tr>
      <td style="color:${firmColor(i)};font-weight:600;">${f.name}</td>
      <td class="num">${fmt(fd.totalProduced)}</td>
      ${taxCell}
      ${permitCell}
      <td class="num">${fmtMoney(fd.totalProfit)}</td>
      <td class="num">${fmtMoney(fd.capital)}</td>
    </tr>`;
  }).join('');

  const taxHead = showTaxCol ? '<th class="num">Tax paid</th>' : '';
  const permitHead = showPermitCol ? '<th class="num">Unused permits</th>' : '';

  let permitSummaryHtml = '';
  if (showPermitCol) {
    const withUnused = d.firms.map((fd, i) => ({ i, name: state.firms[i].name, u: permitsRemaining(fd) })).filter(x => x.u > 0);
    if (withUnused.length) {
      permitSummaryHtml = `
        <div class="info-box warn mt-1" style="font-size:0.88rem;">
          <strong>Unused permits:</strong> ${withUnused.map(x => `${x.name} (${fmt(x.u)})`).join('; ')} finished with permits left unused.
        </div>`;
    } else {
      permitSummaryHtml = `
        <div class="info-box success mt-1" style="font-size:0.88rem;">
          No firm finished with unused permits (all permit capacity was used for production).
        </div>`;
    }
  }

  const output = computeTotalEconomicOutput(state, regime);
  const budgetUsed = computeBudgetUsed(state, regime);
  const budgetCellStyle = budgetUsedStyle(budgetUsed);
  const efficiencyHtml = `
    <div class="efficiency-box">
      <div class="efficiency-metric">
        <div class="efficiency-label">Total Economic Output</div>
        <div class="efficiency-value">${formatTotalEconomicOutput(output)}</div>
        <div class="efficiency-label">Firm profit + tax revenue</div>
      </div>
      <div class="efficiency-metric"${budgetCellStyle ? ` style="${budgetCellStyle}border-radius:0.5rem;padding:0.5rem;"` : ''}>
        <div class="efficiency-label">% of Safe Carbon Budget Used</div>
        <div class="efficiency-value">${formatBudgetUsed(budgetUsed)}</div>
        <div class="efficiency-label"><i> (treating 450 ppm as the "safe" carbon budget)</i></div>
      </div>
    </div>`;

  let taxHtml = '';
  if (isTax) {
    taxHtml = `<div class="stat-row"><span class="stat-label">Total tax revenue</span><span class="stat-value">${fmtMoney(d.totalTaxRevenue)}</span></div>`;
  }

  let marketHtml = '';
  if (hasMarket && d.trades && d.trades.length) {
    const prices = d.trades.map(t => t.price);
    const vol = d.trades.reduce((s, t) => s + t.quantity, 0);
    const avg = prices.reduce((a, b) => a + b, 0) / prices.length;
    marketHtml = `
      <div class="info-box accent mt-1">
        <strong>Permit market:</strong> ${d.trades.length} trade(s), ${fmt(vol)} permits exchanged.
        Average price ${fmtMoney(avg)}; range ${fmtMoney(Math.min(...prices))} &ndash; ${fmtMoney(Math.max(...prices))}.
      </div>`;
  }

  const co2MeterHtml = renderCO2Meter(d.ppm, config, renderCO2Extra(d.ppm, config));

  const isDebriefActive = d.debriefActive;
  const prompt = debriefPrompt(regime);

  let debriefHtml = '';
  if (!isDebriefActive) {
    debriefHtml = `
      <div class="mt-1">
        <button class="btn btn-warn btn-block" onclick="window.hostApp.startDebrief('${regime}')">
          Begin Debrief &amp; Student Proposals
        </button>
      </div>`;
  } else {
    const proposalEntries = Object.entries(currentProposals);
    const proposalCards = proposalEntries.length > 0
      ? proposalEntries.map(([firmId, p]) => {
          const firm = state.firms[parseInt(firmId)];
          const name = firm ? firm.name : `Firm ${parseInt(firmId) + 1}`;
          const color = firmColor(parseInt(firmId));
          return `<div class="proposal-card" style="border-left:3px solid ${color};">
            <div style="font-weight:600;color:${color};font-size:0.85rem;">${name}</div>
            <div style="font-size:0.88rem;margin-top:0.25rem;">${p.text || '<em>No text</em>'}</div>
          </div>`;
        }).join('')
      : '<p style="font-size:0.85rem;color:var(--text-secondary);font-style:italic;">Waiting for student proposals…</p>';

    debriefHtml = `
      <div class="card debrief-active-card">
        <h3>Debrief: Student Proposals</h3>
        <div class="debrief-prompt-box">
          <p><strong>Prompt shown to students:</strong></p>
          <p style="font-style:italic;">"${prompt.question}"</p>
        </div>
        <div class="proposals-list mt-1">
          <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.5rem;">
            ${proposalEntries.length}/${state.config.numFirms} proposals received
          </div>
          ${proposalCards}
        </div>
      </div>`;
  }

  let nextPreview = '';
  if (nextRegime !== 'results' && isDebriefActive) {
    const nextDesc = regimeDescription(nextRegime, config);
    nextPreview = `
      <div class="next-regime-preview">
        <div class="next-regime-label">Coming next (facilitator only — not shown to students)</div>
        <strong>${nextLabel}</strong>
        <div style="font-size:0.82rem;margin-top:0.3rem;color:var(--text-secondary);">${nextDesc}</div>
      </div>`;
  }

  let advanceHtml = '';
  if (isDebriefActive) {
    advanceHtml = `
      <div class="mt-1">
        <button class="btn btn-primary btn-block" onclick="window.hostApp.completeAndAdvance('${regime}', '${nextRegime}')">
          Reveal &amp; Proceed to ${nextLabel} &rarr;
        </button>
      </div>`;
  }

  return `
    <div class="card">
      <h2>Regime Summary: ${REGIME_LABELS[regime]}</h2>
      <table>
        <thead><tr><th>Firm</th><th class="num">Total Produced</th>${taxHead}${permitHead}<th class="num">Total Profit</th><th class="num">Final Capital</th></tr></thead>
        <tbody>
          ${firmRows}
          <tr class="total"><td>Total</td><td class="num">${fmt(totalProd)}</td>${showTaxCol ? '<td></td>' : ''}${showPermitCol ? '<td></td>' : ''}<td class="num">${fmtMoney(totalProfit)}</td><td></td></tr>
        </tbody>
      </table>
      ${permitSummaryHtml}
      <div class="stat-row"><span class="stat-label">Catastrophe triggered?</span>
        <span class="stat-value">${d.catastrophe ? 'Yes' : 'No'}</span></div>
      ${taxHtml}
      ${marketHtml}
      ${co2MeterHtml}
      ${efficiencyHtml}
      ${debriefHtml}
      ${nextPreview}
      ${advanceHtml}
    </div>`;
}

/* ── Host debrief (separate screen, mirrors solo-app pattern) ── */

function renderHostDebrief(regime) {
  const d = state.regimeData[regime];
  if (!d) return '';
  const config = state.config;
  const nextRegime = nextRegimeAfter(config, regime);
  const nextLabel = nextRegime === 'results' ? 'Results' : REGIME_LABELS[nextRegime];

  let html = '';

  const efficiencyAnalog = outputBudgetAnalogy(
    computeTotalEconomicOutput(state, regime),
    computeBudgetUsed(state, regime),
  );
  const fnotes = facilitatorNotes(regime);
  if (fnotes || efficiencyAnalog) {
    const fnotesBody = fnotes ? `
      <p><strong>Timing:</strong> ${fnotes.timing}</p>
      <p><strong>Key points:</strong></p>
      <ul>${fnotes.keyPoints.map(p => `<li>${p}</li>`).join('')}</ul>
      <p><strong>Expected dynamics:</strong></p>
      <ul>${fnotes.expectedDynamics.map(p => `<li>${p}</li>`).join('')}</ul>
      <p><strong>Debrief tips:</strong></p>
      <ul>${fnotes.debriefTips.map(p => `<li>${p}</li>`).join('')}</ul>` : '';
    const analogSection = efficiencyAnalog
      ? `<div class="efficiency-analogy-box" style="margin-top:1rem;"><p>${efficiencyAnalog}</p></div>`
      : '';
    html += `<details class="facilitator-notes">
      <summary>Facilitator Notes — ${REGIME_LABELS[regime]}</summary>
      <div class="fn-body">${fnotesBody}${analogSection}</div>
    </details>`;
  }

  html += renderRegimeSummary(regime, d, config, nextRegime, nextLabel);

  if (d.rounds.length > 0) {
    html += renderRoundHistory(regime, d, state.firms, config, null);
  }

  html += `<div class="card text-center mt-1">
    <button class="btn btn-outline" onclick="window.hostApp.backToRegime('${regime}')">
      &larr; Back to Round View
    </button>
  </div>`;

  return html;
}

/* ── Results ── */

function renderResults() {
  const completed = state.completedRegimes.filter(r => sessionRegimes().includes(r));
  if (completed.length === 0) {
    return '<div class="card"><h2>Results</h2><p>No regimes completed yet.</p></div>';
  }

  const rows = completed.map(r => {
    const d = state.regimeData[r];
    const totalProd = d.firms.reduce((s, f) => s + f.totalProduced, 0);
    const output = computeTotalEconomicOutput(state, r);
    const budgetUsed = computeBudgetUsed(state, r);
    const budgetStyle = budgetUsedStyle(budgetUsed);
    return `<tr>
      <td><strong>${REGIME_LABELS[r]}</strong></td>
      <td class="num">${fmt(totalProd)}</td>
      <td class="num">${fmt(d.ppm)}</td>
      <td class="num">${d.catastrophe ? 'Yes' : 'No'}</td>
      <td class="num">${formatTotalEconomicOutput(output)}</td>
      <td class="num"${budgetStyle ? ` style="${budgetStyle}"` : ''}>${formatBudgetUsed(budgetUsed)}</td>
    </tr>`;
  }).join('');

  const firmCompRows = state.firms.map((f, i) => {
    const cells = completed.map(r => {
      const fd = state.regimeData[r].firms[i];
      return `<td class="num">${fmtMoney(fd.totalProfit)}</td>`;
    }).join('');
    return `<tr><td style="color:${firmColor(i)};font-weight:600;">${f.name}</td>${cells}</tr>`;
  }).join('');

  return `
    <div class="card">
      <h2>Cross-Regime Comparison</h2>
      <table>
        <thead><tr><th>Regime</th><th class="num">Total Prod.</th><th class="num">Final ppm</th><th class="num">Catastrophe?</th><th class="num">Total Economic Output</th><th class="num">Budget Used</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <p style="font-size:0.8rem;color:var(--text-secondary);margin-top:0.5rem;">Total Economic Output = firm profit + tax revenue collected by government. Budget Used = ppm added as a percentage of the safe carbon budget; values above 100% indicate overshoot of the catastrophe trigger.</p>
    </div>

    <div class="card">
      <h3>Profit by Firm Across Regimes</h3>
      <table>
        <thead><tr><th>Firm</th>${completed.map(r => `<th class="num">${REGIME_LABELS[r]}</th>`).join('')}</tr></thead>
        <tbody>${firmCompRows}</tbody>
      </table>
    </div>

    <div class="card chart-card">
      <h2>Charts</h2>
      <p id="results-charts-summary" class="a11y-chart-summary" style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0.75rem;">
        Line chart: CO\u2082 concentration after each round, by regime. Bar chart: each firm\u2019s total profit in each completed regime.
      </p>
      <div class="chart-wrap">
        <canvas id="chartPpmByRound" role="img" aria-labelledby="results-charts-summary"></canvas>
      </div>
      <div class="chart-wrap" style="margin-top:1.25rem;">
        <canvas id="chartProfitByFirm" role="img" aria-labelledby="results-charts-summary"></canvas>
      </div>
    </div>

    <div class="kuznets-reflection">
      <h3>What did we produce?</h3>
      <p>Across all of these regimes, your industry produced thingamabobs. In a real economy, some of that output would be essential goods people depend on &mdash; healthcare, food, housing, sanitation &mdash; while others would be luxuries, planned-obsolescence electronics, or positional consumption that adds little to anyone's wellbeing.</p>
      <p>The Total Economic Output figure above does not distinguish between these. Should it?</p>
    </div>

    ${renderDiscussionCard(state.config)}
    ${renderComparisonTable(completed, REGIME_LABELS)}

    <div class="card text-center">
      <button class="btn btn-primary" onclick="window.hostApp.resetGame()">Reset Game</button>
    </div>`;
}

/* ── Bootstrap ── */

init();
