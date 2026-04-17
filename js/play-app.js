/**
 * Play (Student) App — mobile-first view for student firms.
 */

import {
  REGIMES, REGIME_LABELS, buildConfig, regimeSequence, maxAllowedProduction, unitsPerPermit,
  permitsRemaining, normalizeStateFromRemote, maxAffordable, maxProductionFromPermits,
  totalTaxPaidByFirm, roundProfitDetailForFirm, computeTotalEconomicOutput, computeBudgetUsed,
} from './game-engine.js';
import {
  onStateChange, submitDecision, registerStudent, submitProposal, claimCleanTech, onCleanTechClaims,
} from './firebase-sync.js';
import {
  fmt, fmtMoney, renderCO2Meter, firmColor, cleanBadge, regimeUsesCleanTech, regimeUsesTax,
  regimeUsesPermits, regimeHasCap, regimeHasPermitMarket, regimeDescription, debriefPrompt,
  outputBudgetAnalogy, formatTotalEconomicOutput, formatBudgetUsed, budgetUsedStyle,
  renderRoundHistory, renderCO2Extra, renderDiscussionCard, renderComparisonTable,
} from './ui-helpers.js';

/* ── Globals ── */

const params = new URLSearchParams(window.location.search);
const ROOM = params.get('room');
const FIRM_ID = parseInt(params.get('firm'), 10);
if (!ROOM || isNaN(FIRM_ID)) { window.location.href = 'index.html'; }

let state = null;
let hasSubmitted = {};
let submissionClampNotes = {};
let hasProposed = {};
let submissionErrors = {};
let submissionRecentlySaved = {};

/** RTDB `cleantech/{regime}` snapshot (students listen here; host also mirrors into `state`). */
const cleantechRemoteByRegime = {};
let cleantechStudentUnsub = null;
let cleantechStudentKey = null;

function getCleantechClaims(regime) {
  return cleantechRemoteByRegime[regime] || {};
}

function firmCleanTechEffective(regime, fd) {
  const c = getCleantechClaims(regime);
  return !!(fd.cleanTech || c[String(FIRM_ID)]);
}

function slotsUsedWithClaims(d, regime) {
  const c = getCleantechClaims(regime);
  let u = 0;
  for (let i = 0; i < d.firms.length; i++) {
    if (d.firms[i].cleanTech || c[String(i)]) u++;
  }
  return u;
}

function syncCleanTechStudentListener() {
  if (!state) {
    if (cleantechStudentUnsub) {
      cleantechStudentUnsub();
      cleantechStudentUnsub = null;
    }
    cleantechStudentKey = null;
    return;
  }
  const r = state.regime;
  const d = state.regimeData[r];
  const want = activeRegimes().includes(r) && regimeUsesCleanTech(r) && d
    && d.currentRound === 0 && d.rounds.length === 0;
  const key = want ? r : null;
  if (key === cleantechStudentKey && cleantechStudentUnsub) return;
  if (cleantechStudentUnsub) {
    cleantechStudentUnsub();
    cleantechStudentUnsub = null;
  }
  cleantechStudentKey = key;
  if (!want) return;
  cleantechStudentUnsub = onCleanTechClaims(ROOM, r, claims => {
    console.log(`[STUDENT] onCleanTechClaims for ${r}:`, JSON.stringify(claims));
    cleantechRemoteByRegime[r] = claims && typeof claims === 'object' ? claims : {};
    render();
  });
}

/** Simulated clean-tech for calculator only (not actual firm state). */
let calcSimCleanTech = false;
let calcSimContextKey = null;

function ensureCalcSim(regime, fd, round) {
  const key = `${regime}_${round}`;
  if (calcSimContextKey !== key) {
    calcSimContextKey = key;
    calcSimCleanTech = !!fd.cleanTech;
  }
}

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

function parseWholeNumber(raw) {
  if (raw == null) return null;
  const text = String(raw).trim();
  if (!/^\d+$/.test(text)) return null;
  return parseInt(text, 10);
}

