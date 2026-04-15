/**
 * Game Engine — pure state logic for the Carbon Pricing Simulation Game.
 * No DOM, no Firebase. Imported by both host and student apps.
 */

export const DEFAULTS = {
  numFirms: 5,
  numRounds: 5,
  costPerUnit: 1,
  revenuePerUnit: 2,
  ppmPer1000: 2,
  startPpm: 380,
  triggerPpm: 450,
  taxRate: 0.80,
  /** Subset of {@link OPTIONAL_REGIMES} in canonical order (free market is always first). */
  enabledRegimes: ['cac', 'tax', 'trade', 'trademarket'],
  /** When true, facilitator can inject extra permits mid-session in Cap & Trade. */
  offsetAuctionEnabled: false,
};

/**
 * Derive session parameters that must stay calibrated to the pedagogical model.
 *
 * **startCapital** — Set so that unconstrained free-market production triggers
 * catastrophe at roughly 60 % of the way through the regime (e.g. round 3 of 5).
 *
 * **cleanTechCost** — 45 % of startCapital: clean-tech firms reliably earn less
 * than standard firms in rounds 1–2 of the Carbon Tax regime, prompting the
 * fairness discussion, then overtake in round 3+.
 *
 * **maxCleanTech** — ~40 % of firms (at least 1): enough for heterogeneity
 * without making clean tech the majority.
 *
 * **permitsPerFirm** — Derived so that permit-based production is strictly less
 * than what firms could afford, ensuring permits are a binding constraint.
 */
export function deriveSessionParams(numFirms, numRounds, opts = {}) {
  const ppmPer1000 = opts.ppmPer1000 ?? DEFAULTS.ppmPer1000;
  const startPpm   = opts.startPpm   ?? DEFAULTS.startPpm;
  const triggerPpm  = opts.triggerPpm  ?? DEFAULTS.triggerPpm;
  const ppmBudget = triggerPpm - startPpm;

  const targetRound = Math.ceil(numRounds * 0.6);
  const exactC = (ppmBudget * 1000) /
    (numFirms * (Math.pow(2, targetRound) - 1) * ppmPer1000);
  const startCapital = Math.ceil(exactC / 50) * 50;

  const cleanTechCost = Math.round(startCapital * 0.45);
  const maxCleanTech = Math.max(1, Math.floor(numFirms * 0.4));

  const maxThingamabobs = (ppmBudget / ppmPer1000) * 1000;
  const permitsPerFirm = Math.max(1,
    Math.floor(Math.floor(maxThingamabobs / 1000) / numFirms));

  return { startCapital, cleanTechCost, maxCleanTech, permitsPerFirm };
}

/** Full canonical order (free market + optional chain). */
export const REGIMES = ['freemarket', 'cac', 'tax', 'trade', 'trademarket'];

/** Regimes that can be toggled off in session configuration (always after free market). */
export const OPTIONAL_REGIMES = ['cac', 'tax', 'trade', 'trademarket'];

export const REGIME_LABELS = {
  freemarket: 'Free Market',
  cac: 'Command & Control',
  tax: 'Carbon Tax',
  trade: 'Cap',
  trademarket: 'Cap & Trade',
};

export const REGIME_NAV_LABELS = {
  freemarket: '1. Free Market',
  cac: '2. Command & Control',
  tax: '3. Carbon Tax',
  trade: '4. Cap',
  trademarket: '5. Cap & Trade',
};

/**
 * Normalise optional regime list: unknown ids removed, Cap & Trade implies Cap.
 * @param {unknown} raw
 * @returns {string[]}
 */
export function normaliseEnabledRegimes(raw) {
  if (!Array.isArray(raw)) return [...OPTIONAL_REGIMES];
  if (raw.length === 0) return [];
  const set = new Set(raw.filter(r => OPTIONAL_REGIMES.includes(r)));
  if (set.has('trademarket')) set.add('trade');
  return OPTIONAL_REGIMES.filter(r => set.has(r));
}

/** Ordered list of regime ids for this session (always starts with free market). */
export function regimeSequence(config) {
  return ['freemarket', ...normaliseEnabledRegimes(config.enabledRegimes)];
}

/** Next screen after `regime` when completing debrief, or `'results'` if none. */
export function nextRegimeAfter(config, regime) {
  const seq = regimeSequence(config);
  const i = seq.indexOf(regime);
  if (i < 0 || i >= seq.length - 1) return 'results';
  return seq[i + 1];
}

/** Previous regime tab in session order, or `'setup'` before free market. */
export function previousRegimeInSession(config, regime) {
  const seq = regimeSequence(config);
  const i = seq.indexOf(regime);
  if (i <= 0) return 'setup';
  return seq[i - 1];
}

