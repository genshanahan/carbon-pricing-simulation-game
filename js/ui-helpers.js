/**
 * Shared UI helpers — formatting, CO₂ meter, common HTML fragments.
 * No DOM manipulation; returns HTML strings for rendering.
 */

export function fmt(n) {
  return n.toLocaleString('en-GB', { maximumFractionDigits: 1 });
}

export function fmtMoney(n) {
  if (Math.abs(n) < 1 && n !== 0) return '$' + n.toFixed(2);
  return '$' + n.toLocaleString('en-GB', { maximumFractionDigits: 0 });
}

export function escHtml(s) {
  return String(s ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * PPM bands shown in the CO2 spectrum meter.
 * Boundaries align with the descriptions in `ppmContext()` and correspond to
 * the IPCC's Shared Socioeconomic Pathways (SSPs) from the CMIP6 ScenarioMIP
 * framework (Meinshausen et al. 2020). Each band labels a distinct SSP
 * trajectory so students can see at a glance which climate scenario their
 * industry's emissions correspond to.
 */
const PPM_SPECTRUM_BANDS = [
  { max: 450, label: '2026 baseline', colour: '#27ae60' },
  { max: 470, label: 'Paris 1.5\u00B0C', colour: '#f1c40f' },
  { max: 500, label: 'Paris 2\u00B0C', colour: '#e67e22' },
  { max: 550, label: 'Beyond Paris', colour: '#e74c3c' },
  { max: Infinity, label: 'SSP5-8.5', colour: '#922b21' },
];

export function renderCO2Meter(ppm, config, extra) {
  const meterMin = config.startPpm;
  const meterMax = Math.max(560, ppm + 20, config.triggerPpm + 60);
  const span = Math.max(1, meterMax - meterMin);
  const danger = ppm >= config.triggerPpm;

  let prev = meterMin;
  const bands = [];
  for (const b of PPM_SPECTRUM_BANDS) {
    const hi = b.max === Infinity ? meterMax : Math.min(b.max, meterMax);
    if (hi <= prev) continue;
    const w = ((hi - prev) / span) * 100;
    bands.push({ lo: prev, hi, w, colour: b.colour, label: b.label });
    prev = hi;
    if (hi >= meterMax) break;
  }
  const bandsHtml = bands.map(s => `
    <div class="co2-band" style="width:${s.w}%;background:${s.colour};" title="${fmt(s.lo)}\u2013${fmt(s.hi)} ppm \u2014 ${s.label}">
      <span class="co2-band-label">${s.label}</span>
    </div>`).join('');

  const markerPct = Math.min(100, Math.max(0, ((ppm - meterMin) / span) * 100));
  const triggerPct = Math.min(100, Math.max(0, ((config.triggerPpm - meterMin) / span) * 100));

  return `
    <div class="co2-meter ${danger ? 'danger' : ''}">
      <div class="ppm-value">${fmt(ppm)} ppm</div>
      <div class="ppm-label">CO\u2082 concentration${danger ? ' \u2014 catastrophe threshold reached' : ''}</div>
      <div class="co2-spectrum" role="progressbar" aria-valuemin="${meterMin}" aria-valuemax="${Math.round(meterMax)}" aria-valuenow="${Math.round(ppm)}" aria-label="CO2 concentration plotted on spectrum of climate harm">
        <div class="co2-bands">${bandsHtml}</div>
        <div class="co2-trigger-line" style="left:${triggerPct}%;" title="Catastrophe threshold (${config.triggerPpm} ppm)"></div>
        <div class="co2-marker" style="left:${markerPct}%;" aria-hidden="true">
          <span class="co2-marker-arrow">\u25BC</span>
          <span class="co2-marker-value">${fmt(ppm)}</span>
        </div>
      </div>
      <div class="co2-spectrum-axis">
        <span>${meterMin} ppm</span>
        <span class="co2-axis-trigger">\u2191 ${config.triggerPpm} ppm = catastrophe trigger</span>
        <span>${Math.round(meterMax)} ppm</span>
      </div>
      <p class="co2-spectrum-caption">
        The bands correspond to the IPCC\u2019s Shared Socioeconomic Pathways (SSPs) \u2014 the scenarios climate scientists use to project future warming based on different levels of global emissions. Every band involves real climate harm. The catastrophe trigger is a game mechanic; in the real world there is no clean line where damage suddenly begins.
      </p>
      ${extra || ''}
    </div>`;
}

export function firmColor(i) { return `var(--firm${i})`; }
export function firmBg(i) { return `var(--firm${i}-bg)`; }

export function cleanBadge(fd) {
  if (fd.cleanTech) return '<span class="clean-badge">CLEAN</span>';
  return '<span class="dirty-badge">STANDARD</span>';
}

export function regimeUsesCleanTech(regime) {
  return ['tax', 'trade', 'trademarket'].includes(regime);
}

export function regimeUsesTax(regime) { return regime === 'tax'; }

export function regimeUsesPermits(regime) {
  return regime === 'trade' || regime === 'trademarket';
}

export function regimeHasCap(regime) { return regime === 'cac'; }

export function regimeHasPermitMarket(regime) { return regime === 'trademarket'; }

export function generateRoomCode() {
  const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  let code = '';
  for (let i = 0; i < 5; i++) code += chars[Math.floor(Math.random() * chars.length)];
  return code;
}

export function qrCodeUrl(text, size = 250) {
  return `https://api.qrserver.com/v1/create-qr-code/?data=${encodeURIComponent(text)}&size=${size}x${size}`;
}

export function ppmContext(ppm) {
  if (ppm < 450) {
    return {
      level: '2026 baseline — SSP1-2.6 territory',
      description: `At ${fmt(ppm)} ppm, CO₂ concentration is near today's real-world level (~430 ppm). This is the world you already live in: climate change already causes roughly 400,000 excess deaths per year through heat, hunger, and disease. Under SSP1-2.6, concentrations stay in this range if emissions fall sharply and reach net zero by ~2075. Even this "best case" locks in +1.1–1.2°C of warming and the human toll it is already exacting.`,
      colour: '#27ae60',
    };
  }
  if (ppm < 470) {
    return {
      level: 'Approaching Paris 1.5°C limit — SSP2-4.5 boundary',
      description: `At ${fmt(ppm)} ppm, warming approaches +1.5°C — the aspirational limit of the Paris Agreement. The step-change from today: an additional 1.7 billion people face severe heatwaves, heat-related mortality roughly doubles, and declining crop yields push tens of millions more into food insecurity. Under SSP2-4.5 ("current trajectory"), concentrations pass through this range in the 2030s–2040s. Staying below 1.5°C is still physically possible, but the window is closing fast.`,
      colour: '#f1c40f',
    };
  }
  if (ppm < 500) {
    return {
      level: 'Paris 2°C ceiling — SSP2-4.5 territory',
      description: `At ${fmt(ppm)} ppm, warming approaches +2°C — the hard ceiling of the Paris Agreement. The step-change from 1.5°C: up to 800 million more people exposed to hunger risk, vector-borne diseases like dengue and malaria expand into new regions affecting billions, and committed sea-level rise makes coastal cities home to hundreds of millions unviable long-term. The IPCC describes these as near-certain consequences at this level of warming.`,
      colour: '#e67e22',
    };
  }
  if (ppm < 550) {
    return {
      level: 'Beyond Paris — SSP3-7.0 territory',
      description: `At ${fmt(ppm)} ppm, warming exceeds +2°C — beyond anything the Paris Agreement was designed to prevent. The step-change: hundreds of millions of people face displacement from coastal flooding and lethal heat, labour capacity falls sharply in tropical regions as outdoor work becomes physically dangerous for much of the year, and breakdowns in global food production drive humanitarian crises at a scale beyond current institutional capacity. Under SSP3-7.0, emissions double by 2100 and concentrations pass through this range by mid-century.`,
      colour: '#e74c3c',
    };
  }
  return {
    level: 'Catastrophic — SSP5-8.5 territory',
    description: `At ${fmt(ppm)} ppm, warming approaches +3°C or higher. The step-change: cascading tipping points begin driving warming independently of human action, large parts of the tropics become uninhabitable due to lethal wet-bulb temperatures, billions face water stress, and climate-driven mortality rivals that of major wars — sustained indefinitely. Under SSP5-8.5, the IPCC projects "very high risk" across every assessed sector, meaning systemic and irreversible harm to human health, food security, and livelihood across most of the world's population.`,
    colour: '#922b21',
  };
}

export function formatTotalEconomicOutput(value) {
  if (value == null) return '\u2014';
  return fmtMoney(value);
}

export function formatBudgetUsed(pct) {
  if (pct == null) return '\u2014';
  return `${pct.toLocaleString('en-GB', { maximumFractionDigits: 0 })}%`;
}

/* Returns inline style string for table cells / boxes when budget is exceeded. */
export function budgetUsedStyle(pct) {
  if (pct != null && pct > 100) return 'background:#fde8e8;color:#c0392b;font-weight:600;';
  return '';
}

export function outputBudgetAnalogy(output, budgetUsed) {
  if (output == null && budgetUsed == null) return null;
  return `<strong>Total Economic Output</strong> is firm profit plus any tax revenue collected by the government \u2014 the full monetary value of what the economy produced this regime. Tax revenue counts because it represents output value redirected to the public sector, not output lost. <strong>Carbon Budget Used</strong> shows ppm added as a percentage of the safe carbon budget (the headroom between the starting ppm and the catastrophe trigger). A figure above 100% means the regime overshot the safe threshold. The two figures are shown side by side rather than collapsed into a single ratio so that the trade-off between output and climate impact remains visible. Neither figure alone tells the whole story: what was produced, for whom, and at what climate cost are all separate questions worth discussing.`;
}

export function debriefPrompt(regime) {
  const prompts = {
    freemarket: {
      question: 'The free market led to unchecked emissions. What rule change would you propose to prevent catastrophe while still allowing firms to operate profitably?',
      hint: '',
    },
    cac: {
      question: 'Command & control capped each firm equally. What problems did you notice? What would you change?',
      hint: '',
    },
    tax: {
      question: 'The carbon tax put a price on pollution but didn\'t guarantee a specific emissions level. What would you change to get more certainty about total emissions?',
      hint: '',
    },
    trade: {
      question: 'The permit cap controlled total emissions but some firms were stuck with permits they didn\'t need, while others wanted more. What would you change?',
      hint: '',
    },
    trademarket: {
      question: 'Cap & Trade combined a hard limit on emissions with a market for permits. What are the strengths and weaknesses of this approach? Could you improve it further?',
      hint: 'Consider: did the market price of permits reflect the true social cost of pollution? What happens if permits are allocated unfairly, or if firms can lobby to increase the cap?',
    },
  };
  return prompts[regime] || { question: 'What would you change about this regime?', hint: '' };
}

export function facilitatorNotes(regime) {
  const notes = {
    freemarket: {
      timing: '10–15 minutes (5 rounds + discussion)',
      keyPoints: [
        'This is the baseline — no regulation at all. Let students discover the tragedy of the commons organically.',
        'Every firm has an incentive to produce at maximum capacity. Total pollution will almost certainly trigger catastrophe.',
        'Resist the urge to intervene or hint. The point is for students to feel the collective action problem firsthand.',
      ],
      expectedDynamics: [
        'Most firms will produce at or near maximum capacity in every round.',
        'Some students may attempt informal agreements to limit production — note this but don\'t encourage or discourage it.',
        'Catastrophe typically triggers by Round 3–4. If it doesn\'t, the class is unusually cooperative (discuss why).',
      ],
      debriefTips: [
        'Ask: "Why did everyone produce so much?" Draw out the rational individual incentive.',
        'Ask: "Did anyone try to cooperate? What happened?" This surfaces the free-rider problem.',
        'Key insight: rational individual behaviour leads to collectively irrational outcomes.',
      ],
    },
    cac: {
      timing: '10 minutes (5 rounds + discussion)',
      keyPoints: [
        'The cap is uniform — every firm faces the same production limit regardless of efficiency.',
        'This is the simplest form of regulation. It guarantees quantity certainty but at the cost of economic efficiency.',
        'Students will notice they can\'t exceed the cap even if they have capital to spare.',
      ],
      expectedDynamics: [
        'Production will be uniform across all firms (all at the cap).',
        'Total profit will be lower than the free market, but catastrophe may be avoided.',
        'Some students may complain about the inflexibility — this is pedagogically valuable.',
      ],
      debriefTips: [
        'Ask: "Was it fair that every firm had the same cap?" Some firms might have reduced pollution more cheaply.',
        'Ask: "What do the Total Economic Output and Carbon Budget Used figures tell us?" (Output is firm profit plus any tax revenue — the full monetary value of what was produced. Budget Used shows how much of the safe carbon headroom was consumed; values above 100% mean the regime overshot. Together they let students compare regimes on output and climate impact without collapsing the trade-off into one number, and without implying that more output is always desirable — that depends on what is being produced and for whom.)',
        'Foreshadow: "What if instead of a hard cap, firms paid a price per unit of pollution?"',
      ],
    },
    tax: {
      timing: '12–15 minutes (5 rounds + clean-tech assignment + discussion)',
      keyPoints: [
        'The tax is emissions-based: firms with clean technology pay half the rate per unit.',
        'This introduces price certainty but quantity uncertainty — total emissions depend on how firms respond.',
        'The tax revenue goes to the government (not redistributed to firms in this simulation).',
        'Clean-tech firms face a trade-off: lower tax per unit vs. a one-off sunk investment deducted from their capital before Round 1. Because that cash is no longer available for production, clean-tech firms start with less capital and are production-constrained in the early rounds — though their higher per-unit margin may partly or fully offset this depending on the tax rate.',
      ],
      expectedDynamics: [
        'Clean-tech firms start with less capital because of the sunk investment, leaving them production-constrained in early rounds. Whether their per-round profit is immediately higher or lower than standard depends on the tax rate. Watch the cumulative capital tracker — the crossover point where clean-tech firms pull ahead is a key teaching moment.',
        'Total emissions may still exceed the trigger — the tax rate may be too low.',
        'Students begin to see the efficiency argument: cleaner production requires an upfront investment, and a carbon tax gives firms a reason to make it.',
      ],
      debriefTips: [
        'Ask: "Was the clean-tech investment worth it? When did clean-tech firms pull ahead — and should governments subsidise the transition?"',
        'Ask: "Did the tax reduce emissions enough? What would happen if we raised it?"',
        'Ask: "Who bore the cost of the tax? Was that fair?"',
        'Key insight: a tax gives price certainty but not quantity certainty. Bridge to: "What if we set a hard limit on total emissions instead?"',
      ],
    },
    trade: {
      timing: '10 minutes (5 rounds + permit allocation + discussion)',
      keyPoints: [
        'Permits cap total emissions with certainty. Each permit allows a fixed amount of CO₂.',
        'Without trading, firms with excess permits can\'t use them productively, and firms that need more can\'t get them.',
        'This sets up the motivation for Cap & Trade in the next regime.',
      ],
      expectedDynamics: [
        'Firms with clean technology get more effective production per permit (2,000 units vs. 1,000).',
        'Some firms will be permit-constrained and unable to produce as much as they could afford.',
        'Total emissions should stay within the cap — but economic output is suboptimal.',
      ],
      debriefTips: [
        'Ask: "Did anyone have permits they didn\'t use? Did anyone want more?"',
        'Ask: "What if you could sell your spare permits to someone who values them more?"',
        'This should naturally lead students to propose trading — the key pedagogical moment.',
      ],
    },
    trademarket: {
      timing: '15–20 minutes (5 rounds + permit allocation + trading rounds + discussion)',
      keyPoints: [
        'This is the culmination: a hard emissions cap plus a market mechanism for efficient allocation.',
        'Firms that take the clean-tech investment at the start of this regime will abate (their permits cover 2,000 units of output instead of 1,000), but the sunk cost leaves them capital-constrained — so they typically end up holding slack permits they cannot profitably use.',
        'Firms that stay standard will keep more capital on hand and can still turn each permit into $1,000 of gross profit. They are the natural buyers in the permit market.',
        'Record trades carefully — the market price data is valuable for the final discussion.',
        'Let students negotiate freely. Don\'t set a price — the market should discover it.',
      ],
      expectedDynamics: [
        'By the later rounds, clean-tech firms tend to be capital-constrained with slack permits (willing to sell at any positive price), while standard firms tend to be permit-constrained (willing to buy up to their gross permit value).',
        'The equilibrium price settles between those two anchors — above the sellers\' reservation (effectively $0) and below the buyers\' cap (the gross $1,000/permit value).',
        'Total emissions stay within the cap, but economic output is higher than under Cap alone because permits end up with the firms that can convert them into production.',
        'Some students may attempt price manipulation or collusion — note this for the political feasibility discussion.',
      ],
      debriefTips: [
        'Ask: "What was the market price of a permit? Does it reflect the true social cost of pollution?"',
        'Ask: "Did trading make both sides better off? How?"',
        'Ask: "What happens if firms lobby to increase the total number of permits?"',
        'Key insight: Cap & Trade combines quantity certainty with economic efficiency, but is vulnerable to political capture.',
      ],
    },
  };
  return notes[regime] || null;
}

export function onboardingGuide() {
  return `
    <details class="facilitator-notes" open>
      <summary>How to run this game</summary>
      <div class="fn-body">
        <p><strong>Overview:</strong> Students play as competing firms that manufacture "thingamabobs". Each round represents a medium-term production cycle. Over five rounds, the industry's cumulative emissions trace a path through the IPCC's Shared Socioeconomic Pathways — from today's baseline towards or beyond the Paris Agreement limits. If total emissions exceed the catastrophe threshold, a climate tipping point is breached.</p>
        <p><strong>Flow:</strong> The game runs through five regulatory regimes in sequence. After each regime, a structured debrief invites students to propose what they would change — then the next regime reveals the real-world answer.</p>
        <ol>
          <li><strong>Free Market</strong> — No rules. Students discover the tragedy of the commons.</li>
          <li><strong>Command &amp; Control</strong> — A hard per-firm production cap. Effective but blunt.</li>
          <li><strong>Carbon Tax</strong> — Price-based regulation. Efficient but uncertain quantity.</li>
          <li><strong>Cap</strong> — Permit-based quantity cap. Certain quantity but inflexible.</li>
          <li><strong>Cap &amp; Trade</strong> — Permits plus a market. The policy synthesis.</li>
        </ol>
        <p><strong>Student devices:</strong> Students join via the QR code or room link on their phones. They see regime rules, a profit calculator, and a submission form. All production decisions are submitted digitally.</p>
        <p><strong>Timing:</strong> Allow 60–90 minutes for the full game (all five regimes). Each regime takes 10–20 minutes including discussion. You can stop after any regime if time is short.</p>
        <p><strong>Key tip:</strong> Resist explaining the next regime before the debrief. The structured proposal step is most powerful when students genuinely don't know what's coming next.</p>
      </div>
    </details>`;
}

/**
 * Build the `extra` HTML to pass to renderCO2Meter so the ppm context
 * description (and, when applicable, the catastrophe breach notice) appears
 * inside the CO2 concentration box rather than as a separate card below it.
 *
 * @param {number} ppm
 * @param {object} config  - must have triggerPpm
 * @param {string} [prefix] - optional HTML to inject before the context block
 *                            (e.g. a tax-revenue line in the host view)
 */
export function renderCO2Extra(ppm, config, prefix = '') {
  const ctx = ppmContext(ppm);
  const fmt2 = (n) => n.toLocaleString('en-GB', { maximumFractionDigits: 1 });
  const catastropheHtml = ppm >= config.triggerPpm
    ? `<div style="margin-top:0.6rem;padding:0.5rem 0.75rem;background:#fde8e8;border-radius:0.4rem;border-left:3px solid #c0392b;">
        <strong style="color:#c0392b;">Catastrophe threshold breached</strong>
        <p style="font-size:0.83rem;margin:0.2rem 0 0;">Emissions exceeded the safe limit of <strong>${fmt2(config.triggerPpm)} ppm</strong>. Firms may continue producing under this regime, mirroring how real-world economies continue operating after overshooting climate targets.</p>
      </div>`
    : '';
  return `${prefix}
    <div class="ppm-context-inline" style="border-top:1px solid ${ctx.colour}33;margin-top:0.75rem;padding-top:0.75rem;">
      <div class="ppm-context-level" style="color:${ctx.colour};font-weight:600;font-size:0.9rem;">${ctx.level}</div>
      <p style="font-size:0.85rem;margin:0.3rem 0 0.2rem;">${ctx.description}</p>
      <div class="ppm-context-source">Sources: IPCC AR6 WG1 (2021); Meinshausen et al. (2020) SSP concentration pathways</div>
      ${catastropheHtml}
    </div>`;
}

/**
 * Shared Production History card used by solo-app, play-app, and host-app.
 *
 * @param {string}   regime          - Current regime key.
 * @param {object}   d               - regimeData for this regime.
 * @param {Array}    firms           - state.firms array (names).
 * @param {object}   config          - state.config.
 * @param {number|null} playerFirmIndex - Index of the human player's firm, or
 *                                     null when there is no single highlighted
 *                                     player (e.g. host view).
 */
export function renderRoundHistory(regime, d, firms, config, playerFirmIndex = null) {
  /* Capital after the latest completed round, or starting capital if none. */
  const currentCapital = firms.map((_, fi) => {
    if (d.rounds.length === 0) return config.startCapital;
    const last = d.rounds[d.rounds.length - 1];
    return (last.capitalStart[fi] || 0) + (last.profitByFirm[fi] || 0);
  });

  const capitalFootCells = firms.map((_, i) => {
    const cap = currentCapital[i];
    const isPlayer = i === playerFirmIndex;
    const style = `${isPlayer ? 'font-weight:700;' : ''}color:${firmColor(i)};`;
    return `<td class="num" style="${style}">${fmtMoney(cap)}</td>`;
  }).join('');

  const sunkNote = regimeUsesCleanTech(regime) && d.rounds.length > 0
    ? `<p style="font-size:0.78rem;color:var(--text-secondary);margin:0.5rem 0 0;">` +
      `\u2020 Capital reflects the one-off clean-tech investment (${fmtMoney(config.cleanTechCost)}) deducted before Round 1 for firms that invested.` +
      `</p>`
    : '';

  const rows = d.rounds.map((r, ri) => {
    const firmCells = firms.map((_, fi) => {
      const prod = Number(r.production?.[fi]) || 0;
      const profit = Number(r.profitByFirm?.[fi]) || 0;
      return `<td class="num">${fmt(prod)}<div class="sub-cell-note">${fmtMoney(profit)}</div></td>`;
    }).join('');
    return `<tr>
      <td>R${ri + 1}</td>
      ${firmCells}
      <td class="num">${fmt(r.totalProduction)}</td>
      <td class="num">${fmt(r.ppmAfter)}</td>
    </tr>`;
  }).join('');

  return `<div class="card">
    <h3>Production History</h3>
    <div style="overflow-x:auto;">
    <table>
      <thead><tr>
        <th></th>
        ${firms.map((f, i) => `<th class="num" style="color:${firmColor(i)};">${escHtml(f.name)}${i === playerFirmIndex ? ' (You)' : ''}<div class="sub-cell-note">Prod / Profit</div></th>`).join('')}
        <th class="num">Total</th>
        <th class="num">CO\u2082</th>
      </tr></thead>
      <tbody>${rows}</tbody>
      <tfoot><tr style="border-top:2px solid var(--border);">
        <td style="font-size:0.8rem;color:var(--text-secondary);font-weight:600;white-space:nowrap;">Capital after R${d.rounds.length || '\u2014'}</td>
        ${capitalFootCells}
        <td></td><td></td>
      </tr></tfoot>
    </table>
    </div>
    ${sunkNote}
  </div>`;
}

export function regimeDescription(regime, config) {
  const descriptions = {
    freemarket: `No regulation. Firms compete to maximise profit. Catastrophe at ${config.triggerPpm} ppm.`,
    cac: `Hard cap: no firm may produce more than <strong>${fmt(config.cacCap)}</strong> thingamabobs per round.`,
    tax: `No cap. Tax is based on <strong>emissions</strong>: standard firms pay <strong>${fmtMoney(config.taxRate)}</strong> per unit (profit: ${fmtMoney(config.profitPerUnit - config.taxRate)}/unit). Clean-tech firms halve their emissions and pay <strong>${fmtMoney(config.taxRate / 2)}</strong> per unit (profit: ${fmtMoney(config.profitPerUnit - config.taxRate / 2)}/unit, after a one-off ${fmtMoney(config.cleanTechCost)} clean-tech investment).`,
    trade: `No tax. Hard cap on CO\u2082 emissions via permits (1 permit = ${config.ppmPer1000} ppm CO\u2082). Standard firms: 1 permit = 1,000 units. Clean-tech firms: 1 permit = 2,000 units.`,
    trademarket: `Same permit rules as Cap, but firms may now <strong>buy and sell permits</strong>. The permit market logs each agreed trade: seller, buyer, permits, and price.`,
  };
  return descriptions[regime] || '';
}

/**
 * Canonical Discussion card shown on the Results screen in all three apps.
 * Uses config.triggerPpm for the Material Viability bullet.
 */
export function renderDiscussionCard(config) {
  return `
    <div class="card">
      <h2>Discussion</h2>
      <div class="debrief-box" style="background:#eaf2f8;border-color:#aed6f1;">
        <h3 style="color:#2471a3;">Material Viability</h3>
        <ul>
          <li>Which approach actually kept us under ${config.triggerPpm} ppm?</li>
          <li>The game presupposes a catastrophe threshold of ${config.triggerPpm} ppm, corresponding to SSP2-4.5 and the Paris 2\u00b0C ceiling. But what uncertainties surround actual climate tipping points \u2014 and what human costs and moral trade-offs are baked into choosing <em>this</em> threshold?</li>
          <li>A carbon tax gives certainty about the <em>price</em> of emissions but not the <em>quantity</em>. A cap gives certainty about the <em>quantity</em> but not the <em>price</em>. Which kind of uncertainty is more dangerous, and for whom?</li>
          <li>What happens to each regime\u2019s effectiveness if our scientific understanding of the safe threshold changes mid-policy?</li>
        </ul>
      </div>
      <div class="debrief-box" style="background:#fef5e7;border-color:#f9e2b0;">
        <h3 style="color:#e67e22;">Normative Desirability</h3>
        <ul>
          <li>Which approach distributed costs most fairly? Who bore the greatest burden \u2014 and who was protected?</li>
          <li>A just distribution requires people to bear the true costs of their own plans to other people. Did any approach achieve this?</li>
          <li>Under the carbon tax, firms that could not afford clean technology bore a disproportionate cost. Is a thingamabob from a firm that cannot afford to go green the same as one from a firm that can?</li>
          <li>The game does not represent all the people affected by these policy choices. Whose interests were absent from the table?</li>
        </ul>
      </div>
      <div class="debrief-box" style="background:#fdf2f2;border-color:#f5c6cb;">
        <h3 style="color:#c0392b;">Political Feasibility</h3>
        <ul>
          <li>Which approach was most vulnerable to gaming, lobbying, and manipulation?</li>
          <li>If firms can lobby to weaken the cap, or the tax is set too low because of political pressure, can any pricing mechanism actually work as designed?</li>
          <li>Is command-and-control always necessarily bureaucratic and inefficient? Can you think of regulations that could be set directly by governments that would be effective?</li>
          <li>What sustainability transition challenges are <em>not</em> represented in the game?</li>
        </ul>
      </div>
      <div class="debrief-box" style="background:#f4f4f4;border-color:#bbb;">
        <h3 style="color:#555;">The Game as an Ideological Artefact</h3>
        <ul>
          <li>This game was calibrated to tell a specific story about economically efficient regulation. What assumptions did the game\u2019s design build in, and how do those assumptions shape the conclusions you are likely to draw?</li>
          <li>The game focuses attention on the relative <em>flexibility</em> of different policies. Is flexibility always desirable? Or are there cases where rigid rules produce better outcomes?</li>
          <li>What are the relative advantages and disadvantages of the three carbon pricing regimes in terms of <strong>uncertainty</strong> regarding: existing and future technological developments; climate dynamics; political and economic dynamics?</li>
        </ul>
      </div>
    </div>`;
}

/**
 * Facilitator/educator hints for the Discussion card questions.
 * Collapsed by default; not shown on the player side (play-app).
 * @param {string} label - "Educator" for solo-app, "Facilitator" for host-app
 */
export function renderDiscussionFacilitatorHints(label) {
  const title = label || 'Educator';
  return `
    <details class="facilitator-notes">
      <summary>${title} Discussion Notes</summary>
      <div class="fn-body">
        <p><strong>Political Feasibility prompts:</strong></p>
        <ul>
          <li><em>\u201cCan you think of effective government-set regulations?\u201d</em> \u2014 e.g. \u201cchoice editing\u201d that removes high-emission options from the market entirely (cf. 1.5-degree lifestyle report)</li>
          <li><em>\u201cWhat transition challenges are not represented?\u201d</em> \u2014 e.g. political lobbying related to sunk-cost investments in fossil fuel / clean tech infrastructure; financialisation of permits through second-order trading, betting, hedging, and speculation; normative considerations re: distributive implications of different regimes</li>
        </ul>
        <p><strong>Ideological Artefact prompts:</strong></p>
        <ul>
          <li><em>\u201cIs flexibility always desirable?\u201d</em> \u2014 consider cases where rigid rules (bans, standards) produce more equitable outcomes than market mechanisms</li>
          <li><em>\u201cUncertainty across regimes\u201d</em> \u2014 prompt students to distinguish between technological uncertainty, climate-science uncertainty, and political-economic uncertainty, and consider which regime handles each best/worst</li>
        </ul>
      </div>
    </details>`;
}

/**
 * Canonical fill-in Comparison Table shown on the Results screen in all three apps.
 * @param {string[]} regimes  - completed regime keys
 * @param {object}   labels   - REGIME_LABELS map (passed in to avoid circular import)
 */
export function renderComparisonTable(regimes, labels) {
  return `
    <div class="card">
      <h3>Comparison Table</h3>
      <p style="font-size:0.85rem;color:var(--text-secondary);">
        Discuss and fill in the projected comparison table.
      </p>
      <div style="overflow-x:auto;">
      <table style="font-size:0.82rem;">
        <thead><tr><th></th>${regimes.map(r => `<th>${labels[r]}</th>`).join('')}</tr></thead>
        <tbody>
          <tr><td><strong>Material viability</strong></td>${regimes.map(() => '<td></td>').join('')}</tr>
          <tr><td><strong>Normative desirability</strong></td>${regimes.map(() => '<td></td>').join('')}</tr>
          <tr><td><strong>Political feasibility</strong></td>${regimes.map(() => '<td></td>').join('')}</tr>
        </tbody>
      </table>
      </div>
    </div>`;
}