/** Student self-claim for clean tech (first-come; host mirrors via Firebase). */
function renderCleanTechClaimCard(regime, d, fd, config) {
  if (!regimeUsesCleanTech(regime) || d.currentRound !== 0 || d.rounds.length > 0) return '';
  const maxSlots = config.maxCleanTech ?? 3;
  const slotsUsed = slotsUsedWithClaims(d, regime);
  if (fd.cleanTech) {
    return `
      <div class="card" style="border-color:var(--success);">
        <h3>Clean technology</h3>
        <p style="font-size:0.88rem;color:var(--text-secondary);">
          Your firm has <strong>clean technology</strong> this regime (${slotsUsed} of ${maxSlots} slots in use).
        </p>
      </div>`;
  }
  if (slotsUsed >= maxSlots) {
    return `
      <div class="card">
        <h3>Clean technology</h3>
        <p style="font-size:0.88rem;color:var(--text-secondary);">
          All <strong>${maxSlots}</strong> clean-tech slots are taken. You are on <strong>standard</strong> technology for this regime.
        </p>
      </div>`;
  }
  const canAfford = fd.capital >= config.cleanTechCost;
  return `
    <div class="card">
      <h3>Clean technology</h3>
      <p style="font-size:0.88rem;color:var(--text-secondary);margin-bottom:0.6rem;">
        <strong>${slotsUsed}</strong> of <strong>${maxSlots}</strong> firms have clean tech (halves emissions per unit; requires a one-off investment of ${fmtMoney(config.cleanTechCost)} from your capital).
        ${canAfford
          ? `Your capital after investing: <strong>${fmtMoney(fd.capital - config.cleanTechCost)}</strong>.`
          : `<span style="color:#c0392b;">You cannot afford the ${fmtMoney(config.cleanTechCost)} investment (capital: ${fmtMoney(fd.capital)}).</span>`}
      </p>
      <button type="button" class="btn btn-primary btn-block" onclick="window.playApp.tryClaimCleanTech('${regime}')" ${!canAfford ? 'disabled' : ''}>
        Invest in clean technology (${fmtMoney(config.cleanTechCost)})
      </button>
    </div>`;
}

const content = document.getElementById('content');
const firmNameEl = document.getElementById('firmNameHeader');

function activeRegimes() {
  return state ? regimeSequence(state.config) : REGIMES;
}

/* ── Init ── */

async function init() {
  await registerStudent(ROOM, FIRM_ID);

  onStateChange(ROOM, newState => {
    state = normalizeStateFromRemote(newState);
    if (!state) {
      syncCleanTechStudentListener();
      content.innerHTML = `<div class="card"><h2>Room not found</h2><p>No game state for this room. <a href="index.html">Return to join page</a></p></div>`;
      return;
    }
    state.config = buildConfig(state.config);
    const rd = state.regimeData[state.regime];
    console.log(`[STUDENT] onStateChange: regime=${state.regime}, currentRound=${rd ? rd.currentRound : 'N/A'}`);
    syncCleanTechStudentListener();
    render();
  });
}

/* ── Render ── */

function render() {
  if (!state) {
    content.innerHTML = '<div class="waiting-indicator"><div class="spinner"></div><p>Connecting to game…</p></div>';
    return;
  }

  const firm = state.firms[FIRM_ID];
  if (firmNameEl) firmNameEl.textContent = firm ? firm.name : `Firm ${FIRM_ID + 1}`;

  switch (state.regime) {
    case 'setup': content.innerHTML = renderWaiting('The facilitator is setting up the game. Please wait…'); break;
    case 'results': content.innerHTML = renderResults(); break;
    default:
      if (activeRegimes().includes(state.regime)) content.innerHTML = renderRegime(state.regime);
      else content.innerHTML = renderWaiting('Waiting for the facilitator…');
  }
}