export function buildConfig(overrides = {}) {
  const c = { ...DEFAULTS, ...overrides };
  c.enabledRegimes = normaliseEnabledRegimes(c.enabledRegimes);
  c.numFirms = Math.max(3, Math.min(8, Math.round(Number(c.numFirms) || DEFAULTS.numFirms)));
  c.numRounds = Math.max(3, Math.min(7, Math.round(Number(c.numRounds) || DEFAULTS.numRounds)));
  c.offsetAuctionEnabled = !!c.offsetAuctionEnabled;

  const derived = deriveSessionParams(c.numFirms, c.numRounds, c);
  c.startCapital  = derived.startCapital;
  c.cleanTechCost = derived.cleanTechCost;
  c.maxCleanTech  = derived.maxCleanTech;

  c.profitPerUnit = c.revenuePerUnit - c.costPerUnit;
  c.maxThingamabobs = (c.triggerPpm - c.startPpm) / c.ppmPer1000 * 1000;
  c.cacCap = Math.floor(c.maxThingamabobs / (c.numFirms * c.numRounds));
  return Object.freeze(c);
}

/** Resize firm name list when `numFirms` changes (preserves names where possible). */
export function resizeFirmsList(existingFirms, n) {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    name: (existingFirms[i] && String(existingFirms[i].name).trim()) || `Firm ${i + 1}`,
  }));
}

/* ── State creation ── */

export function createInitialState(config) {
  return {
    config,
    regime: 'setup',
    firms: createDefaultFirms(config.numFirms),
    completedRegimes: [],
    regimeData: {},
    /** When true, facilitator can open any regime tab (multi-session resume / testing). */
    facilitatorNavUnlocked: false,
    /** Set true once the facilitator leaves Setup for a regime (locks session configuration). */
    gameStarted: false,
  };
}

/**
 * Merge Firebase snapshots into a full game state object. RTDB can omit empty
 * arrays/objects, which would otherwise break `.includes` on the client.
 * Uses a clone so we never mutate the SDK snapshot object.
 */
export function normalizeStateFromRemote(s) {
  if (!s || typeof s !== 'object') return null;
  let o;
  try {
    o = JSON.parse(JSON.stringify(s));
  } catch {
    return null;
  }
  if (!Array.isArray(o.completedRegimes)) o.completedRegimes = [];
  if (!o.regimeData || typeof o.regimeData !== 'object') o.regimeData = {};
  if (!Array.isArray(o.firms)) o.firms = [];
  if (!o.regime) o.regime = 'setup';
  if (typeof o.facilitatorNavUnlocked !== 'boolean') o.facilitatorNavUnlocked = false;
  if (typeof o.gameStarted !== 'boolean') o.gameStarted = false;
  if (!o.gameStarted && o.regime && o.regime !== 'setup') o.gameStarted = true;
  if (!o.gameStarted && o.regimeData && typeof o.regimeData === 'object') {
    for (const key of Object.keys(o.regimeData)) {
      const rd = o.regimeData[key];
      if (!rd || typeof rd !== 'object') continue;
      if ((Array.isArray(rd.rounds) && rd.rounds.length > 0) || (typeof rd.currentRound === 'number' && rd.currentRound > 0)) {
        o.gameStarted = true;
        break;
      }
    }
  }
  if (!o.config || typeof o.config !== 'object') o.config = {};
  const mergedCfg = { ...DEFAULTS, ...o.config };
  if (!Array.isArray(mergedCfg.enabledRegimes)) mergedCfg.enabledRegimes = [...OPTIONAL_REGIMES];
  if (typeof mergedCfg.startCapital !== 'number') {
    const d = deriveSessionParams(
      mergedCfg.numFirms ?? DEFAULTS.numFirms,
      mergedCfg.numRounds ?? DEFAULTS.numRounds,
      mergedCfg,
    );
    mergedCfg.startCapital  = d.startCapital;
    mergedCfg.cleanTechCost = d.cleanTechCost;
    mergedCfg.maxCleanTech  = d.maxCleanTech;
  }
  for (const key of Object.keys(o.regimeData)) {
    o.regimeData[key] = normalizeRegimeDatum(o.regimeData[key], mergedCfg);
  }
  return o;
}

export function createDefaultFirms(n) {
  return Array.from({ length: n }, (_, i) => ({
    id: i,
    name: `Firm ${i + 1}`,
  }));
}

