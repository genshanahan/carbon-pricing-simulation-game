/**
 * Solo Play App — single-player mode with -controlled opponents.
 * No Firebase. All state is local. Reuses game-engine.js and ui-helpers.js.
 */

import {
  buildConfig, createInitialState, initRegimeData, REGIMES, REGIME_LABELS,
  processRound, processPermitTrade, completeRegime, computeTotalEconomicOutput, computeBudgetUsed,
  defaultPermitsPerFirm, maxAllowedProduction, maxAffordable, maxProductionFromPermits,
  unitsPerPermit, permitsRemaining, totalTaxPaidByFirm, setCleanTech,
  regimeSequence, nextRegimeAfter, roundProfitDetailForFirm, normalizeStateFromRemote,
} from './game-engine.js';

import {
  escHtml, fmt, fmtMoney, renderCO2Meter, firmColor,
  regimeUsesCleanTech, regimeUsesTax, regimeUsesPermits, regimeHasCap,
  regimeHasPermitMarket, regimeDescription, debriefPrompt,
  outputBudgetAnalogy, formatTotalEconomicOutput, formatBudgetUsed, budgetUsedStyle, facilitatorNotes,
  renderRoundHistory, renderCO2Extra, renderDiscussionCard, renderDiscussionFacilitatorHints, renderComparisonTable,
} from './ui-helpers.js?v=20260502';

import {
  PERSONALITIES, getPersonality,
  aiProductionDecision, aiCleanTechDecisions, aiReservationPrice, aiEvaluateTrade,
  executeAiTrades,
} from './ai-strategies.js';

/* ── Constants ── */

const PLAYER_FIRM = 0;
const NUM_FIRMS = 5;
const NUM_ROUNDS = 5;

const CHART_REGIME_COLORS = {
  freemarket: '#0072B2',
  cac: '#D55E00',
  tax: '#009E73',
  trade: '#CC79A7',
  trademarket: '#E69F00',
};

/* ── State ── */

const GAME_STORAGE_KEY = 'solo.gameState.v1';
const PROPOSALS_STORAGE_KEY = 'solo.playerProposals';