function renderWaiting(msg) {
  return `<div class="waiting-indicator"><div class="spinner"></div><p>${msg}</p></div>`;
}

/* ── Regime view ── */

function renderRegime(regime) {
  const d = state.regimeData[regime];
  if (!d) return renderWaiting('Loading regime data…');
  const config = state.config;
  const fd = d.firms[FIRM_ID];
  const fdEff = { ...fd, cleanTech: firmCleanTechEffective(regime, fd) };
  const firm = state.firms[FIRM_ID];
  const roundDone = d.currentRound >= config.numRounds;
  const usesClean = regimeUsesCleanTech(regime);
  const isTax = regimeUsesTax(regime);
  const isTrade = regimeUsesPermits(regime);
  const isCaC = regimeHasCap(regime);

  let html = '';

  html += `
    <div class="student-firm-header" style="border-color:${firmColor(FIRM_ID)};">
      <div class="firm-name-large" style="color:${firmColor(FIRM_ID)};">${firm.name}</div>
      ${usesClean ? `<div>${cleanBadge(fdEff)}</div>` : ''}
      <div class="firm-capital">${fmtMoney(fd.capital)}</div>
      <div style="font-size:0.82rem;color:var(--text-secondary);">Available capital</div>
    </div>
  `;

  html += `
    <div class="card">
      <h3>${REGIME_LABELS[regime]}</h3>
      <div class="info-box accent" style="font-size:0.85rem;">${regimeDescription(regime, config)}</div>
    </div>
  `;

  if (!roundDone) {
    html += renderCO2Meter(d.ppm, config, renderCO2Extra(d.ppm, config));
  }

  if (isTrade) {
    const pr = permitsRemaining(fdEff);
    const upp = unitsPerPermit(fdEff);
    html += `
      <div class="card">
        <h3>Your Permits</h3>
        <div class="stat-row"><span class="stat-label">Permits held</span><span class="stat-value">${fmt(fd.permits)}</span></div>
        <div class="stat-row"><span class="stat-label">Permits remaining</span><span class="stat-value">${fmt(pr)}</span></div>
        <div class="stat-row"><span class="stat-label">Units per permit</span><span class="stat-value">${fmt(upp)}</span></div>
        <div class="stat-row"><span class="stat-label">Max production from permits</span><span class="stat-value">${fmt(pr * upp)}</span></div>
      </div>`;
  }

  if (!roundDone) {
    ensureCalcSim(regime, fdEff, d.currentRound);
    html += renderCleanTechClaimCard(regime, d, fdEff, config);
    html += renderCalculator(regime, fdEff, config, d);
  }

  if (!roundDone) {
    const roundKey = `${regime}_${d.currentRound}`;
    const alreadySubmitted = hasSubmitted[roundKey];
    const maxAllowed = maxAllowedProduction(fdEff, config, regime);
    const clampNote = submissionClampNotes[roundKey] || '';
    const submissionError = submissionErrors[roundKey] || '';
    const animateClass = submissionRecentlySaved[roundKey] ? ' submission-confirmed' : '';

    if (alreadySubmitted) {
      html += `
        <div class="submit-section${animateClass}" style="border-color:var(--success);">
          <h3 style="color:var(--success);">Decision submitted!</h3>
          <p style="font-size:0.88rem;color:var(--text-secondary);">
            You submitted <strong>${fmt(alreadySubmitted)}</strong> thingamabobs for Round ${d.currentRound + 1}.
            Waiting for the facilitator to process…
          </p>
          ${clampNote ? `<p style="font-size:0.82rem;color:var(--warn);margin-top:0.5rem;">${clampNote}</p>` : ''}
        </div>`;
    } else {
      html += `
        <div class="submit-section">
          <h3>Your production decision &mdash; Round ${d.currentRound + 1} of ${config.numRounds}</h3>
          <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0.6rem;">
            How many thingamabobs will you produce this round?
            ${isCaC ? `(Cap: ${fmt(config.cacCap)})` : ''}
            (Max: ${fmt(maxAllowed)})
          </p>
          <input type="number" id="studentProd" min="0" max="${maxAllowed}" placeholder="Enter units" step="1" inputmode="numeric" pattern="[0-9]*" onkeydown="if(event.key==='Enter')window.playApp.submitProd('${regime}',${d.currentRound},${maxAllowed})">
          ${submissionError ? `<div class="form-error mt-1">${submissionError}</div>` : ''}
          <br>
          <button class="btn btn-success" onclick="window.playApp.submitProd('${regime}', ${d.currentRound}, ${maxAllowed})">
            Submit Decision
          </button>
        </div>`;
    }
  } else {
    if (d.debriefActive) {
      html += renderFirmSummary(regime, d, fd);
      html += renderDebriefPrompt(regime, d);
    } else {
      html += `<div class="card" style="text-align:center;color:var(--text-secondary);">
        <p>All ${config.numRounds} rounds complete. Waiting for the facilitator to begin the debrief&hellip;</p>
      </div>`;
    }
  }

  if (d.rounds.length > 0) {
    html += renderRoundHistory(regime, d, state.firms, state.config, FIRM_ID);
  }

  return html;
}

