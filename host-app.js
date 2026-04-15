/**
 * Host (Facilitator) App — drives game state, renders the projected view.
 */

import {
  buildConfig, createInitialState, initRegimeData, REGIMES, REGIME_LABELS,
  REGIME_NAV_LABELS, processRound, processPermitTrade, completeRegime,
  computeDeadweightLoss, undoLastRound, defaultPermitsPerFirm,
  maxAllowedProduction, maxAffordable, unitsPerPermit, permitsRemaining,
  maxProductionFromPermits, normalizeStateFromRemote,
} from './game-engine.js';

import {
  pushState, onStateChange, onSubmissions, clearSubmissions,
  onStudentConnections, deleteRoom,
} from './firebase-sync.js';

import {
  fmt, fmtMoney, renderCO2Meter, firmColor, cleanBadge,
  regimeUsesCleanTech, regimeUsesTax, regimeUsesPermits, regimeHasCap,
  regimeHasPermitMarket, qrCodeUrl, regimeDescription,
} from './ui-helpers.js';

/* ── Globals ── */

const params = new URLSearchParams(window.location.search);
const ROOM = params.get('room');
if (!ROOM) { window.location.href = 'index.html'; }

let state = null;
let studentConnections = {};
let currentSubmissions = {};
let submissionUnsub = null;
let submissionKey = null;  // tracks which regime_round the listener is bound to

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
      renderNav();
      /* Re-bind after every state push (e.g. processed round): `currentRound` moves
         but submission listener was only set on tab change — otherwise the host
         stays subscribed to the previous round's Firebase path. */
      listenForSubmissions();
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
  navEl.innerHTML = `
    <button class="regime-btn ${state.regime === 'setup' ? 'active' : ''} ${state.completedRegimes.includes('setup') ? 'completed' : ''}"
            onclick="window.hostApp.switchRegime('setup')">Setup</button>
    ${REGIMES.map(r => {
      const visible = state.completedRegimes.includes(getPrevRegime(r)) || state.regime === r || state.completedRegimes.includes(r);
      const active = state.regime === r;
      const completed = state.completedRegimes.includes(r);
      return `<button class="regime-btn ${active ? 'active' : ''} ${completed ? 'completed' : ''} ${!visible ? 'locked' : ''}"
                      onclick="window.hostApp.switchRegime('${r}')"
                      ${!visible ? 'disabled' : ''}>${REGIME_NAV_LABELS[r]}</button>`;
    }).join('')}
    <button class="regime-btn ${state.regime === 'results' ? 'active' : ''}"
            onclick="window.hostApp.switchRegime('results')">Results</button>
  `;
}