export function initRegimeData(config, existingData) {
  return {
    currentRound: 0,
    rounds: [],
    revealedRounds: {},
    firms: Array.from({ length: config.numFirms }, (_, i) => ({
      id: i,
      capital: config.startCapital,
      totalProduced: 0,
      totalProfit: 0,
      cleanTech: false,
      permits: 0,
    })),
    ppm: config.startPpm,
    catastrophe: false,
    totalTaxRevenue: 0,
    trades: [],
    debriefActive: false,
    offsetInjectLog: [],
  };
}

/**
 * Fill in fields RTDB may omit (empty arrays, nested defaults) for one regime.
 * `config` should include at least numFirms, startCapital, startPpm (merged defaults OK).
 */
export function normalizeRegimeDatum(rd, config) {
  const base = initRegimeData(config);
  if (!rd || typeof rd !== 'object') return base;

  const num = config.numFirms;
  const firms = Array.from({ length: num }, (_, i) => {
    const b = base.firms[i];
    const f = Array.isArray(rd.firms) ? rd.firms[i] : null;
    return f && typeof f === 'object' ? { ...b, ...f } : b;
  });

  const rounds = Array.isArray(rd.rounds)
    ? rd.rounds.map(r => normalizeRoundRecord(r, config.numFirms))
    : [];

  return {
    currentRound: typeof rd.currentRound === 'number' ? rd.currentRound : 0,
    rounds,
    revealedRounds: rd.revealedRounds && typeof rd.revealedRounds === 'object' ? rd.revealedRounds : {},
    firms,
    ppm: typeof rd.ppm === 'number' ? rd.ppm : base.ppm,
    catastrophe: typeof rd.catastrophe === 'boolean' ? rd.catastrophe : false,
    totalTaxRevenue: typeof rd.totalTaxRevenue === 'number' ? rd.totalTaxRevenue : 0,
    trades: Array.isArray(rd.trades) ? rd.trades : [],
    debriefActive: typeof rd.debriefActive === 'boolean' ? rd.debriefActive : false,
    offsetInjectLog: Array.isArray(rd.offsetInjectLog) ? rd.offsetInjectLog : [],
  };
}

function normalizeRoundRecord(round, numFirms) {
  if (!round || typeof round !== 'object') {
    return {
      production: Array.from({ length: numFirms }, () => 0),
      profitByFirm: Array.from({ length: numFirms }, () => 0),
      capitalStart: Array.from({ length: numFirms }, () => 0),
      totalProduction: 0,
      totalProfit: 0,
      capitalStartTotal: 0,
      ppmAfter: 0,
    };
  }
  const production = Array.from({ length: numFirms }, (_, i) => Number(round.production?.[i]) || 0);
  const profitByFirm = Array.from({ length: numFirms }, (_, i) => Number(round.profitByFirm?.[i]) || 0);
  const capitalStart = Array.from({ length: numFirms }, (_, i) => Number(round.capitalStart?.[i]) || 0);
  return {
    production,
    profitByFirm,
    capitalStart,
    totalProduction: typeof round.totalProduction === 'number'
      ? round.totalProduction
      : production.reduce((s, v) => s + v, 0),
    totalProfit: typeof round.totalProfit === 'number'
      ? round.totalProfit
      : profitByFirm.reduce((s, v) => s + v, 0),
    capitalStartTotal: typeof round.capitalStartTotal === 'number'
      ? round.capitalStartTotal
      : capitalStart.reduce((s, v) => s + v, 0),
    ppmAfter: typeof round.ppmAfter === 'number' ? round.ppmAfter : 0,
  };
}

/* ── Helpers ── */

export function unitsPerPermit(firmData) {
  return firmData.cleanTech ? 2000 : 1000;
}

export function permitsUsed(firmData) {
  return firmData.totalProduced / unitsPerPermit(firmData);
}

export function permitsRemaining(firmData) {
  return firmData.permits - permitsUsed(firmData);
}

export function maxProductionFromPermits(firmData) {
  return Math.max(0, Math.floor(permitsRemaining(firmData) * unitsPerPermit(firmData)));
}

export function maxAffordable(firmData, config) {
  return Math.floor(firmData.capital / config.costPerUnit);
}

export function maxAllowedProduction(firmData, config, regime) {
  let cap = maxAffordable(firmData, config);
  if (regime === 'cac') cap = Math.min(cap, config.cacCap);
  if (regime === 'trade' || regime === 'trademarket') {
    cap = Math.min(cap, maxProductionFromPermits(firmData));
  }
  return cap;
}