function loadStoredProposals() {
  try {
    const raw = localStorage.getItem(PROPOSALS_STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

function loadStoredGameState() {
  try {
    const raw = localStorage.getItem(GAME_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object' || !parsed.state) return null;
    const restoredState = normalizeStateFromRemote(parsed.state);
    if (!restoredState) return null;
    restoredState.config = buildConfig(restoredState.config);
    return {
      state: restoredState,
      currentScreen: ['welcome', 'regime', 'debrief', 'results'].includes(parsed.currentScreen)
        ? parsed.currentScreen
        : 'regime',
      playerProposals: parsed.playerProposals && typeof parsed.playerProposals === 'object' ? parsed.playerProposals : loadStoredProposals(),
      cleanTechDecisionMade: parsed.cleanTechDecisionMade && typeof parsed.cleanTechDecisionMade === 'object' ? parsed.cleanTechDecisionMade : {},
      submissionClampNotes: parsed.submissionClampNotes && typeof parsed.submissionClampNotes === 'object' ? parsed.submissionClampNotes : {},
      proposalSavedAt: parsed.proposalSavedAt && typeof parsed.proposalSavedAt === 'object' ? parsed.proposalSavedAt : {},
      calcSimCleanTech: !!parsed.calcSimCleanTech,
    };
  } catch {
    return null;
  }
}

function hasStoredGameState() {
  return loadStoredGameState() !== null;
}

function restoreStoredGameState() {
  const saved = loadStoredGameState();
  if (!saved) return false;
  state = saved.state;
  currentScreen = saved.currentScreen;
  playerProposals = saved.playerProposals;
  cleanTechDecisionMade = saved.cleanTechDecisionMade;
  submissionClampNotes = saved.submissionClampNotes;
  proposalSavedAt = saved.proposalSavedAt;
  calcSimCleanTech = saved.calcSimCleanTech;
  return true;
}

function persistGameState() {
  if (!state) return;
  try {
    localStorage.setItem(GAME_STORAGE_KEY, JSON.stringify({
      state,
      currentScreen,
      playerProposals,
      cleanTechDecisionMade,
      submissionClampNotes,
      proposalSavedAt,
      calcSimCleanTech,
    }));
  } catch {
    /* storage unavailable — silently degrade */
  }
}

function persistProposals() {
  try {
    localStorage.setItem(PROPOSALS_STORAGE_KEY, JSON.stringify(playerProposals));
  } catch {
    /* storage unavailable — silently degrade */
  }
}

let state = null;
let currentScreen = 'welcome';
let playerProposals = loadStoredProposals();
let chartInstances = [];
let cleanTechDecisionMade = {};
let submissionErrors = {};
let submissionClampNotes = {};
let proposalSavedAt = {};
let calcSimCleanTech = false;

const content = document.getElementById('content');

/* ── Educator commentary (shown in debrief between regimes) ── */

function educatorCommentary(regime) {
  const commentary = {
    freemarket: `<p><strong>What typically happens in a classroom:</strong> Students almost always trigger catastrophe by round 3 or 4. Every firm produces at maximum capacity because it is individually rational to do so. When asked "Why did everyone produce so much?", students articulate the profit incentive, then realise it leads to collective failure.</p>
<p><strong>The key pedagogic insight:</strong> This is the tragedy of the commons in action. Rational individual behaviour produces a collectively irrational outcome. Many student groups spontaneously propose some form of production limit at this point — which is precisely what the next regime introduces.</p>`,

    cac: `<p><strong>What typically happens in a classroom:</strong> Catastrophe is usually avoided, but students quickly notice the inflexibility. Every firm is capped at the same level regardless of efficiency. Some students complain about being "stuck" — they have capital to spare but cannot use it.</p>
<p><strong>The key pedagogic insight:</strong> Command and control provides quantity certainty (emissions are controlled) but allocates production bluntly: every firm gets the same allowance regardless of how cleanly it can produce. Compare the Total Economic Output and Carbon Budget Used figures here against the later regimes — together they show both how much each approach produced and how much of the safe carbon headroom it consumed. Students often propose allowing firms to differ — "what if more efficient firms could produce more?" — which leads naturally to price-based instruments.</p>`,

    tax: `<p><strong>What typically happens in a classroom:</strong> Clean-tech firms start with less capital because the upfront investment is sunk immediately, leaving them production-constrained in the early rounds. Their higher per-unit margin (lower tax) means cumulative profit eventually overtakes standard firms — watch the capital tracker to see when. Students begin to see that cleaner production requires real upfront investment, and that a carbon tax gives firms a reason to make it.</p>
<p><strong>The key pedagogic insight:</strong> A carbon tax gives price certainty but not quantity certainty — total emissions depend on how firms respond to the price signal. The tax rate may be too low (or too high). Students often ask: "What if we just set a hard limit on total emissions instead?" — which is exactly what permits do.</p>`,

    trade: `<p><strong>What typically happens in a classroom:</strong> Some firms finish with unused permits while others are constrained. Students quickly spot the inefficiency: "I have permits I don't need, and you want more — why can't we trade?"</p>
<p><strong>The key pedagogic insight:</strong> A permit cap controls total emissions with certainty, but without a market mechanism, permits cannot flow to where they are most valued. Motivating participants to propose a trading mechanism is the purpose of this artificial "cap only" regime.</p>`,

    trademarket: `<p><strong>What typically happens in a classroom:</strong> Clean-tech firms have already paid their abatement cost up-front, so that capital is gone — they tend to finish the regime capital-constrained and therefore holding slack permits. Standard firms, with more cash on hand, are the natural buyers. The equilibrium price settles between the sellers' reservation (effectively $0, since unused permits have no value) and the buyers' cap (the gross production value of a permit). Total emissions stay within the cap while economic output rises compared to Cap alone.</p>
<p><strong>The key pedagogic insight:</strong> Cap and trade combines quantity certainty (the hard cap) with economic efficiency (permits flow to whoever can turn them into output). However, it is vulnerable to political capture — if firms can lobby to increase the cap or manipulate the market, the environmental guarantee weakens. This connects to real-world debates about the EU ETS, California's programme, and carbon border adjustments.</p>`,
  };
  return commentary[regime] || '';
}

/* ── Helpers ── */

function buildClampMessage(regime, fd, config, raw, applied) {
  if (raw <= applied) return '';
  const maxAllowed = maxAllowedProduction(fd, config, regime);
  const afford = maxAffordable(fd, config);
  const reasons = [];
  if (afford === maxAllowed) reasons.push('available capital');
  if (regime === 'cac' && config.cacCap === maxAllowed) reasons.push('the per-firm production cap for this round');
  if ((regime === 'trade' || regime === 'trademarket') && maxProductionFromPermits(fd) === maxAllowed) {
    reasons.push('your remaining permit capacity');
  }
  const joint = reasons.length === 0
    ? 'the applicable round limit'
    : (reasons.length === 1 ? reasons[0] : reasons.join(' and '));
  return `You entered ${fmt(raw)}; your submission was recorded as ${fmt(applied)} (limited by ${joint}).`;
}

/* ── Initialise game ── */

function startGame() {
  const config = buildConfig({ numFirms: NUM_FIRMS, numRounds: NUM_ROUNDS });
  state = createInitialState(config);
  state.firms[0].name = 'Your Firm';
  state.firms[1].name = 'Firm B';
  state.firms[2].name = 'Firm C';
  state.firms[3].name = 'Firm D';
  state.firms[4].name = 'Firm E';
  state.regime = 'freemarket';
  state.regimeData.freemarket = initRegimeData(config);
  currentScreen = 'regime';
  playerProposals = {};
  proposalSavedAt = {};
  submissionErrors = {};
  submissionClampNotes = {};
  cleanTechDecisionMade = {};
  calcSimCleanTech = false;
  render();
}

function sessionRegimes() {
  return state ? regimeSequence(state.config) : REGIMES;
}

/* ── Main render ── */

function render() {
  destroyCharts();
  switch (currentScreen) {
    case 'welcome': content.innerHTML = renderWelcome(); break;
    case 'regime': content.innerHTML = renderRegimeScreen(); break;
    case 'debrief': content.innerHTML = renderDebriefScreen(); break;
    case 'results': content.innerHTML = renderResultsScreen(); break;
    default: content.innerHTML = renderWelcome();
  }
  if (currentScreen === 'results') {
    requestAnimationFrame(() => mountResultsCharts());
  }
  renderNav();
  persistGameState();
}

function renderNav() {
  const nav = document.getElementById('regimeNav');
  if (!nav || !state) { if (nav) nav.innerHTML = ''; return; }
  const seq = sessionRegimes();
  nav.innerHTML = `<div class="regime-nav-row">
    ${seq.map((r, idx) => {
      const active = state.regime === r && currentScreen === 'regime';
      const completed = state.completedRegimes.includes(r);
      const debriefing = state.regime === r && currentScreen === 'debrief';
      const reachable = completed || state.regime === r || (state.completedRegimes.includes(seq[idx - 1]) && seq.indexOf(r) <= seq.indexOf(state.regime));
      return `<button class="regime-btn ${active || debriefing ? 'active' : ''} ${completed ? 'completed' : ''} ${!reachable ? 'locked' : ''}"
                      ${!reachable ? 'disabled' : ''} onclick="window.soloApp.viewRegimeTab('${r}')">${idx + 1}. ${REGIME_LABELS[r]}</button>`;
    }).join('')}
    <button class="regime-btn ${currentScreen === 'results' ? 'active' : ''} ${state.completedRegimes.length < seq.length ? 'locked' : ''}"
            ${state.completedRegimes.length < seq.length ? 'disabled' : ''} onclick="window.soloApp.viewResults()">Results</button>
  </div>`;
}

/* ── Welcome screen ── */

function renderWelcome() {
  const resumeButton = hasStoredGameState()
    ? `<button class="btn btn-outline btn-block" onclick="window.soloApp.resumeGame()" style="font-size:1.05rem;padding:0.75rem;margin-bottom:0.6rem;">
        Resume Saved Game
      </button>`
    : '';
  return `
    <div class="card solo-welcome">
      <h2>Solo Play Demo</h2>
      <p style="margin-bottom:1rem;">
        Experience the Carbon Pricing Simulation Game as a single player alongside four computer-controlled firms.
        You will play through five regulatory regimes, each with five rounds, to see how different carbon
        pricing approaches affect emissions and profits.
      </p>
      <div class="info-box accent" style="margin-bottom:1rem;">
        <strong>How it works:</strong> You control <strong>Firm A</strong> (Your Firm). Four computer-controlled firms make
        their own profit-maximising decisions — some are aggressively short-term, others are more strategic.
        Between regimes, educator commentary explains what typically happens in a classroom session.
      </div>
      <div class="info-box" style="background:#fafbfc;border:1px solid var(--border);margin-bottom:1.25rem;font-size:0.88rem;">
        <strong>Game rules:</strong> Each thingamabob costs $1 to produce, sells for $2, and generates
        CO\u2082 emissions. Each round represents your firm\u2019s medium-term production plan. Over five
        rounds, your industry\u2019s cumulative emissions trace a path through the IPCC\u2019s Shared
        Socioeconomic Pathways (SSPs) \u2014 from today\u2019s baseline towards or beyond the Paris
        Agreement limits. If total emissions reach the catastrophe threshold, the climate tipping point
        is breached. Each regime introduces a different approach to managing this tension between profit
        and the environment.
      </div>
      ${resumeButton}
      <button class="btn btn-primary btn-block" onclick="window.soloApp.startGame()" style="font-size:1.05rem;padding:0.75rem;">
        ${resumeButton ? 'Start New Solo Game' : 'Start Solo Game'}
      </button>
    </div>`;
}

/* ── Regime screen (rounds) ── */

function renderRegimeScreen() {
  if (!state) return '';
  const regime = state.regime;
  const d = state.regimeData[regime];
  if (!d) return '';
  const config = state.config;
  const fd = d.firms[PLAYER_FIRM];
  const roundDone = d.currentRound >= config.numRounds;

  let html = '';

  html += `<div class="card">
    <h2>${REGIME_LABELS[regime]}</h2>
    <div class="info-box accent">${regimeDescription(regime, config)}</div>
  </div>`;

  const fnotes = facilitatorNotes(regime);
  if (fnotes) {
    html += `<details class="facilitator-notes">
      <summary>Educator Notes — ${REGIME_LABELS[regime]}</summary>
      <div class="fn-body">
        <p><strong>Timing:</strong> ${fnotes.timing}</p>
        <p><strong>Key points:</strong></p>
        <ul>${fnotes.keyPoints.map(p => `<li>${p}</li>`).join('')}</ul>
        <p><strong>Expected dynamics:</strong></p>
        <ul>${fnotes.expectedDynamics.map(p => `<li>${p}</li>`).join('')}</ul>
      </div>
    </details>`;
  }

  html += renderCO2Meter(d.ppm, config, renderCO2Extra(d.ppm, config));

  const cleanTechPending = regimeUsesCleanTech(regime) && d.currentRound === 0
    && d.rounds.length === 0 && !cleanTechDecisionMade[regime];

  if (regimeUsesCleanTech(regime) && d.currentRound === 0 && d.rounds.length === 0) {
    html += renderCleanTechDecision(regime, d, config);
  }

  if (regimeUsesPermits(regime) && d.currentRound === 0 && d.rounds.length === 0 && !cleanTechPending) {
    html += renderPermitInfo(regime, d, config);
  }

  if (!roundDone && !cleanTechPending) {
    html += renderPlayerInput(regime, d, config);
  }

  if (!cleanTechPending) {
    html += renderCompetitorCard(regime, d, config);
  }

  if (regimeHasPermitMarket(regime) && !roundDone && d.rounds.length > 0) {
    html += renderTradePanel(regime, d, config);
  }

  if (d.rounds.length > 0) {
    html += renderRoundHistory(regime, d, state.firms, state.config, PLAYER_FIRM);
  }

  if (!roundDone && !cleanTechPending) {
    const playerFd = d.firms[PLAYER_FIRM];
    html += renderCalculator(regime, playerFd, config, d);
  }

  if (roundDone) {
    html += `<div class="card text-center">
      <button class="btn btn-primary btn-block" onclick="window.soloApp.goToDebrief()" style="font-size:1rem;padding:0.7rem;">
        View Regime Summary &amp; Debrief &rarr;
      </button>
    </div>`;
  }

  return html;
}

/* ── Clean-tech decision ── */

function renderCleanTechDecision(regime, d, config) {
  const maxSlots = config.maxCleanTech || 2;
  const playerHas = d.firms[PLAYER_FIRM].cleanTech;
  const slotsUsed = d.firms.filter(f => f.cleanTech).length;
  const decided = cleanTechDecisionMade[regime];

  const isTax = regime === 'tax';
  const benefitConfirmed = isTax
    ? `Clean tech halves your emissions and therefore your per-unit tax for all rounds of this regime.`
    : `Clean tech halves your emissions, so each permit covers <strong>2,000</strong> units of production instead of 1,000 for the rest of this regime.`;
  const benefitPre = isTax
    ? `Clean tech halves your emissions per unit and halves your per-unit tax (this is the Carbon Tax regime),`
    : `Clean tech halves your emissions per unit, so each permit covers <strong>2,000</strong> units instead of 1,000 (this is a permit-based regime),`;

  if (decided && playerHas) {
    return `<div class="card" style="border-color:var(--success);">
      <h3>Clean Technology</h3>
      <p style="font-size:0.88rem;">Your firm has invested in <strong>clean technology</strong> this regime (${slotsUsed} of ${maxSlots} slots in use).
        Investment of ${fmtMoney(config.cleanTechCost)} has been deducted from your capital. ${benefitConfirmed}</p>
    </div>`;
  }

  if (decided && !playerHas) {
    return `<div class="card">
      <h3>Clean Technology</h3>
      <p style="font-size:0.88rem;">Your firm is on <strong>standard</strong> technology this regime.
        ${slotsUsed} of ${maxSlots} clean-tech slots are in use by computer-controlled firms.</p>
    </div>`;
  }

  const canAfford = d.firms[PLAYER_FIRM].capital >= config.cleanTechCost;
  return `<div class="card">
    <h3>Clean Technology</h3>
    <p style="font-size:0.88rem;color:var(--text-secondary);margin-bottom:0.6rem;">
      Up to <strong>${maxSlots}</strong> firms may invest in clean technology.
    </p>
    <div class="info-box accent" style="font-size:0.85rem;margin-bottom:0.75rem;">
      <strong>Investment:</strong> ${benefitPre}
      but requires a one-off investment of <strong>${fmtMoney(config.cleanTechCost)}</strong> deducted from your capital immediately.
      Your current capital: <strong>${fmtMoney(d.firms[PLAYER_FIRM].capital)}</strong>.
    </div>
    <div style="display:flex;gap:0.5rem;">
      <button class="btn btn-success" style="flex:1;" onclick="window.soloApp.claimCleanTech('${regime}', true)" ${!canAfford ? 'disabled title="Not enough capital"' : ''}>
        Invest in Clean Tech (${fmtMoney(config.cleanTechCost)})
      </button>
      <button class="btn btn-outline" style="flex:1;" onclick="window.soloApp.claimCleanTech('${regime}', false)">
        Stay Standard
      </button>
    </div>
  </div>`;
}

/* ── Permit info ── */

function renderPermitInfo(regime, d, config) {
  const perFirm = defaultPermitsPerFirm(config);
  return `<div class="card">
    <h3>Permit Allocation</h3>
    <p style="font-size:0.88rem;color:var(--text-secondary);margin-bottom:0.5rem;">
      Each firm receives <strong>${perFirm}</strong> permits.
      Each permit covers ${config.ppmPer1000} ppm CO\u2082 = <strong>1,000</strong> units (standard) or <strong>2,000</strong> units (clean tech).
    </p>
    <table>
      <thead><tr><th>Firm</th><th class="num">Permits</th><th class="num">Units/permit</th><th class="num">Max production</th></tr></thead>
      <tbody>
        ${state.firms.map((f, i) => {
          const fd = d.firms[i];
          const upp = unitsPerPermit(fd);
          return `<tr>
            <td style="color:${firmColor(i)};font-weight:600;">${escHtml(f.name)}${i === PLAYER_FIRM ? ' (You)' : ''}</td>
            <td class="num">${fd.permits}</td>
            <td class="num">${fmt(upp)}</td>
            <td class="num">${fmt(fd.permits * upp)}</td>
          </tr>`;
        }).join('')}
      </tbody>
    </table>
  </div>`;
}

/* ── Player production input ── */

function renderPlayerInput(regime, d, config) {
  const fd = d.firms[PLAYER_FIRM];
  const maxAllowed = maxAllowedProduction(fd, config, regime);
  const isCaC = regimeHasCap(regime);
  const isTrade = regimeUsesPermits(regime);
  const roundKey = `${regime}_${d.currentRound}`;
  const submissionError = submissionErrors[roundKey] || '';
  const lastRoundIdx = d.rounds.length - 1;
  const lastClampKey = `${regime}_${lastRoundIdx}`;
  const lastClampNote = (lastRoundIdx >= 0 && submissionClampNotes[lastClampKey]) ? submissionClampNotes[lastClampKey] : '';

  let constraints = `Available capital: ${fmtMoney(fd.capital)}`;
  if (isCaC) constraints += ` | Production cap: ${fmt(config.cacCap)}`;
  if (isTrade) {
    const pr = permitsRemaining(fd);
    const upp = unitsPerPermit(fd);
    constraints += ` | Permits remaining: ${fmt(pr)} (=${fmt(pr * upp)} units)`;
  }

  return `<div class="submit-section">
    <h3>Round ${d.currentRound + 1} of ${config.numRounds}</h3>
    <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0.4rem;">${constraints}</p>
    <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0.6rem;">
      Maximum you can produce: <strong>${fmt(maxAllowed)}</strong>
    </p>
    <div class="decision-block" style="margin-top:0.75rem;">
      <label for="soloProd" style="font-weight:600;">Your actual production decision:</label>
      <input type="number" id="soloProd" min="0" max="${maxAllowed}" placeholder="Enter units" step="1" inputmode="numeric" pattern="[0-9]*" onkeydown="if(event.key==='Enter')window.soloApp.submitRound('${regime}')">
      ${submissionError ? `<div class="form-error mt-1">${submissionError}</div>` : ''}
      ${lastClampNote ? `<p style="font-size:0.82rem;color:var(--warn);margin-top:0.5rem;">${lastClampNote}</p>` : ''}
      <br>
      <button class="btn btn-success" onclick="window.soloApp.submitRound('${regime}')" style="margin-top:0.5rem;">
        Submit Round ${d.currentRound + 1}
      </button>
    </div>
  </div>`;
}

/* ── Calculator ── */

function renderCleanTechSimToggle(regime, fd) {
  if (!regimeUsesCleanTech(regime)) return '';
  const sim = calcSimCleanTech;
  return `
    <div class="calc-sim-toggle" style="margin-bottom:0.65rem;font-size:0.82rem;">
      <span style="color:var(--text-secondary);display:block;margin-bottom:0.35rem;">Simulate production as:</span>
      <label style="display:inline-flex;align-items:center;margin-right:1rem;cursor:pointer;">
        <input type="radio" name="calcSimClean" ${!sim ? 'checked' : ''} onchange="window.soloApp.setCalcSimCleanTech(false)">
        <span style="margin-left:0.35rem;">Standard</span>
      </label>
      <label style="display:inline-flex;align-items:center;cursor:pointer;">
        <input type="radio" name="calcSimClean" ${sim ? 'checked' : ''} onchange="window.soloApp.setCalcSimCleanTech(true)">
        <span style="margin-left:0.35rem;">Clean tech</span>
      </label>
      ${sim !== fd.cleanTech ? `<div style="margin-top:0.4rem;color:var(--text-secondary);font-style:italic;">Your firm is assigned <strong>${fd.cleanTech ? 'clean tech' : 'standard'}</strong> in this regime; this toggle is for comparison only.</div>` : ''}
    </div>`;
}

function formatRoundProfitLine(regime, config, fd, ri, detail) {
  const rLabel = `Round ${ri + 1}`;
  const { p, cost, revenue, tax, profit } = detail;
  if (p <= 0) {
    return `<p><strong>${rLabel}:</strong> 0 units produced &rarr; ${fmtMoney(0)} profit.</p>`;
  }
  if (regime === 'freemarket' || regime === 'cac') {
    return `<p><strong>${rLabel}:</strong> ${fmt(p)} units &times; ${fmtMoney(config.profitPerUnit)}/unit
      (${fmtMoney(revenue)} revenue &minus; ${fmtMoney(cost)} cost) = <strong>${fmtMoney(profit)}</strong>.</p>`;
  }
  if (regime === 'tax') {
    const rate = fd.cleanTech ? config.taxRate / 2 : config.taxRate;
    const taxBit = `${fmtMoney(tax)} tax (${fmt(p)} &times; ${fmtMoney(rate)}/unit)`;
    return `<p><strong>${rLabel}:</strong> ${fmtMoney(revenue)} revenue &minus; ${fmtMoney(cost)} cost &minus; ${taxBit} = <strong>${fmtMoney(profit)}</strong>.</p>`;
  }
  return `<p><strong>${rLabel}:</strong> ${fmtMoney(revenue)} revenue &minus; ${fmtMoney(cost)} cost = <strong>${fmtMoney(profit)}</strong> (${fmt(p)} units).</p>`;
}

function renderProfitBreakdown(regime, config, fd, d) {
  const rev = fmtMoney(config.revenuePerUnit);
  const cost = fmtMoney(config.costPerUnit);
  const pp = fmtMoney(config.profitPerUnit);
  const tr = fmtMoney(config.taxRate);
  const trHalf = fmtMoney(config.taxRate / 2);

  const rounds = Array.isArray(d.rounds) ? d.rounds : [];
  const roundLines = rounds.map((r, ri) => {
    const p = (r.production && r.production[PLAYER_FIRM]) || 0;
    const detail = roundProfitDetailForFirm(regime, config, fd, p);
    return formatRoundProfitLine(regime, config, fd, ri, detail);
  }).join('');

  let summary = '';
  if (regime === 'freemarket' || regime === 'cac') {
    summary = `<p><strong>Rule:</strong> revenue ${rev} &minus; cost ${cost} = ${pp} profit per unit; round profit = ${pp} &times; units produced.</p>`;
    if (regime === 'cac') summary += `<p><strong>Cap:</strong> at most ${fmt(config.cacCap)} units per round.</p>`;
  } else if (regime === 'tax') {
    summary = `<p><strong>Rule:</strong> standard tax ${tr}/unit; clean tech ${trHalf}/unit.</p>`;
    if (fd.cleanTech && fd.cleanTechInvestment) {
      summary += `<p><strong>Sunk investment (before Round 1):</strong> &minus;${fmtMoney(fd.cleanTechInvestment)} (one-off clean-tech cost).</p>`;
    }
  } else {
    summary = `<p><strong>Rule:</strong> ${rev} &minus; ${cost} = ${pp} per unit. Clean-tech firms produce 2,000 units per permit instead of 1,000.</p>`;
    if (fd.cleanTech && fd.cleanTechInvestment) {
      summary += `<p><strong>Sunk investment (before Round 1):</strong> &minus;${fmtMoney(fd.cleanTechInvestment)} (one-off clean-tech cost).</p>`;
    }
    if (regime === 'trademarket') summary += `<p><strong>Trading:</strong> permit sales/purchases adjust your cash and profit totals.</p>`;
  }

  const actualBlock = rounds.length
    ? `<div class="calc-round-actuals"><strong>Your completed rounds</strong>${roundLines}</div>`
    : `<p><em>No rounds completed yet in this regime.</em></p>`;

  return `
    <details class="facilitator-notes calc-breakdown">
      <summary>How profit is calculated</summary>
      <div class="fn-body">
        ${summary}
        ${actualBlock}
      </div>
    </details>`;
}

function renderPermitValueExplain(config, simClean) {
  const upp = simClean ? 2000 : 1000;
  const gross = upp * config.profitPerUnit;
  return `
    <div class="permit-value-explain info-box accent" style="font-size:0.82rem;margin-top:0.65rem;">
      <strong>How permit value is calculated</strong> (matches the production simulator: ${simClean ? 'clean tech' : 'standard'}):
      each permit covers <strong>${fmt(upp)}</strong> units at ${fmtMoney(config.profitPerUnit)}/unit operating profit
      &rarr; <strong>${fmtMoney(gross)}</strong> gross value from using one permit for production.
      (The clean-tech investment is sunk &mdash; already paid &mdash; so it does not reduce a permit's marginal value.)
      Compare that value to the market price when deciding to buy or sell.
    </div>`;
}

function renderCalculator(regime, fd, config, d) {
  const capLine = `<div class="calc-capital-line" style="font-size:0.85rem;font-weight:600;margin-bottom:0.5rem;">Available capital: ${fmtMoney(fd.capital)}</div>`;
  const simToggle = renderCleanTechSimToggle(regime, fd);
  const breakdown = renderProfitBreakdown(regime, config, fd, d);
  const scratchSubtitle = `<div class="calc-subtitle">Explore scenarios here &mdash; this does not submit anything. Your actual decision goes in the box below.</div>`;

  if (regime === 'freemarket' || regime === 'cac') {
    return `
      <div class="calculator-box">
        <h3><span class="calc-scratch-badge">Scratchpad</span>Profit Calculator</h3>
        ${scratchSubtitle}
        ${capLine}
        <label>Try a quantity:</label>
        <input type="number" id="calcInput" min="0" placeholder="e.g. 500" oninput="window.soloApp.updateCalc('${regime}')" style="width:100%;margin-bottom:0.4rem;" step="1" inputmode="numeric" pattern="[0-9]*">
        <div class="calculator-result" id="calcResult">Enter a number above</div>
        ${breakdown}
      </div>`;
  }

  if (regime === 'tax') {
    const sim = calcSimCleanTech;
    const effectiveRate = sim ? config.taxRate / 2 : config.taxRate;
    const profitPerUnit = config.profitPerUnit - effectiveRate;
    return `
      <div class="calculator-box">
        <h3><span class="calc-scratch-badge">Scratchpad</span>Profit Calculator (after tax)</h3>
        ${scratchSubtitle}
        ${capLine}
        ${simToggle}
        <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.5rem;">
          Tax/unit: ${fmtMoney(effectiveRate)} | Profit/unit: ${fmtMoney(profitPerUnit)}
        </div>
        <label>Try a quantity:</label>
        <input type="number" id="calcInput" min="0" placeholder="e.g. 500" oninput="window.soloApp.updateCalc('${regime}')" style="width:100%;margin-bottom:0.4rem;" step="1" inputmode="numeric" pattern="[0-9]*">
        <div class="calculator-result" id="calcResult">Enter a number above</div>
        ${breakdown}
      </div>`;
  }

  if (regime === 'trade' || regime === 'trademarket') {
    const sim = calcSimCleanTech;
    const upp = sim ? 2000 : 1000;
    return `
      <div class="calculator-box">
        <h3><span class="calc-scratch-badge">Scratchpad</span>Production Calculator</h3>
        ${scratchSubtitle}
        ${capLine}
        ${simToggle}
        <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.5rem;">
          Units/permit: ${fmt(upp)} | Profit/unit: ${fmtMoney(config.profitPerUnit)}
        </div>
        <label>Try a quantity:</label>
        <input type="number" id="calcInput" min="0" placeholder="e.g. 500" oninput="window.soloApp.updateCalc('${regime}')" style="width:100%;margin-bottom:0.4rem;" step="1" inputmode="numeric" pattern="[0-9]*">
        <div class="calculator-result" id="calcResult">Enter a number above</div>
        ${breakdown}
      </div>`;
  }

  return '';
}

/* ── Permit trade panel ── */

function renderTradePanel(regime, d, config) {
  const trades = d.trades || [];
  const playerFd = d.firms[PLAYER_FIRM];
  const playerRemaining = permitsRemaining(playerFd);

  const holdingsRows = state.firms.map((f, i) => {
    const fd = d.firms[i];
    const pr = permitsRemaining(fd);
    const reservation = i !== PLAYER_FIRM ? aiReservationPrice(i, fd, config, regime) : null;
    let marketRole = '\u2014';
    if (i !== PLAYER_FIRM) {
      const afford = maxAffordable(fd, config);
      if (pr > 0 && reservation === 0) {
        marketRole = '<span style="color:var(--success);font-weight:600;">Would sell surplus permits</span>';
      } else if (pr <= 0 && afford > 0) {
        marketRole = `<span style="color:#c0392b;font-weight:600;">Would buy up to ${fmtMoney(reservation)}</span>`;
      } else if (reservation > 0) {
        marketRole = `Will sell at \u2265 ${fmtMoney(reservation)}`;
      } else {
        marketRole = '<span style="color:var(--text-secondary);">No interest</span>';
      }
    }
    return `<tr>
      <td style="color:${firmColor(i)};font-weight:600;">${escHtml(f.name)}${i === PLAYER_FIRM ? ' (You)' : ''}</td>
      <td class="num">${fmt(fd.permits)}</td>
      <td class="num">${fmt(pr)}</td>
      <td class="num">${fmtMoney(fd.capital)}</td>
      <td>${marketRole}</td>
    </tr>`;
  }).join('');

  const aiFirmOptions = state.firms
    .map((f, i) => i !== PLAYER_FIRM ? `<option value="${i}">${escHtml(f.name)}</option>` : '')
    .filter(Boolean).join('');

  const tradeLog = trades.length ? `<div class="trade-log" style="margin-top:0.75rem;">
    <h4 style="font-size:0.88rem;">Trade Log</h4>
    <table><thead><tr><th>#</th><th>Seller</th><th>Buyer</th><th class="num">Qty</th><th class="num">$/permit</th></tr></thead>
    <tbody>${trades.map((t, ti) => `<tr>
      <td>${ti + 1}</td>
      <td style="color:${firmColor(t.seller)};">${escHtml(state.firms[t.seller].name)}</td>
      <td style="color:${firmColor(t.buyer)};">${escHtml(state.firms[t.buyer].name)}</td>
      <td class="num">${fmt(t.quantity)}</td>
      <td class="num">${fmtMoney(t.price)}</td>
    </tr>`).join('')}</tbody></table>
  </div>` : '';

  const playerActualClean = !!playerFd.cleanTech;
  const tradeCalcBlock = `
    <div class="trade-price-calc" style="margin-top:1rem;padding:0.75rem;border:1px dashed #b8c8d4;border-radius:0.5rem;background:#fafbfc;">
      <h3><span class="calc-scratch-badge">Scratchpad</span> Trade-Price Calculator</h3>
      <div class="calc-subtitle" style="margin-bottom:0.5rem;">Try a market price to see whether selling or buying looks attractive for <em>you</em> (${playerActualClean ? 'clean tech' : 'standard'}). Does not submit a trade.</div>
      ${renderPermitValueExplain(config, playerActualClean)}
      <label for="tradeCalcPrice" style="margin-top:0.65rem;display:block;">Price per permit ($):</label>
      <input type="number" id="tradeCalcPrice" min="0" placeholder="e.g. 500" step="1" inputmode="numeric" pattern="[0-9]*" oninput="window.soloApp.updateTradeCalc()" style="width:100%;margin-bottom:0.4rem;">
      <div class="calculator-result" id="tradeCalcResult">Enter a price above</div>
    </div>`;

  return `<div class="card">
    <h3>Permit Market</h3>
    <p style="font-size:0.88rem;color:var(--text-secondary);margin-bottom:0.75rem;">
      Each computer-controlled firm has a <strong>reservation price</strong> &mdash; the minimum they will accept to sell a permit
      (or maximum they will pay to buy one). Propose trades below.
    </p>
    <table>
      <thead><tr><th>Firm</th><th class="num">Held</th><th class="num">Avail</th><th class="num">Capital</th><th>Market Role</th></tr></thead>
      <tbody>${holdingsRows}</tbody>
    </table>

    <div style="margin-top:1rem;padding-top:0.75rem;border-top:1px solid var(--border);">
      <h4 style="font-size:0.88rem;margin-bottom:0.5rem;">Propose a Trade</h4>
      <div class="two-col">
        <div class="form-group">
          <label>Direction</label>
          <select id="tradeDirection">
            <option value="buy">You BUY permits from computer-controlled firm</option>
            <option value="sell">You SELL permits to computer-controlled firm</option>
          </select>
        </div>
        <div class="form-group">
          <label>Computer-Controlled Firm</label>
          <select id="tradePartner">${aiFirmOptions}</select>
        </div>
      </div>
      <div class="two-col">
        <div class="form-group">
          <label>Permits</label>
          <input type="number" id="tradeQty" min="1" value="1" step="1" inputmode="numeric">
        </div>
        <div class="form-group">
          <label>Price per permit ($)</label>
          <input type="number" id="tradePrice" min="0" step="1" value="0" inputmode="numeric">
        </div>
      </div>
      <div id="tradeError" class="form-error hidden" style="margin-bottom:0.5rem;"></div>
      <div id="tradeSuccess" class="info-box success hidden" style="margin-bottom:0.5rem;"></div>
      <button class="btn btn-success" onclick="window.soloApp.proposeTrade('${regime}')">Propose Trade</button>
    </div>
    ${tradeLog}
    ${tradeCalcBlock}
  </div>`;
}

/* ── Round history ── */

function renderCompetitorCard(regime, d, config) {
  const usesPermits = regimeUsesPermits(regime);
  const usesClean = regimeUsesCleanTech(regime);
  const isTrademarket = regime === 'trademarket';
  const lastRound = d.rounds.length > 0 ? d.rounds[d.rounds.length - 1] : null;

  const rows = state.firms.map((firm, i) => {
    if (i === PLAYER_FIRM) return '';
    const fd = d.firms[i];
    const prod = lastRound ? (Number(lastRound.production?.[i]) || 0) : null;
    const profit = lastRound ? (Number(lastRound.profitByFirm?.[i]) || 0) : null;
    const cleanChip = usesClean
      ? `<span class="competitor-chip ${fd.cleanTech ? 'clean' : 'standard'}">${fd.cleanTech ? 'Clean tech' : 'Standard'}</span>`
      : '';

    let permitBit = '';
    if (usesPermits) {
      const pr = permitsRemaining(fd);
      permitBit = `<span class="competitor-stat"><span class="competitor-stat-label">Permits left</span><span class="competitor-stat-value">${fmt(pr)}</span></span>`;
    }

    let roleBit = '';
    if (isTrademarket) {
      const res = aiReservationPrice(i, fd, config, regime);
      const pr = permitsRemaining(fd);
      let role;
      if (pr > 0 && res === 0) role = '<span class="market-role seller">Would sell surplus permits</span>';
      else if (pr <= 0) role = `<span class="market-role buyer">Would buy up to ${fmtMoney(res || config.revenuePerUnit * unitsPerPermit(fd))}</span>`;
      else role = '<span class="market-role neutral">No interest</span>';
      roleBit = `<div class="competitor-role">${role}</div>`;
    }

    const lastLine = lastRound
      ? `<span class="competitor-stat"><span class="competitor-stat-label">Last round</span><span class="competitor-stat-value">${fmt(prod)} units &middot; ${fmtMoney(profit)}</span></span>`
      : `<span class="competitor-stat"><span class="competitor-stat-label">Last round</span><span class="competitor-stat-value" style="color:var(--text-secondary);">Not yet produced</span></span>`;

    return `<div class="competitor-row" style="border-left-color:${firmColor(i)};">
      <div class="competitor-head">
        <span class="competitor-name" style="color:${firmColor(i)};">${escHtml(firm.name)}</span>
        ${cleanChip}
      </div>
      <div class="competitor-stats">
        <span class="competitor-stat"><span class="competitor-stat-label">Capital</span><span class="competitor-stat-value">${fmtMoney(fd.capital)}</span></span>
        ${lastLine}
        ${permitBit}
      </div>
      ${roleBit}
    </div>`;
  }).join('');

  return `<div class="card competitor-card">
    <h3 class="competitor-heading">Competitor Firms</h3>
    <p class="competitor-sub">What the other firms in your industry are doing right now.</p>
    <div class="competitor-grid">${rows}</div>
  </div>`;
}


/* ── Debrief screen ── */

function renderDebriefScreen() {
  if (!state) return '';
  const regime = state.regime;
  const d = state.regimeData[regime];
  if (!d) return '';
  const config = state.config;
  const nextRegime = nextRegimeAfter(config, regime);
  const nextLabel = nextRegime === 'results' ? 'Final Results' : REGIME_LABELS[nextRegime];
  const isLast = nextRegime === 'results';
  const seq = sessionRegimes();
  const isRevisitingCompletedRegime = state.completedRegimes.includes(regime);
  const allRegimesComplete = state.completedRegimes.filter(r => seq.includes(r)).length >= seq.length;

  let html = '';

  const efficiencyAnalog = outputBudgetAnalogy(
    computeTotalEconomicOutput(state, regime),
    computeBudgetUsed(state, regime),
  );
  const commentary = educatorCommentary(regime);
  if (commentary || efficiencyAnalog) {
    const analogSection = efficiencyAnalog
      ? `<div class="efficiency-analogy-box" style="margin-top:1rem;"><p>${efficiencyAnalog}</p></div>`
      : '';
    html += `<details class="facilitator-notes">
      <summary>Educator Commentary &mdash; ${REGIME_LABELS[regime]}</summary>
      <div class="fn-body">${commentary || ''}${analogSection}</div>
    </details>`;
  }

  html += `<div class="card"><h2>Regime Summary: ${REGIME_LABELS[regime]}</h2>`;

  const showTax = regime === 'tax';
  const showPermit = regime === 'trade' || regime === 'trademarket';
  html += `<table>
    <thead><tr><th>Firm</th><th class="num">Produced</th>${showTax ? '<th class="num">Tax Paid</th>' : ''}${showPermit ? '<th class="num">Unused Permits</th>' : ''}<th class="num">Total Profit</th><th class="num">Final Capital</th></tr></thead>
    <tbody>
      ${state.firms.map((f, i) => {
        const fd = d.firms[i];
        return `<tr>
          <td style="color:${firmColor(i)};font-weight:600;">${escHtml(f.name)}${i === PLAYER_FIRM ? ' (You)' : ''}</td>
          <td class="num">${fmt(fd.totalProduced)}</td>
          ${showTax ? `<td class="num">${fmtMoney(totalTaxPaidByFirm(d, i, config))}</td>` : ''}
          ${showPermit ? `<td class="num">${fmt(permitsRemaining(fd))}</td>` : ''}
          <td class="num">${fmtMoney(fd.totalProfit)}</td>
          <td class="num">${fmtMoney(fd.capital)}</td>
        </tr>`;
      }).join('')}
    </tbody>
  </table>`;

  html += `<div class="stat-row"><span class="stat-label">Catastrophe triggered?</span>
    <span class="stat-value">${d.catastrophe ? 'Yes' : 'No'}</span></div>`;

  html += '</div>';

  html += renderCO2Meter(d.ppm, config, renderCO2Extra(d.ppm, config));

  const output = computeTotalEconomicOutput(state, regime);
  const budgetUsed = computeBudgetUsed(state, regime);
  const budgetCellStyle = budgetUsedStyle(budgetUsed);
  html += `<div class="efficiency-box">
    <div class="efficiency-metric">
      <div class="efficiency-label">Total Economic Output</div>
      <div class="efficiency-value">${formatTotalEconomicOutput(output)}</div>
      <div class="efficiency-label">Firm profit + tax revenue</div>
    </div>
    <div class="efficiency-metric"${budgetCellStyle ? ` style="${budgetCellStyle}border-radius:0.5rem;padding:0.5rem;"` : ''}>
      <div class="efficiency-label">% of Safe Carbon Budget Used</div>
      <div class="efficiency-value">${formatBudgetUsed(budgetUsed)}</div>
      <div class="efficiency-label"><i> (treating ${config.triggerPpm} ppm as the "safe" carbon budget)</i></div>
    </div>
  </div>`;

  const prompt = debriefPrompt(regime);
  const existingProposal = playerProposals[regime] || '';
  const savedConfirmation = proposalSavedAt[regime]
    ? `<span class="proposal-save-status" style="margin-left:0.6rem;font-size:0.82rem;color:var(--success,#2e7d32);">Response saved.</span>`
    : '';
  html += `<div class="debrief-student-card">
    <h3>What would you change?</h3>
    <p style="font-size:0.88rem;margin-bottom:0.6rem;">${prompt.question}</p>
    ${prompt.hint ? `<p style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.8rem;font-style:italic;">${prompt.hint}</p>` : ''}
    <textarea id="proposalText" rows="4" placeholder="Type your thoughts here (optional)&hellip;"
              style="width:100%;resize:vertical;font-family:inherit;font-size:0.88rem;padding:0.6rem;border:1px solid var(--border);border-radius:0.5rem;">${escHtml(existingProposal)}</textarea>
    <div style="margin-top:0.5rem;">
      <button class="btn btn-outline" onclick="window.soloApp.saveProposal('${regime}')">Save Response</button>
      <span id="proposalSaveStatus">${savedConfirmation}</span>
    </div>
  </div>`;

  if (isRevisitingCompletedRegime) {
    html += `<div class="card text-center mt-1">
      <button class="btn btn-primary btn-block" onclick="${allRegimesComplete ? 'window.soloApp.viewResults()' : 'window.soloApp.goToNextIncompleteRegime()'}" style="font-size:1rem;padding:0.7rem;">
        ${allRegimesComplete ? 'Return to Results' : 'Return to Next Regime'}
      </button>
    </div>`;
  } else {
    html += `<div class="card text-center mt-1">
      <button class="btn btn-primary btn-block" onclick="window.soloApp.advanceRegime()" style="font-size:1rem;padding:0.7rem;">
        ${isLast ? 'View Final Results' : `Continue to ${nextLabel}`} &rarr;
      </button>
    </div>`;
  }

  return html;
}

/* ── Results screen ── */

function renderResultsScreen() {
  if (!state) return '';
  const seq = sessionRegimes();
  const completed = state.completedRegimes.filter(r => seq.includes(r));

  if (completed.length === 0) {
    return '<div class="card"><h2>Results</h2><p>No regimes completed yet.</p></div>';
  }

  const config = state.config;

  const crossRegimeRows = completed.map(r => {
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
    return `<tr><td style="color:${firmColor(i)};font-weight:600;">${escHtml(f.name)}${i === PLAYER_FIRM ? ' (You)' : ''}</td>${cells}</tr>`;
  }).join('');

  let proposalReview = '';
  const proposalEntries = Object.entries(playerProposals).filter(([_, v]) => v.trim());
  if (proposalEntries.length > 0) {
    proposalReview = `<div class="card">
      <h3>Your Debrief Responses</h3>
      ${proposalEntries.map(([r, text]) => `<div class="proposal-card" style="border-left:3px solid ${firmColor(PLAYER_FIRM)};margin-bottom:0.5rem;">
        <div style="font-weight:600;font-size:0.85rem;">${REGIME_LABELS[r]}</div>
        <div style="font-size:0.88rem;margin-top:0.25rem;">${escHtml(text)}</div>
      </div>`).join('')}
    </div>`;
  }

  let aiReveal = `<details class="card facilitator-notes">
    <summary><strong>Computer-Controlled Firm Strategy Reveal</strong> <span style="color:var(--text-secondary);font-weight:400;">(click to expand)</span></summary>
    <div style="margin-top:0.5rem;">
      <p style="font-size:0.88rem;color:var(--text-secondary);margin-bottom:0.75rem;">
        The four computer-controlled firms were pre-assigned hidden personality types that determined their decision-making:
      </p>
      ${state.firms.filter((_, i) => i !== PLAYER_FIRM).map((f, idx) => {
        const i = idx + 1;
        const p = getPersonality(i);
        const pInfo = PERSONALITIES[p];
        return `<div style="display:flex;gap:0.75rem;align-items:flex-start;margin-bottom:0.75rem;padding:0.65rem;background:#fafbfc;border-radius:0.5rem;border-left:3px solid ${firmColor(i)};">
          <div>
            <div style="font-weight:600;color:${firmColor(i)};">${escHtml(f.name)}</div>
            <div style="font-size:0.82rem;margin-top:0.15rem;"><strong>${pInfo.label}</strong></div>
            <div style="font-size:0.82rem;color:var(--text-secondary);margin-top:0.25rem;">${pInfo.description}</div>
          </div>
        </div>`;
      }).join('')}
    </div>
  </details>`;

  const kuznetsHtml = `<div class="kuznets-reflection">
    <h3>What did we produce?</h3>
    <p>Across all of these regimes, your industry produced thingamabobs. In a real economy, some of that output would be essential goods people depend on &mdash; healthcare, food, housing, sanitation &mdash; while others would be luxuries, planned-obsolescence electronics, or positional consumption that adds little to anyone's wellbeing.</p>
    <p>The Total Economic Output figure above does not distinguish between these. Should it?</p>
  </div>`;

  const discussionHtml = renderDiscussionCard(config);

  return `
    <div class="card">
      <h2>Cross-Regime Comparison</h2>
      <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>Regime</th><th class="num">Total Prod.</th><th class="num">Final ppm</th><th class="num">Catastrophe?</th><th class="num">Total Economic Output</th><th class="num">Budget Used</th></tr></thead>
        <tbody>${crossRegimeRows}</tbody>
      </table>
      </div>
      <p style="font-size:0.8rem;color:var(--text-secondary);margin-top:0.5rem;">Total Economic Output = firm profit + tax revenue collected by government. Budget Used = ppm added as a percentage of the safe carbon budget; values above 100% indicate overshoot of the catastrophe trigger.</p>
    </div>

    <div class="card">
      <h3>Profit by Firm Across Regimes</h3>
      <div style="overflow-x:auto;">
      <table>
        <thead><tr><th>Firm</th>${completed.map(r => `<th class="num">${REGIME_LABELS[r]}</th>`).join('')}</tr></thead>
        <tbody>${firmCompRows}</tbody>
      </table>
      </div>
    </div>

    <div class="card chart-card">
      <h2>Charts</h2>
      <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0.75rem;">
        CO\u2082 concentration and profit comparison across all completed regimes.
      </p>
      <div class="chart-wrap">
        <canvas id="chartPpmByRound"></canvas>
      </div>
      <div class="chart-wrap" style="margin-top:1.25rem;">
        <canvas id="chartProfitByFirm"></canvas>
      </div>
    </div>

    ${proposalReview}
    ${kuznetsHtml}
    ${discussionHtml}
    ${renderDiscussionFacilitatorHints('Educator')}
    ${renderComparisonTable(completed, REGIME_LABELS)}

    <div class="card text-center">
      <button class="btn btn-primary" onclick="window.soloApp.playAgain()">Play Again</button>
    </div>

    ${aiReveal}`;
}

/* ── Charts ── */

function destroyCharts() {
  chartInstances.forEach(ch => { try { ch.destroy(); } catch (_) {} });
  chartInstances = [];
}

function mountResultsCharts() {
  if (typeof Chart === 'undefined') {
    document.querySelectorAll('.chart-wrap').forEach(el => {
      el.innerHTML = '<div class="info-box warn">Charts could not be loaded. Check your internet connection.</div>';
    });
    return;
  }
  if (!state) return;
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
    chartInstances.push(new Chart(elPpm, {
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
        scales: { y: { title: { display: true, text: 'ppm' } } },
      },
    }));
  }

  const firmLabels = state.firms.map((f, i) => i === PLAYER_FIRM ? `${f.name} (You)` : f.name);
  const profitDatasets = completed.map(r => ({
    label: REGIME_LABELS[r],
    data: state.firms.map((_, i) => state.regimeData[r].firms[i].totalProfit),
    backgroundColor: CHART_REGIME_COLORS[r] || '#888',
  }));

  const elBar = document.getElementById('chartProfitByFirm');
  if (elBar) {
    chartInstances.push(new Chart(elBar, {
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
          x: { title: { display: true, text: 'Firm' } },
          y: { title: { display: true, text: 'Profit ($)' } },
        },
      },
    }));
  }
}

/* ── Actions (exposed on window) ── */

window.soloApp = {
  startGame() {
    startGame();
  },

  resumeGame() {
    if (!restoreStoredGameState()) {
      alert('No saved solo game could be restored.');
      return;
    }
    render();
    window.scrollTo(0, 0);
  },

  claimCleanTech(regime, claim) {
    if (!state) return;
    const d = state.regimeData[regime];

    const aiClaims = aiCleanTechDecisions(state.config, regime, d, PLAYER_FIRM);
    for (const i of aiClaims) {
      setCleanTech(state, regime, i);
    }

    if (claim) {
      const result = setCleanTech(state, regime, PLAYER_FIRM);
      if (result.error) {
        alert(result.error);
        return;
      }
    }

    cleanTechDecisionMade[regime] = true;
    calcSimCleanTech = !!d.firms[PLAYER_FIRM].cleanTech;

    if (regimeUsesPermits(regime)) {
      const perFirm = defaultPermitsPerFirm(state.config);
      d.firms.forEach(fd => { if (fd.permits === 0) fd.permits = perFirm; });
    }

    render();
  },

  submitRound(regime) {
    if (!state) return;
    const d = state.regimeData[regime];
    const config = state.config;
    const input = document.getElementById('soloProd');
    if (!input) return;
    const roundKey = `${regime}_${d.currentRound}`;

    if (input.value.trim() === '') {
      submissionErrors[roundKey] = 'Please enter a production decision before submitting.';
      render();
      return;
    }
    const parsed = parseInt(input.value, 10);
    if (isNaN(parsed) || parsed < 0) {
      submissionErrors[roundKey] = 'Enter a whole non-negative number.';
      render();
      return;
    }
    delete submissionErrors[roundKey];

    const fd = d.firms[PLAYER_FIRM];
    const maxAllowed = maxAllowedProduction(fd, config, regime);
    const raw = parsed;
    const playerProd = Math.min(raw, maxAllowed);

    const clampNote = buildClampMessage(regime, fd, config, raw, playerProd);
    if (clampNote) submissionClampNotes[roundKey] = clampNote;
    else delete submissionClampNotes[roundKey];

    const production = [playerProd];
    for (let i = 1; i < config.numFirms; i++) {
      production.push(aiProductionDecision(i, d.firms[i], config, regime, d));
    }

    processRound(state, regime, production);

    if (regime === 'trademarket') {
      executeAiTrades(state, regime, PLAYER_FIRM);
    }

    render();
  },

  proposeTrade(regime) {
    if (!state) return;
    const d = state.regimeData[regime];
    const config = state.config;
    const errEl = document.getElementById('tradeError');
    const successEl = document.getElementById('tradeSuccess');
    if (errEl) { errEl.classList.add('hidden'); errEl.textContent = ''; }
    if (successEl) { successEl.classList.add('hidden'); successEl.textContent = ''; }

    const direction = document.getElementById('tradeDirection')?.value;
    const partner = parseInt(document.getElementById('tradePartner')?.value, 10);
    const qty = parseInt(document.getElementById('tradeQty')?.value, 10);
    const price = parseFloat(document.getElementById('tradePrice')?.value);

    if (isNaN(partner) || isNaN(qty) || qty <= 0 || isNaN(price) || price < 0) {
      if (errEl) { errEl.textContent = 'Please fill in all trade fields with valid values.'; errEl.classList.remove('hidden'); }
      return;
    }

    const partnerFd = d.firms[partner];
    const aiRole = direction === 'buy' ? 'sell' : 'buy';
    const evaluation = aiEvaluateTrade(partner, partnerFd, config, regime, aiRole, qty, price);

    if (!evaluation.accept) {
      if (errEl) { errEl.textContent = `Trade rejected: ${evaluation.reason}`; errEl.classList.remove('hidden'); }
      return;
    }

    const seller = direction === 'buy' ? partner : PLAYER_FIRM;
    const buyer = direction === 'buy' ? PLAYER_FIRM : partner;
    const result = processPermitTrade(state, regime, seller, buyer, qty, price);

    if (result.error) {
      if (errEl) { errEl.textContent = result.error; errEl.classList.remove('hidden'); }
      return;
    }

    if (successEl) {
      const verb = direction === 'buy' ? 'Bought' : 'Sold';
      successEl.textContent = `${verb} ${qty} permit(s) at $${price} each with ${state.firms[partner].name}.`;
      successEl.classList.remove('hidden');
    }
    render();
  },

  setCalcSimCleanTech(simClean) {
    calcSimCleanTech = !!simClean;
    render();
  },

  updateCalc(regime) {
    const input = document.getElementById('calcInput');
    const result = document.getElementById('calcResult');
    if (!input || !result || !state) return;
    const qty = parseInt(input.value) || 0;
    if (qty <= 0) { result.textContent = 'Enter a number above'; return; }

    const config = state.config;
    const fd = state.regimeData[regime].firms[PLAYER_FIRM];
    const usesClean = regimeUsesCleanTech(regime);
    const simFd = usesClean ? { ...fd, cleanTech: calcSimCleanTech, cleanTechInvestment: calcSimCleanTech ? (fd.cleanTechInvestment || config.cleanTechCost) : 0 } : fd;
    const detail = roundProfitDetailForFirm(regime, config, simFd, qty);
    const ppmAdded = (qty / 1000) * (simFd.cleanTech ? config.ppmPer1000 / 2 : config.ppmPer1000);

    const simNote = (usesClean && calcSimCleanTech !== !!fd.cleanTech)
      ? ` <span style="color:var(--text-secondary);font-style:italic;">(simulating ${calcSimCleanTech ? 'clean tech' : 'standard'})</span>`
      : '';

    result.innerHTML = `Profit: <strong>${fmtMoney(detail.profit)}</strong> | CO\u2082: +${fmt(ppmAdded)} ppm${detail.tax > 0 ? ` | Tax: ${fmtMoney(detail.tax)}` : ''}${simNote}`;
  },

  updateTradeCalc() {
    const input = document.getElementById('tradeCalcPrice');
    const result = document.getElementById('tradeCalcResult');
    if (!input || !result || !state) return;
    const price = parseFloat(input.value) || 0;
    const regime = state.regime;
    const config = state.config;
    const fd = state.regimeData[regime].firms[PLAYER_FIRM];
    const actualClean = !!fd.cleanTech;
    const upp = actualClean ? 2000 : 1000;
    const permitValue = upp * config.profitPerUnit;
    const cannotAffordProduction = maxAffordable(fd, config) === 0;

    if (price <= 0) { result.textContent = 'Enter a price above'; return; }

    const gainFromSelling = price - permitValue;
    const gainFromBuying = permitValue - price;

    let capitalNote = '';
    if (cannotAffordProduction) {
      capitalNote = `<p style="font-size:0.82rem;color:var(--text-secondary);margin:0.4rem 0;">
        You cannot afford production at ${fmtMoney(config.costPerUnit)}/unit with your current capital, so using the permit for output is not an option right now.
        Selling still brings in <strong>${fmtMoney(price)}</strong> in cash (the sale price).
      </p>`;
    }

    result.innerHTML = `
      Permit value (production basis, your assignment): <strong>${fmtMoney(permitValue)}</strong>
      (${fmt(upp)} units &times; ${fmtMoney(config.profitPerUnit)}/unit).
      ${capitalNote}
      <p>If you <strong>sell</strong> at ${fmtMoney(price)} vs that production baseline: ${gainFromSelling >= 0 ? 'gain' : 'loss'} of <strong>${fmtMoney(Math.abs(gainFromSelling))}</strong>.</p>
      <p>If you <strong>buy</strong> at ${fmtMoney(price)}: ${gainFromBuying >= 0 ? 'gain' : 'loss'} of <strong>${fmtMoney(Math.abs(gainFromBuying))}</strong> vs that baseline.</p>
    `;
  },

  goToDebrief() {
    currentScreen = 'debrief';
    render();
    window.scrollTo(0, 0);
  },

  saveProposal(regime) {
    const textarea = document.getElementById('proposalText');
    if (!textarea) return;
    playerProposals[regime] = textarea.value.trim();
    persistProposals();
    proposalSavedAt[regime] = true;
    persistGameState();
    const status = document.getElementById('proposalSaveStatus');
    if (status) {
      status.innerHTML = `<span class="proposal-save-status" style="margin-left:0.6rem;font-size:0.82rem;color:var(--success,#2e7d32);">Response saved.</span>`;
    }
  },

  advanceRegime() {
    if (!state) return;
    const regime = state.regime;

    const textarea = document.getElementById('proposalText');
    if (textarea) {
      playerProposals[regime] = textarea.value.trim();
      persistProposals();
    }

    completeRegime(state, regime);
    const next = nextRegimeAfter(state.config, regime);

    if (next === 'results') {
      state.regime = 'results';
      currentScreen = 'results';
    } else {
      state.regime = next;
      const d = state.regimeData[next];
      calcSimCleanTech = !!d.firms[PLAYER_FIRM].cleanTech;

      if (regimeUsesCleanTech(next)) {
        currentScreen = 'regime';
      } else {
        if (regimeUsesPermits(next)) {
          const perFirm = defaultPermitsPerFirm(state.config);
          d.firms.forEach(fd => { if (fd.permits === 0) fd.permits = perFirm; });
        }
        currentScreen = 'regime';
      }
    }

    render();
    window.scrollTo(0, 0);
  },

  viewRegimeTab(regime) {
    if (!state) return;
    if (!state.completedRegimes.includes(regime) && state.regime !== regime) return;
    state.regime = regime;
    const d = state.regimeData[regime];
    if (d && d.currentRound >= state.config.numRounds) {
      currentScreen = 'debrief';
    } else {
      currentScreen = 'regime';
    }
    render();
  },

  viewResults() {
    if (!state) return;
    currentScreen = 'results';
    render();
  },

  goToNextIncompleteRegime() {
    if (!state) return;
    const next = sessionRegimes().find(r => !state.completedRegimes.includes(r));
    if (!next) {
      currentScreen = 'results';
      render();
      return;
    }
    state.regime = next;
    if (!state.regimeData[next]) state.regimeData[next] = initRegimeData(state.config);
    currentScreen = 'regime';
    render();
    window.scrollTo(0, 0);
  },

  playAgain() {
    state = null;
    currentScreen = 'welcome';
    playerProposals = {};
    proposalSavedAt = {};
    submissionErrors = {};
    submissionClampNotes = {};
    cleanTechDecisionMade = {};
    try { localStorage.removeItem(PROPOSALS_STORAGE_KEY); } catch { /* noop */ }
    try { localStorage.removeItem(GAME_STORAGE_KEY); } catch { /* noop */ }
    render();
  },
};

/* ── Bootstrap ── */

render();
