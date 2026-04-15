/**
 * Game Engine — pure state logic for the Carbon Pricing Simulation Game.
 * No DOM, no Firebase. Imported by both host and student apps.
 */

export const DEFAULTS = {
  numFirms: 5,
  numRounds: 5,
  startCapital: 1000,
  costPerUnit: 1,
  revenuePerUnit: 2,
  ppmPer1000: 2,
  startPpm: 380,
  triggerPpm: 450,
  taxRate: 0.80,
  cleanTechCost: 200,
};

export const REGIMES = ['freemarket', 'cac', 'tax', 'trade', 'trademarket'];

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

export function buildConfig(overrides = {}) {
  const c = { ...DEFAULTS, ...overrides };
  c.profitPerUnit = c.revenuePerUnit - c.costPerUnit;
  c.maxThingamabobs = (c.triggerPpm - c.startPpm) / c.ppmPer1000 * 1000;
  c.cacCap = Math.floor(c.maxThingamabobs / (c.numFirms * c.numRounds));
  return Object.freeze(c);
}

/* ── State creation ── */

export function createInitialState(config) {
  return {
    config,
    regime: 'setup',
    firms: createDefaultFirms(config.numFirms),
    completedRegimes: [],
    regimeData: {},
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
  if (!o.config || typeof o.config !== 'object') o.config = {};
  const mergedCfg = { ...DEFAULTS, ...o.config };
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

  return {
    currentRound: typeof rd.currentRound === 'number' ? rd.currentRound : 0,
    rounds: Array.isArray(rd.rounds) ? rd.rounds : [],
    firms,
    ppm: typeof rd.ppm === 'number' ? rd.ppm : base.ppm,
    catastrophe: typeof rd.catastrophe === 'boolean' ? rd.catastrophe : false,
    totalTaxRevenue: typeof rd.totalTaxRevenue === 'number' ? rd.totalTaxRevenue : 0,
    trades: Array.isArray(rd.trades) ? rd.trades : [],
    debriefActive: typeof rd.debriefActive === 'boolean' ? rd.debriefActive : false,
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

  for (let i = 0; i < config.numFirms; i++) {
    const fd = d.firms[i];
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
  d.rounds.push({
    production: [...clamped],
    totalProduction: totalProd,
    ppmAfter: d.ppm,
  });
  d.currentRound++;

  return { clamped, totalPpmAdded, roundTaxRevenue };
}

/* ── Permit trading ── */

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
  if (!state.completedRegimes.includes(regime)) {
    state.completedRegimes.push(regime);
  }
  const nextMap = { cac: 'tax', tax: 'trade', trade: 'trademarket' };
  const next = nextMap[regime];
  if (next && !state.regimeData[next]) {
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