/** Total carbon tax paid by one firm across all completed rounds in a regime. */
export function totalTaxPaidByFirm(d, firmIndex, config) {
  const fd = d.firms[firmIndex];
  if (!fd || !Array.isArray(d.rounds)) return 0;
  let total = 0;
  for (const r of d.rounds) {
    const p = (r.production && r.production[firmIndex]) || 0;
    const rate = fd.cleanTech ? config.taxRate / 2 : config.taxRate;
    total += p * rate;
  }
  return total;
}

/**
 * Profit breakdown for one firm in one round (matches processRound logic).
 * @param {'freemarket'|'cac'|'tax'|'trade'|'trademarket'} regime
 */
export function roundProfitDetailForFirm(regime, config, fd, productionQty) {
  const p = Math.max(0, productionQty || 0);
  const cost = p * config.costPerUnit;
  const revenue = p * config.revenuePerUnit;
  let tax = 0;
  let setup = 0;
  if (regime === 'tax') {
    const rate = fd.cleanTech ? config.taxRate / 2 : config.taxRate;
    tax = p * rate;
  }
  if ((regime === 'tax' || regime === 'trade' || regime === 'trademarket') && fd.cleanTech && p > 0) {
    setup = config.cleanTechCost;
  }
  const profit = revenue - cost - tax - setup;
  return { p, cost, revenue, tax, setup, profit };
}

export function defaultPermitsPerFirm(config) {
  const totalSafe = Math.floor(config.maxThingamabobs / 1000);
  return Math.floor(totalSafe / config.numFirms);
}

/* ── Round processing ── */

export function processRound(state, regime, production) {
  const config = state.config;
  const d = state.regimeData[regime];
  const isCaC = regime === 'cac';
  const isTax = regime === 'tax';
  const isTrade = regime === 'trade' || regime === 'trademarket';

  const clamped = [];
  for (let i = 0; i < config.numFirms; i++) {
    let val = Math.max(0, production[i] || 0);
    const fd = d.firms[i];
    const afford = maxAffordable(fd, config);
    if (val > afford) val = afford;
    if (isCaC && val > config.cacCap) val = config.cacCap;
    if (isTrade) {
      const permitMax = maxProductionFromPermits(fd);
      if (val > permitMax) val = Math.max(0, permitMax);
    }
    clamped.push(val);
  }

  let totalPpmAdded = 0;
  let roundTaxRevenue = 0;
  const capitalStart = [];
  const roundProfitByFirm = [];

  for (let i = 0; i < config.numFirms; i++) {
    const fd = d.firms[i];
    const capitalBefore = fd.capital;
    const p = clamped[i];
    const cost = p * config.costPerUnit;
    const revenue = p * config.revenuePerUnit;
    let tax = 0;
    let cleanSetup = 0;

    if ((isTax || isTrade) && fd.cleanTech) {
      cleanSetup = config.cleanTechCost;
    }
    if (isTax) {
      const effectiveRate = fd.cleanTech ? config.taxRate / 2 : config.taxRate;
      tax = p * effectiveRate;
      roundTaxRevenue += tax;
    }

    const profit = revenue - cost - tax - cleanSetup;
    capitalStart.push(capitalBefore);
    roundProfitByFirm.push(profit);
    fd.capital = fd.capital - cost + revenue - tax - cleanSetup;
    fd.totalProduced += p;
    fd.totalProfit += profit;

    const ppmContrib = (p / 1000) * (fd.cleanTech ? config.ppmPer1000 / 2 : config.ppmPer1000);
    totalPpmAdded += ppmContrib;
  }

  d.ppm += totalPpmAdded;
  if (d.ppm >= config.triggerPpm) d.catastrophe = true;
  d.totalTaxRevenue += roundTaxRevenue;

  const totalProd = clamped.reduce((s, v) => s + v, 0);
  const totalRoundProfit = roundProfitByFirm.reduce((s, v) => s + v, 0);
  const totalCapitalStart = capitalStart.reduce((s, v) => s + v, 0);
  d.rounds.push({
    production: [...clamped],
    profitByFirm: roundProfitByFirm,
    capitalStart,
    totalProduction: totalProd,
    totalProfit: totalRoundProfit,
    capitalStartTotal: totalCapitalStart,
    ppmAfter: d.ppm,
  });
  d.currentRound++;

  return { clamped, totalPpmAdded, roundTaxRevenue };
}

/* ── Permit trading ── */

/**
 * Add the same number of extra permits to every firm (offset auction twist).
 * Only for Cap & Trade; intended mid-round while rounds remain.
 */