/* ── Calculator ── */

function renderCleanTechSimToggle(regime, fd) {
  if (!regimeUsesCleanTech(regime)) return '';
  const sim = calcSimCleanTech;
  return `
    <div class="calc-sim-toggle" style="margin-bottom:0.65rem;font-size:0.82rem;">
      <span style="color:var(--text-secondary);display:block;margin-bottom:0.35rem;">Simulate production as:</span>
      <label style="display:inline-flex;align-items:center;margin-right:1rem;cursor:pointer;">
        <input type="radio" name="calcSimClean" ${!sim ? 'checked' : ''} onchange="window.playApp.setCalcSimCleanTech(false)">
        <span style="margin-left:0.35rem;">Standard</span>
      </label>
      <label style="display:inline-flex;align-items:center;cursor:pointer;">
        <input type="radio" name="calcSimClean" ${sim ? 'checked' : ''} onchange="window.playApp.setCalcSimCleanTech(true)">
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
  /* trade / trademarket */
  return `<p><strong>${rLabel}:</strong> ${fmtMoney(revenue)} revenue &minus; ${fmtMoney(cost)} cost = <strong>${fmtMoney(profit)}</strong> (${fmt(p)} units).</p>`;
}

function renderProfitBreakdown(regime, config, fd, d) {
  const rev = fmtMoney(config.revenuePerUnit);
  const cost = fmtMoney(config.costPerUnit);
  const pp = fmtMoney(config.profitPerUnit);
  const tr = fmtMoney(config.taxRate);
  const trHalf = fmtMoney(config.taxRate / 2);
  const setupM = fmtMoney(config.cleanTechCost);

  const rounds = Array.isArray(d.rounds) ? d.rounds : [];
  const roundLines = rounds.map((r, ri) => {
    const p = (r.production && r.production[FIRM_ID]) || 0;
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
        <input type="number" id="calcInput" min="0" placeholder="e.g. 500" oninput="window.playApp.updateCalc('${regime}')" style="width:100%;margin-bottom:0.4rem;" step="1" inputmode="numeric" pattern="[0-9]*">
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
        <input type="number" id="calcInput" min="0" placeholder="e.g. 500" oninput="window.playApp.updateCalc('${regime}')" style="width:100%;margin-bottom:0.4rem;" step="1" inputmode="numeric" pattern="[0-9]*">
        <div class="calculator-result" id="calcResult">Enter a number above</div>
        ${breakdown}
      </div>`;
  }

  if (regime === 'trade' || regime === 'trademarket') {
    const sim = calcSimCleanTech;
    const upp = sim ? 2000 : 1000;

    let tradeCalc = '';
    if (regime === 'trademarket') {
      tradeCalc = `
        ${renderPermitValueExplain(config, calcSimCleanTech)}
        <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid #d4e6f1;">
          <h3 style="font-size:0.88rem;">Trade Calculator</h3>
          <p style="font-size:0.78rem;color:var(--text-secondary);margin-bottom:0.45rem;">
            Uses your <strong>assigned</strong> clean-tech status (${fd.cleanTech ? 'clean tech' : 'standard'}), not the simulator toggle above.
          </p>
          <label>Price per permit ($):</label>
          <input type="number" id="tradeCalcPrice" min="0" value="0" oninput="window.playApp.updateTradeCalc()" style="width:100%;margin-bottom:0.4rem;" step="1" inputmode="numeric" pattern="[0-9]*">
          <div class="calculator-result" id="tradeCalcResult">Enter a price above</div>
        </div>`;
    }

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
        <input type="number" id="calcInput" min="0" placeholder="e.g. 500" oninput="window.playApp.updateCalc('${regime}')" style="width:100%;margin-bottom:0.4rem;" step="1" inputmode="numeric" pattern="[0-9]*">
        <div class="calculator-result" id="calcResult">Enter a number above</div>
        ${tradeCalc}
        ${breakdown}
      </div>`;
  }

  return '';
}

/* ── Debrief proposal prompt ── */

function renderDebriefPrompt(regime, d) {
  if (!d.debriefActive) {
    return `
      <div class="card" style="text-align:center;color:var(--text-secondary);">
        <p>Regime complete. Waiting for the facilitator to begin the debrief…</p>
      </div>`;
  }

  const prompt = debriefPrompt(regime);
  const alreadyProposed = hasProposed[regime];

  if (alreadyProposed) {
    return `
      <div class="debrief-student-card" style="border-color:var(--success);">
        <h3 style="color:var(--success);">Proposal submitted!</h3>
        <p style="font-size:0.88rem;color:var(--text-secondary);">
          Waiting for the facilitator to reveal the next approach…
        </p>
      </div>`;
  }

  return `
    <div class="debrief-student-card">
      <h3>What would you change?</h3>
      <p style="font-size:0.88rem;margin-bottom:0.6rem;">${prompt.question}</p>
      ${prompt.hint ? `<p style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.8rem;font-style:italic;">${prompt.hint}</p>` : ''}
      <textarea id="proposalText" rows="4" placeholder="Discuss with your team, then type your proposal here…"
                style="width:100%;resize:vertical;"></textarea>
      <button class="btn btn-success mt-1" onclick="window.playApp.submitProposal('${regime}')">
        Submit Proposal
      </button>
    </div>`;
}

/* ── Firm summary at end of regime ── */

function renderFirmSummary(regime, d, fd) {
  const config = state.config;
  let extraRows = '';
  if (regime === 'tax') {
    const taxPaid = totalTaxPaidByFirm(d, FIRM_ID, config);
    extraRows += `<div class="stat-row"><span class="stat-label">Total carbon tax paid</span><span class="stat-value">${fmtMoney(taxPaid)}</span></div>`;
  }
  if (regime === 'trade' || regime === 'trademarket') {
    const unused = permitsRemaining(fd);
    extraRows += `<div class="stat-row"><span class="stat-label">Unused permits at end</span><span class="stat-value">${fmt(unused)}</span></div>`;
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
  return `
    <div class="card" style="border-color:${firmColor(FIRM_ID)};">
      <h3>Your Results: ${REGIME_LABELS[regime]}</h3>
      <div class="stat-row"><span class="stat-label">Total produced</span><span class="stat-value">${fmt(fd.totalProduced)}</span></div>
      <div class="stat-row"><span class="stat-label">Total profit</span><span class="stat-value">${fmtMoney(fd.totalProfit)}</span></div>
      <div class="stat-row"><span class="stat-label">Final capital</span><span class="stat-value">${fmtMoney(fd.capital)}</span></div>
      ${extraRows}
      <div class="stat-row"><span class="stat-label">Catastrophe?</span><span class="stat-value">${d.catastrophe ? 'Yes' : 'No'}</span></div>
    </div>
    ${renderCO2Meter(d.ppm, config, renderCO2Extra(d.ppm, config))}
    ${efficiencyHtml}`;
}

/* ── Results view ── */

function renderResults() {
  const completed = (state.completedRegimes || []).filter(r => activeRegimes().includes(r));
  if (completed.length === 0) return '<div class="card"><h2>Results</h2><p>No regimes completed yet.</p></div>';

  const fd = completed.map(r => state.regimeData[r].firms[FIRM_ID]);
  const rows = completed.map((r, ri) => `
    <tr>
      <td><strong>${REGIME_LABELS[r]}</strong></td>
      <td class="num">${fmt(fd[ri].totalProduced)}</td>
      <td class="num">${fmtMoney(fd[ri].totalProfit)}</td>
      <td class="num">${fmtMoney(fd[ri].capital)}</td>
      <td class="num">${state.regimeData[r].catastrophe ? 'Yes' : 'No'}</td>
    </tr>`).join('');

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

  return `
    <div class="card">
      <h2>Your Results: ${state.firms[FIRM_ID].name}</h2>
      <table>
        <thead><tr><th>Regime</th><th class="num">Produced</th><th class="num">Profit</th><th class="num">Capital</th><th class="num">Safe?</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
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
    <div class="kuznets-reflection">
      <h3>What did we produce?</h3>
      <p>Across all of these regimes, your industry produced thingamabobs. In a real economy, some of that output would be essential goods people depend on &mdash; healthcare, food, housing, sanitation &mdash; while others would be luxuries, planned-obsolescence electronics, or positional consumption that adds little to anyone's wellbeing.</p>
      <p>The Total Economic Output figure above does not distinguish between these. Should it?</p>
    </div>
    ${renderDiscussionCard(state.config)}
    ${renderComparisonTable(completed, REGIME_LABELS)}`;
}

/* ── Interactive calculator logic ── */

window.playApp = {
  setCalcSimCleanTech(val) {
    calcSimCleanTech = !!val;
    if (!state || !activeRegimes().includes(state.regime)) return;
    render();
    const regime = state.regime;
    const inp = document.getElementById('calcInput');
    if (inp && inp.value) window.playApp.updateCalc(regime);
    if (regime === 'trademarket') {
      const tcp = document.getElementById('tradeCalcPrice');
      if (tcp && tcp.value) window.playApp.updateTradeCalc();
    }
  },

  updateCalc(regime) {
    const input = document.getElementById('calcInput');
    const result = document.getElementById('calcResult');
    if (!input || !result || !state) return;
    const qty = parseInt(input.value) || 0;
    const config = state.config;
    const fd = state.regimeData[regime].firms[FIRM_ID];
    const simClean = regimeUsesCleanTech(regime) && calcSimCleanTech;

    if (qty <= 0) { result.textContent = 'Enter a number above'; return; }

    const cost = qty * config.costPerUnit;
    const revenue = qty * config.revenuePerUnit;
    let tax = 0;

    if (regimeUsesTax(regime)) {
      const rate = simClean ? config.taxRate / 2 : config.taxRate;
      tax = qty * rate;
    }

    const profit = revenue - cost - tax;
    const ppmAdded = (qty / 1000) * (simClean ? config.ppmPer1000 / 2 : config.ppmPer1000);

    result.innerHTML = `
      Profit: <strong>${fmtMoney(profit)}</strong> &nbsp;|&nbsp;
      CO\u2082: +${fmt(ppmAdded)} ppm
      ${tax > 0 ? `&nbsp;|&nbsp; Tax: ${fmtMoney(tax)}` : ''}
    `;
  },

  updateTradeCalc() {
    const input = document.getElementById('tradeCalcPrice');
    const result = document.getElementById('tradeCalcResult');
    if (!input || !result || !state) return;
    const price = parseFloat(input.value) || 0;
    const regime = state.regime;
    const config = state.config;
    const fd = state.regimeData[regime].firms[FIRM_ID];
    const actualClean = firmCleanTechEffective(regime, fd);
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

  async tryClaimCleanTech(regime) {
    if (!state) return;
    const maxSlots = Math.max(1, Math.min(100, Number(state.config.maxCleanTech) || 3));
    try {
      console.log(`[STUDENT] tryClaimCleanTech: calling claimCleanTech(${ROOM}, ${regime}, ${FIRM_ID}, ${maxSlots})`);
      const { ok } = await claimCleanTech(ROOM, regime, FIRM_ID, maxSlots);
      console.log(`[STUDENT] tryClaimCleanTech: result ok=${ok}`);
      if (!ok) {
        alert('All clean-tech slots are full. Another firm may have claimed just before you.');
      } else {
        const k = String(FIRM_ID);
        cleantechRemoteByRegime[regime] = { ...getCleantechClaims(regime), [k]: true };
        const fd = state.regimeData[regime].firms[FIRM_ID];
        if (!fd.cleanTech) {
          fd.cleanTech = true;
          fd.cleanTechInvestment = state.config.cleanTechCost;
          fd.capital -= state.config.cleanTechCost;
          fd.totalProfit -= state.config.cleanTechCost;
        }
        render();
      }
    } catch (e) {
      console.error('[STUDENT] claimCleanTech failed', e);
      alert('Could not claim clean tech. Check your connection.\n\n' + (e.message || String(e)));
    }
  },

  async submitProposal(regime) {
    const textarea = document.getElementById('proposalText');
    if (!textarea) return;
    const text = textarea.value.trim();
    if (!text) { alert('Please enter your proposal before submitting.'); return; }

    try {
      await submitProposal(ROOM, regime, FIRM_ID, text);
      hasProposed[regime] = true;
      render();
    } catch (e) {
      console.error('[STUDENT] submitProposal failed', e);
      alert('Could not submit proposal. Check your connection.\n\n' + e.message);
    }
  },

  async submitProd(regime, round, maxAllowed) {
    const input = document.getElementById('studentProd');
    if (!input || !state) return;
    const roundKey = `${regime}_${round}`;
    if (input.value.trim() === '') {
      submissionErrors[roundKey] = 'Please enter a production decision before submitting. Typing 0 is allowed.';
      render();
      return;
    }
    const parsed = parseWholeNumber(input.value);
    if (parsed == null) {
      submissionErrors[roundKey] = 'Enter a whole non-negative number.';
      render();
      return;
    }
    const raw = Math.max(0, parsed);
    delete submissionErrors[roundKey];
    let qty = raw;
    if (qty > maxAllowed) qty = maxAllowed;
    const rawFd = state.regimeData[regime].firms[FIRM_ID];
    const fd = { ...rawFd, cleanTech: firmCleanTechEffective(regime, rawFd) };
    const note = buildClampMessage(regime, fd, state.config, raw, qty);
    if (note) submissionClampNotes[roundKey] = note;
    else delete submissionClampNotes[roundKey];

    console.log(`[STUDENT] submitProd: writing to ${regime}_${round}/${FIRM_ID}, qty=${qty}`);
    try {
      await submitDecision(ROOM, regime, round, FIRM_ID, qty);
      console.log(`[STUDENT] submitProd: write succeeded`);
      hasSubmitted[roundKey] = qty;
      submissionRecentlySaved[roundKey] = true;
      render();
      setTimeout(() => {
        delete submissionRecentlySaved[roundKey];
        if (state && state.regime === regime) render();
      }, 1200);
    } catch (e) {
      console.error(`[STUDENT] submitProd: write FAILED`, e);
      alert('Could not submit. Check your connection.\n\n' + e.message);
    }
  },
};

/* ── Bootstrap ── */

init();
