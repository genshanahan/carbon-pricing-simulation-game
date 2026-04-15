/**
 * Play (Student) App — mobile-first view for student firms.
 */

import {
  REGIMES, REGIME_LABELS, buildConfig, maxAllowedProduction, unitsPerPermit,
  permitsRemaining, normalizeStateFromRemote,
} from './game-engine.js';
import { onStateChange, submitDecision, registerStudent } from './firebase-sync.js';
import { fmt, fmtMoney, renderCO2Meter, firmColor, cleanBadge, regimeUsesCleanTech, regimeUsesTax, regimeUsesPermits, regimeHasCap, regimeHasPermitMarket, regimeDescription } from './ui-helpers.js';

/* ── Globals ── */

const params = new URLSearchParams(window.location.search);
const ROOM = params.get('room');
const FIRM_ID = parseInt(params.get('firm'), 10);
if (!ROOM || isNaN(FIRM_ID)) { window.location.href = 'index.html'; }

let state = null;
let hasSubmitted = {};

const content = document.getElementById('content');
const firmNameEl = document.getElementById('firmNameHeader');

/* ── Init ── */

async function init() {
  await registerStudent(ROOM, FIRM_ID);

  onStateChange(ROOM, newState => {
    state = normalizeStateFromRemote(newState);
    if (!state) {
      content.innerHTML = `<div class="card"><h2>Room not found</h2><p>No game state for this room. <a href="index.html">Return to join page</a></p></div>`;
      return;
    }
    state.config = buildConfig(state.config);
    const rd = state.regimeData[state.regime];
    console.log(`[STUDENT] onStateChange: regime=${state.regime}, currentRound=${rd ? rd.currentRound : 'N/A'}`);
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
      if (REGIMES.includes(state.regime)) content.innerHTML = renderRegime(state.regime);
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
      ${usesClean ? `<div>${cleanBadge(fd)}</div>` : ''}
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

  html += renderCO2Meter(d.ppm, config);

  if (isTrade) {
    const pr = permitsRemaining(fd);
    const upp = unitsPerPermit(fd);
    html += `
      <div class="card">
        <h3>Your Permits</h3>
        <div class="stat-row"><span class="stat-label">Permits held</span><span class="stat-value">${fmt(fd.permits)}</span></div>
        <div class="stat-row"><span class="stat-label">Permits remaining</span><span class="stat-value">${fmt(pr)}</span></div>
        <div class="stat-row"><span class="stat-label">Units per permit</span><span class="stat-value">${fmt(upp)}</span></div>
        <div class="stat-row"><span class="stat-label">Max production from permits</span><span class="stat-value">${fmt(pr * upp)}</span></div>
      </div>`;
  }

  html += renderCalculator(regime, fd, config);

  if (!roundDone) {
    const roundKey = `${regime}_${d.currentRound}`;
    const alreadySubmitted = hasSubmitted[roundKey];
    const maxAllowed = maxAllowedProduction(fd, config, regime);

    if (alreadySubmitted) {
      html += `
        <div class="submit-section" style="border-color:var(--success);">
          <h3 style="color:var(--success);">Decision submitted!</h3>
          <p style="font-size:0.88rem;color:var(--text-secondary);">
            You submitted <strong>${fmt(alreadySubmitted)}</strong> thingamabobs for Round ${d.currentRound + 1}.
            Waiting for the facilitator to process…
          </p>
        </div>`;
    } else {
      html += `
        <div class="submit-section">
          <h3>Round ${d.currentRound + 1} of ${config.numRounds}</h3>
          <p style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0.6rem;">
            How many thingamabobs will you produce?
            ${isCaC ? `(Cap: ${fmt(config.cacCap)})` : ''}
            (Max: ${fmt(maxAllowed)})
          </p>
          <input type="number" id="studentProd" min="0" max="${maxAllowed}" value="0">
          <br>
          <button class="btn btn-success" onclick="window.playApp.submitProd('${regime}', ${d.currentRound}, ${maxAllowed})">
            Submit Decision
          </button>
        </div>`;
    }
  } else {
    html += renderFirmSummary(regime, d, fd);
  }

  if (d.rounds.length > 0) {
    html += renderMyHistory(d);
  }

  return html;
}

/* ── Calculator ── */

function renderCalculator(regime, fd, config) {
  if (regime === 'freemarket' || regime === 'cac') {
    return `
      <div class="calculator-box">
        <h3>Profit Calculator</h3>
        <label>Planned production:</label>
        <input type="number" id="calcInput" min="0" value="0" oninput="window.playApp.updateCalc('${regime}')" style="width:100%;margin-bottom:0.4rem;">
        <div class="calculator-result" id="calcResult">Enter a number above</div>
      </div>`;
  }

  if (regime === 'tax') {
    const effectiveRate = fd.cleanTech ? config.taxRate / 2 : config.taxRate;
    const profitPerUnit = config.profitPerUnit - effectiveRate;
    const setupPerRound = fd.cleanTech ? config.cleanTechCost : 0;

    return `
      <div class="calculator-box">
        <h3>Profit Calculator (after tax)</h3>
        <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.5rem;">
          Tax/unit: ${fmtMoney(effectiveRate)} | Profit/unit: ${fmtMoney(profitPerUnit)}
          ${fd.cleanTech ? ` | Setup: ${fmtMoney(setupPerRound)}/round` : ''}
        </div>
        <label>Planned production:</label>
        <input type="number" id="calcInput" min="0" value="0" oninput="window.playApp.updateCalc('${regime}')" style="width:100%;margin-bottom:0.4rem;">
        <div class="calculator-result" id="calcResult">Enter a number above</div>
      </div>`;
  }

  if (regime === 'trade' || regime === 'trademarket') {
    const setupPerRound = fd.cleanTech ? config.cleanTechCost : 0;
    const upp = unitsPerPermit(fd);

    let tradeCalc = '';
    if (regime === 'trademarket') {
      tradeCalc = `
        <div style="margin-top:0.75rem;padding-top:0.75rem;border-top:1px solid #d4e6f1;">
          <h3 style="font-size:0.88rem;">Trade Calculator</h3>
          <label>Price per permit ($):</label>
          <input type="number" id="tradeCalcPrice" min="0" value="0" oninput="window.playApp.updateTradeCalc()" style="width:100%;margin-bottom:0.4rem;">
          <div class="calculator-result" id="tradeCalcResult">Enter a price above</div>
        </div>`;
    }

    return `
      <div class="calculator-box">
        <h3>Production Calculator</h3>
        <div style="font-size:0.82rem;color:var(--text-secondary);margin-bottom:0.5rem;">
          Units/permit: ${fmt(upp)} | Profit/unit: ${fmtMoney(config.profitPerUnit)}
          ${fd.cleanTech ? ` | Setup: ${fmtMoney(setupPerRound)}/round` : ''}
        </div>
        <label>Planned production:</label>
        <input type="number" id="calcInput" min="0" value="0" oninput="window.playApp.updateCalc('${regime}')" style="width:100%;margin-bottom:0.4rem;">
        <div class="calculator-result" id="calcResult">Enter a number above</div>
        ${tradeCalc}
      </div>`;
  }

  return '';
}

/* ── Firm summary at end of regime ── */

function renderFirmSummary(regime, d, fd) {
  return `
    <div class="card" style="border-color:${firmColor(FIRM_ID)};">
      <h3>Your Results: ${REGIME_LABELS[regime]}</h3>
      <div class="stat-row"><span class="stat-label">Total produced</span><span class="stat-value">${fmt(fd.totalProduced)}</span></div>
      <div class="stat-row"><span class="stat-label">Total profit</span><span class="stat-value">${fmtMoney(fd.totalProfit)}</span></div>
      <div class="stat-row"><span class="stat-label">Final capital</span><span class="stat-value">${fmtMoney(fd.capital)}</span></div>
      <div class="stat-row"><span class="stat-label">Catastrophe?</span><span class="stat-value">${d.catastrophe ? '\ud83d\udca5 YES' : '\u2705 No'}</span></div>
    </div>`;
}

/* ── Student's own production history ── */

function renderMyHistory(d) {
  const rows = d.rounds.map((r, ri) => `
    <tr>
      <td>R${ri + 1}</td>
      <td class="num">${fmt(r.production[FIRM_ID])}</td>
      <td class="num">${fmt(r.totalProduction)}</td>
      <td class="num">${fmt(r.ppmAfter)}</td>
    </tr>`).join('');

  return `
    <div class="card">
      <h3>Round History</h3>
      <table>
        <thead><tr><th></th><th class="num">Your prod.</th><th class="num">Industry total</th><th class="num">CO\u2082</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/* ── Results view ── */

function renderResults() {
  const completed = (state.completedRegimes || []).filter(r => REGIMES.includes(r));
  if (completed.length === 0) return '<div class="card"><h2>Results</h2><p>No regimes completed yet.</p></div>';

  const fd = completed.map(r => state.regimeData[r].firms[FIRM_ID]);
  const rows = completed.map((r, ri) => `
    <tr>
      <td><strong>${REGIME_LABELS[r]}</strong></td>
      <td class="num">${fmt(fd[ri].totalProduced)}</td>
      <td class="num">${fmtMoney(fd[ri].totalProfit)}</td>
      <td class="num">${fmtMoney(fd[ri].capital)}</td>
      <td class="num">${state.regimeData[r].catastrophe ? '\ud83d\udca5' : '\u2705'}</td>
    </tr>`).join('');

  return `
    <div class="card">
      <h2>Your Results: ${state.firms[FIRM_ID].name}</h2>
      <table>
        <thead><tr><th>Regime</th><th class="num">Produced</th><th class="num">Profit</th><th class="num">Capital</th><th class="num">Safe?</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>
    <div class="card">
      <h3>Comparison Table</h3>
      <p style="font-size:0.85rem;color:var(--text-secondary);">
        Discuss with your team and fill in the projected comparison table.
      </p>
      <table style="font-size:0.82rem;">
        <thead><tr><th></th>${completed.map(r => `<th>${REGIME_LABELS[r]}</th>`).join('')}</tr></thead>
        <tbody>
          <tr><td><strong>Material viability</strong></td>${completed.map(() => '<td></td>').join('')}</tr>
          <tr><td><strong>Normative desirability</strong></td>${completed.map(() => '<td></td>').join('')}</tr>
          <tr><td><strong>Political feasibility</strong></td>${completed.map(() => '<td></td>').join('')}</tr>
        </tbody>
      </table>
    </div>`;
}

/* ── Interactive calculator logic ── */

window.playApp = {
  updateCalc(regime) {
    const input = document.getElementById('calcInput');
    const result = document.getElementById('calcResult');
    if (!input || !result || !state) return;
    const qty = parseInt(input.value) || 0;
    const config = state.config;
    const fd = state.regimeData[regime].firms[FIRM_ID];

    if (qty <= 0) { result.textContent = 'Enter a number above'; return; }

    const cost = qty * config.costPerUnit;
    const revenue = qty * config.revenuePerUnit;
    let tax = 0, setup = 0;

    if (regimeUsesTax(regime)) {
      const rate = fd.cleanTech ? config.taxRate / 2 : config.taxRate;
      tax = qty * rate;
    }
    if (regimeUsesCleanTech(regime) && fd.cleanTech) {
      setup = config.cleanTechCost;
    }

    const profit = revenue - cost - tax - setup;
    const ppmAdded = (qty / 1000) * (fd.cleanTech ? config.ppmPer1000 / 2 : config.ppmPer1000);

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
    const upp = unitsPerPermit(fd);
    const setup = fd.cleanTech ? config.cleanTechCost : 0;
    const permitValue = (upp * config.profitPerUnit) - setup;

    if (price <= 0) { result.textContent = 'Enter a price above'; return; }

    const gainFromSelling = price - permitValue;
    const gainFromBuying = permitValue - price;

    result.innerHTML = `
      Permit value to you: <strong>${fmtMoney(permitValue)}</strong><br>
      If you <strong>sell</strong> at ${fmtMoney(price)}: ${gainFromSelling >= 0 ? 'gain' : 'loss'} of <strong>${fmtMoney(Math.abs(gainFromSelling))}</strong><br>
      If you <strong>buy</strong> at ${fmtMoney(price)}: ${gainFromBuying >= 0 ? 'gain' : 'loss'} of <strong>${fmtMoney(Math.abs(gainFromBuying))}</strong>
    `;
  },

  async submitProd(regime, round, maxAllowed) {
    const input = document.getElementById('studentProd');
    if (!input) return;
    let qty = parseInt(input.value) || 0;
    if (qty < 0) qty = 0;
    if (qty > maxAllowed) qty = maxAllowed;

    console.log(`[STUDENT] submitProd: writing to ${regime}_${round}/${FIRM_ID}, qty=${qty}`);
    try {
      await submitDecision(ROOM, regime, round, FIRM_ID, qty);
      console.log(`[STUDENT] submitProd: write succeeded`);
      hasSubmitted[`${regime}_${round}`] = qty;
      render();
    } catch (e) {
      console.error(`[STUDENT] submitProd: write FAILED`, e);
      alert('Could not submit. Check your connection.\n\n' + e.message);
    }
  },
};

/* ── Bootstrap ── */

init();