export function injectOffsetPermits(state, regime, perFirm) {
  const d = state.regimeData[regime];
  if (!d || regime !== 'trademarket') {
    return { error: 'Extra permits can only be added during Cap & Trade.' };
  }
  const n = Math.floor(Number(perFirm));
  if (!Number.isFinite(n) || n <= 0) {
    return { error: 'Enter a whole number of one or more extra permits per firm.' };
  }
  for (let i = 0; i < state.config.numFirms; i++) {
    d.firms[i].permits += n;
  }
  if (!Array.isArray(d.offsetInjectLog)) d.offsetInjectLog = [];
  d.offsetInjectLog.push({ perFirm: n, roundIndex: d.currentRound });
  return { ok: true };
}

export function processPermitTrade(state, regime, seller, buyer, qty, price) {
  const d = state.regimeData[regime];
  const sellerFd = d.firms[seller];
  const buyerFd = d.firms[buyer];

  if (seller === buyer) return { error: 'Seller and buyer must be different firms.' };
  if (qty <= 0) return { error: 'Permits traded must be at least 1.' };
  if (price < 0) return { error: 'Price cannot be negative.' };
  if (sellerFd.permits < qty) {
    return { error: `Seller does not hold enough permits (has ${sellerFd.permits}, needs ${qty}).` };
  }
  const totalCost = qty * price;
  if (buyerFd.capital < totalCost) {
    return { error: `Buyer cannot afford this trade (needs $${totalCost}, has $${buyerFd.capital}).` };
  }

  sellerFd.permits -= qty;
  buyerFd.permits += qty;
  sellerFd.capital += totalCost;
  buyerFd.capital -= totalCost;
  sellerFd.totalProfit += totalCost;
  buyerFd.totalProfit -= totalCost;

  if (!d.trades) d.trades = [];
  d.trades.push({ seller, buyer, quantity: qty, price });

  return { ok: true };
}

/* ── Regime completion ── */

export function completeRegime(state, regime) {
  const seq = regimeSequence(state.config);
  if (!seq.includes(regime)) return;
  if (!state.completedRegimes.includes(regime)) {
    state.completedRegimes.push(regime);
  }
  const next = nextRegimeAfter(state.config, regime);
  if (next !== 'results' && !state.regimeData[next]) {
    state.regimeData[next] = initRegimeData(state.config);
    state.regimeData[next].firms.forEach(fd => {
      fd.capital = state.config.startCapital;
    });
  }
}

/* ── Deadweight loss ── */

export function computeDeadweightLoss(state, regime) {
  const d = state.regimeData[regime];
  if (!d || d.rounds.length === 0) return 0;

  const actualProfit = d.firms.reduce((s, f) => s + f.totalProfit, 0);
  const fmData = state.regimeData.freemarket;
  if (fmData && fmData.rounds.length > 0) {
    const fmProfit = fmData.firms.reduce((s, f) => s + f.totalProfit, 0);
    return Math.max(0, Math.round(fmProfit - actualProfit));
  }

  const maxUnconstrained = state.config.numFirms * state.config.startCapital
    * (Math.pow(2, state.config.numRounds) - 1);
  return Math.max(0, Math.round(maxUnconstrained - actualProfit));
}

/* ── Undo last round ── */

export function undoLastRound(state, regime) {
  const d = state.regimeData[regime];
  if (!d || d.rounds.length === 0) return false;

  const lastRound = d.rounds.pop();
  d.currentRound--;

  const isTax = regime === 'tax';
  const isTrade = regime === 'trade' || regime === 'trademarket';

  let roundPpmRemoved = 0;
  let roundTaxRemoved = 0;

  for (let i = 0; i < state.config.numFirms; i++) {
    const fd = d.firms[i];
    const p = lastRound.production[i];
    const cost = p * state.config.costPerUnit;
    const revenue = p * state.config.revenuePerUnit;
    let tax = 0;
    let cleanSetup = 0;

    if ((isTax || isTrade) && fd.cleanTech) {
      cleanSetup = state.config.cleanTechCost;
    }
    if (isTax) {
      const effectiveRate = fd.cleanTech ? state.config.taxRate / 2 : state.config.taxRate;
      tax = p * effectiveRate;
      roundTaxRemoved += tax;
    }

    const profit = revenue - cost - tax - cleanSetup;
    fd.capital = fd.capital + cost - revenue + tax + cleanSetup;
    fd.totalProduced -= p;
    fd.totalProfit -= profit;

    const ppmContrib = (p / 1000) * (fd.cleanTech ? state.config.ppmPer1000 / 2 : state.config.ppmPer1000);
    roundPpmRemoved += ppmContrib;
  }

  d.ppm -= roundPpmRemoved;
  d.totalTaxRevenue -= roundTaxRemoved;
  d.catastrophe = d.ppm >= state.config.triggerPpm;

  return true;
}