function getPrevRegime(regime) {
  const idx = REGIMES.indexOf(regime);
  if (idx <= 0) return 'setup';
  return REGIMES[idx - 1];
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
    state.regime = regime;
    if (REGIMES.includes(regime) && !state.regimeData[regime]) {
      state.regimeData[regime] = initRegimeData(state.config);
    }
    listenForSubmissions();
    sync();
  },

  setFirmName(i, name) {
    state.firms[i].name = name;
    sync();
  },

  setCleanTech(regime, i, val) {
    state.regimeData[regime].firms[i].cleanTech = val;
    sync();
  },

  setPermits(regime, i, val) {
    state.regimeData[regime].firms[i].permits = parseInt(val) || 0;
    sync();
  },

  async submitRound(regime) {
    const production = [];
    for (let i = 0; i < state.config.numFirms; i++) {
      const el = document.getElementById(`prod-${regime}-${i}`);
      const fromSubmission = currentSubmissions[i];
      let val = el ? parseInt(el.value) || 0 : (fromSubmission ? fromSubmission.quantity : 0);
      production.push(val);
    }
    const prevRound = state.regimeData[regime].currentRound;
    processRound(state, regime, production);
    const newRound = state.regimeData[regime].currentRound;
    console.log(`[HOST] submitRound: processed ${regime} round ${prevRound} → now ${newRound}`);
    await clearSubmissions(ROOM, regime, prevRound);
    console.log(`[HOST] submitRound: cleared submissions for ${regime}_${prevRound}`);
    currentSubmissions = {};
    submissionKey = null;
    sync();
    console.log(`[HOST] submitRound: synced, submissionKey reset — listenForSubmissions will rebind on next onStateChange`);
  },

  completeAndAdvance(regime, next) {
    completeRegime(state, regime);
    state.regime = next;
    if (REGIMES.includes(next) && !state.regimeData[next]) {
      state.regimeData[next] = initRegimeData(state.config);
    }
    listenForSubmissions();
    sync();
  },

  recordTrade(regime) {
    const seller = parseInt(document.getElementById('tm-seller').value);
    const buyer = parseInt(document.getElementById('tm-buyer').value);
    const qty = parseInt(document.getElementById('tm-qty').value) || 0;
    const price = parseFloat(document.getElementById('tm-price').value) || 0;
    const result = processPermitTrade(state, regime, seller, buyer, qty, price);
    if (result.error) { alert(result.error); return; }
    sync();
  },

  undoRound(regime) {
    if (confirm('Undo the last round? This cannot be re-done.')) {
      undoLastRound(state, regime);
      sync();
    }
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

/* ── Submission listener ── */

function listenForSubmissions() {
  if (!state || !REGIMES.includes(state.regime)) {
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

/* ── Main render ── */

function render() {
  if (!state) { content.innerHTML = '<div class="card"><p>Loading…</p></div>'; return; }

  switch (state.regime) {
    case 'setup': content.innerHTML = renderSetup(); break;
    case 'results': content.innerHTML = renderResults(); break;
    default:
      if (REGIMES.includes(state.regime)) {
        content.innerHTML = renderRegime(state.regime);
      } else {
        content.innerHTML = `<div class="card"><h2>Unrecognised game state</h2><p>Regime is <code>${String(state.regime)}</code>. Try resetting the game or creating a new room.</p><button class="btn btn-primary" onclick="window.hostApp.resetGame()">Reset Game</button></div>`;
      }
  }
}

/* ── Setup ── */

function renderSetup() {
  const joinUrl = new URL('index.html', window.location.href);
  joinUrl.searchParams.set('room', ROOM);

  const nameInputs = state.firms.map((f, i) => `
    <div class="prod-input-card">
      <div class="firm-name" style="color:${firmColor(i)}">Firm ${i + 1}</div>
      <input type="text" value="${f.name}"
             onchange="window.hostApp.setFirmName(${i}, this.value)" placeholder="Firm name">
    </div>`).join('');

  return `
    <div class="card room-hero">
      <div style="font-size:0.85rem;color:var(--text-secondary);margin-bottom:0.25rem;">Room Code</div>
      <div class="room-code">${ROOM}</div>
      <img class="qr-img" src="${qrCodeUrl(joinUrl.toString())}" alt="QR code to join" width="200" height="200">
      <div class="join-url">${joinUrl.toString()}</div>
    </div>

    <div class="card">
      <h2>Game Setup</h2>
      <div class="info-box accent">
        <strong>Carbon Pricing Simulation Game</strong> &mdash; ${state.config.numFirms} firms compete across
        five regulatory regimes. Each thingamabob costs ${fmtMoney(state.config.costPerUnit)},
        sells for ${fmtMoney(state.config.revenuePerUnit)}, and adds ${state.config.ppmPer1000} ppm
        CO\u2082 per 1,000 produced. Starting capital: ${fmtMoney(state.config.startCapital)}.
        Starting CO\u2082: ${state.config.startPpm} ppm. Catastrophe at ${state.config.triggerPpm} ppm.
      </div>
      <h3>Name the Firms</h3>
      <div class="prod-grid">${nameInputs}</div>
      <div class="mt-1">
        <button class="btn btn-primary btn-block" onclick="window.hostApp.switchRegime('freemarket')">
          Begin Round 1: Free Market &rarr;
        </button>
      </div>
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

  const nextMap = {
    freemarket: ['cac', 'Command & Control'],
    cac: ['tax', 'Carbon Tax'],
    tax: ['trade', 'Cap'],
    trade: ['trademarket', 'Cap & Trade'],
    trademarket: ['results', 'Results'],
  };
  const [nextRegime, nextLabel] = nextMap[regime] || ['results', 'Results'];

  let html = `
    <div class="card">
      <h2>${REGIME_LABELS[regime]}</h2>
      <div class="info-box accent">${regimeDescription(regime, config)}</div>
    </div>
    ${renderCO2Meter(d.ppm, config, isTax ? `<div style="margin-top:0.4rem;font-size:0.85rem;">Tax revenue: <strong>${fmtMoney(d.totalTaxRevenue)}</strong></div>` : '')}
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
    html += renderRoundHistory(regime, d);
    if (d.rounds.length > 0 && !roundDone) {
      html += `<div class="card text-center">
        <button class="btn btn-outline btn-sm" onclick="window.hostApp.undoRound('${regime}')">
          Undo Last Round
        </button>
      </div>`;
    }
  }

  if (roundDone) {
    html += renderRegimeSummary(regime, d, config, nextRegime, nextLabel);
  }

  return html;
}

/* ── Clean tech assignment ── */

function renderCleanTechAssignment(regime, d) {
  return `
    <div class="card">
      <h3>Clean Technology Assignment</h3>
      <p style="font-size:0.88rem;color:var(--text-secondary);margin-bottom:0.6rem;">
        Select which firms have access to clean production technology (halves emissions per unit,
        costs ${fmtMoney(state.config.cleanTechCost)} setup per round).
      </p>
      <div class="prod-grid">
        ${state.firms.map((f, i) => {
          const fd = d.firms[i];
          return `<div class="prod-input-card">
            <div class="firm-name" style="color:${firmColor(i)}">${f.name}</div>
            <label><input type="checkbox" ${fd.cleanTech ? 'checked' : ''}
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
                   onchange="window.hostApp.setPermits('${regime}', ${i}, this.value)">
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
        <div class="form-group"><label>Permits traded</label><input type="number" id="tm-qty" min="1" value="1"></div>
        <div class="form-group"><label>Price per permit ($)</label><input type="number" id="tm-price" min="0" step="1" value="150"></div>
      </div>
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

/* ── Production input ── */

function renderProductionInput(regime, d, config) {
  const isCaC = regimeHasCap(regime);
  const isTax = regimeUsesTax(regime);
  const isTrade = regimeUsesPermits(regime);
  const usesClean = regimeUsesCleanTech(regime);
  const roundNum = d.currentRound + 1;
  const totalSubmitted = Object.keys(currentSubmissions).length;

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
          const maxAllowed = maxAllowedProduction(fd, config, regime);
          const sub = currentSubmissions[i];
          const prefilledVal = sub ? sub.quantity : 0;
          const techBadge = usesClean ? cleanBadge(fd) : '';
          let extraInfo = `Capital: ${fmtMoney(fd.capital)}`;
          if (isCaC) extraInfo += ` | Cap: ${fmt(config.cacCap)}`;
          if (isTrade) {
            const pr = permitsRemaining(fd);
            const upp = unitsPerPermit(fd);
            extraInfo += ` | Permits: ${fmt(pr)} (=${fmt(pr * upp)} units)`;
          }

          return `<div class="prod-input-card" style="${sub ? 'border-color:var(--success);' : ''}">
            <div class="firm-name" style="color:${firmColor(i)}">${f.name} ${techBadge}</div>
            <div style="font-size:0.78rem;color:var(--text-secondary);">${extraInfo}</div>
            ${sub ? `<span class="submission-status received">Submitted: ${fmt(sub.quantity)}</span>` : `<span class="submission-status pending">Waiting…</span>`}
            <input type="number" id="prod-${regime}-${i}" min="0" max="${maxAllowed}"
                   value="${prefilledVal}" style="margin-top:0.3rem;">
          </div>`;
        }).join('')}
      </div>
      <div class="mt-1">
        <button class="btn btn-success btn-block" onclick="window.hostApp.submitRound('${regime}')">
          Submit Round ${roundNum}
        </button>
      </div>
    </div>`;
}

/* ── Round history ── */

function renderRoundHistory(regime, d) {
  const rows = d.rounds.map((r, ri) => {
    const firmCells = state.firms.map((_, fi) => `<td class="num">${fmt(r.production[fi])}</td>`).join('');
    return `<tr><td>R${ri + 1}</td>${firmCells}<td class="num">${fmt(r.totalProduction)}</td><td class="num">${fmt(r.ppmAfter)}</td></tr>`;
  }).join('');

  return `
    <div class="card">
      <h3>Production History</h3>
      <table>
        <thead><tr><th></th>${state.firms.map(f => `<th class="num">${f.name}</th>`).join('')}<th class="num">Total</th><th class="num">CO\u2082</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>`;
}

/* ── Regime summary ── */

function renderRegimeSummary(regime, d, config, nextRegime, nextLabel) {
  const totalProd = d.firms.reduce((s, f) => s + f.totalProduced, 0);
  const totalProfit = d.firms.reduce((s, f) => s + f.totalProfit, 0);
  const isTax = regimeUsesTax(regime);
  const hasMarket = regimeHasPermitMarket(regime);

  const firmRows = state.firms.map((f, i) => {
    const fd = d.firms[i];
    return `<tr>
      <td style="color:${firmColor(i)};font-weight:600;">${f.name}</td>
      <td class="num">${fmt(fd.totalProduced)}</td>
      <td class="num">${fmtMoney(fd.totalProfit)}</td>
      <td class="num">${fmtMoney(fd.capital)}</td>
    </tr>`;
  }).join('');

  let dwlHtml = '';
  if (regime !== 'freemarket') {
    const dwl = computeDeadweightLoss(state, regime);
    dwlHtml = `
      <div class="dwl-box">
        <div class="dwl-label">Deadweight Loss (vs. free market)</div>
        <div class="dwl-value">${fmtMoney(dwl)}</div>
        <div class="dwl-label">Excess cost of this regime's constraints</div>
      </div>`;
  }

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

  return `
    <div class="card">
      <h2>Regime Summary: ${REGIME_LABELS[regime]}</h2>
      ${dwlHtml}
      <table>
        <thead><tr><th>Firm</th><th class="num">Total Produced</th><th class="num">Total Profit</th><th class="num">Final Capital</th></tr></thead>
        <tbody>
          ${firmRows}
          <tr class="total"><td>Total</td><td class="num">${fmt(totalProd)}</td><td class="num">${fmtMoney(totalProfit)}</td><td></td></tr>
        </tbody>
      </table>
      <div class="stat-row"><span class="stat-label">Catastrophe triggered?</span>
        <span class="stat-value">${d.catastrophe ? '\ud83d\udca5 YES' : '\u2705 No'}</span></div>
      ${taxHtml}
      ${marketHtml}
      <div class="mt-1">
        <button class="btn btn-primary btn-block" onclick="window.hostApp.completeAndAdvance('${regime}', '${nextRegime}')">
          Proceed to ${nextLabel} &rarr;
        </button>
      </div>
    </div>`;
}

/* ── Results ── */

function renderResults() {
  const completed = state.completedRegimes.filter(r => REGIMES.includes(r));
  if (completed.length === 0) {
    return '<div class="card"><h2>Results</h2><p>No regimes completed yet.</p></div>';
  }

  const rows = completed.map(r => {
    const d = state.regimeData[r];
    const totalProd = d.firms.reduce((s, f) => s + f.totalProduced, 0);
    const totalProfit = d.firms.reduce((s, f) => s + f.totalProfit, 0);
    const dwl = r === 'freemarket' ? '\u2014' : fmtMoney(computeDeadweightLoss(state, r));
    const taxRev = r === 'tax' ? fmtMoney(d.totalTaxRevenue) : '\u2014';
    return `<tr>
      <td><strong>${REGIME_LABELS[r]}</strong></td>
      <td class="num">${fmt(totalProd)}</td>
      <td class="num">${fmt(d.ppm)}</td>
      <td class="num">${d.catastrophe ? '\ud83d\udca5 Yes' : '\u2705 No'}</td>
      <td class="num">${fmtMoney(totalProfit)}</td>
      <td class="num">${dwl}</td>
      <td class="num">${taxRev}</td>
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
        <thead><tr><th>Regime</th><th class="num">Total Prod.</th><th class="num">Final ppm</th><th class="num">Catastrophe?</th><th class="num">Total Profit</th><th class="num">DWL</th><th class="num">Tax Rev.</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
    </div>

    <div class="card">
      <h3>Profit by Firm Across Regimes</h3>
      <table>
        <thead><tr><th>Firm</th>${completed.map(r => `<th class="num">${REGIME_LABELS[r]}</th>`).join('')}</tr></thead>
        <tbody>${firmCompRows}</tbody>
      </table>
    </div>

    <div class="card">
      <h2>Discussion</h2>
      <div class="debrief-box" style="background:#eaf2f8;border-color:#aed6f1;">
        <h3 style="color:#2471a3;">Material Viability</h3>
        <ul>
          <li>Which approach actually kept us under ${state.config.triggerPpm} ppm?</li>
          <li>Carbon tax gives price certainty but quantity uncertainty. A cap gives quantity certainty; adding trade reallocates permits.</li>
        </ul>
      </div>
      <div class="debrief-box" style="background:#fef5e7;border-color:#f9e2b0;">
        <h3 style="color:#e67e22;">Normative Desirability</h3>
        <ul>
          <li>Which approach distributed costs most fairly? Who bore the greatest burden?</li>
          <li>A just distribution requires people to bear the true costs of their own plans to other people. Did any approach achieve this?</li>
        </ul>
      </div>
      <div class="debrief-box" style="background:#fdf2f2;border-color:#f5c6cb;">
        <h3 style="color:#c0392b;">Political Feasibility</h3>
        <ul>
          <li>Which approach was most vulnerable to gaming, lobbying, and manipulation?</li>
          <li>If firms can lobby to weaken the cap, or the tax is set too low, can any pricing mechanism actually work as designed?</li>
        </ul>
      </div>
    </div>

    <div class="card text-center">
      <button class="btn btn-primary" onclick="window.hostApp.resetGame()">Reset Game</button>
    </div>`;
}

/* ── Bootstrap ── */

init();
