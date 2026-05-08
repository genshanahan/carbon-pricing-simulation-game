/**
 * Regression test: verifies TEO ordering and catastrophe safety for all
 * supported firm counts (4-6) under greedy play with rational AI clean-tech.
 *
 * Run: node test-calibration.mjs
 */

import { strict as assert } from 'node:assert';
import {
  buildConfig, initRegimeData, processRound, setCleanTech,
  maxAllowedProduction, defaultPermitsPerFirm, processPermitTrade,
  permitsRemaining, unitsPerPermit, maxAffordable, computeTotalEconomicOutput,
} from './js/game-engine.js';

const PASS = '\x1b[32mPASS\x1b[0m';
const FAIL = '\x1b[31mFAIL\x1b[0m';
let failures = 0;

for (const numFirms of [4, 5, 6]) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`  ${numFirms} FIRMS`);
  console.log(`${'='.repeat(60)}`);

  const config = buildConfig({ numFirms, numRounds: 5 });
  console.log(`  startCapital=${config.startCapital}, cleanTechCost=${config.cleanTechCost}`);
  console.log(`  permitsPerFirm=${config.permitsPerFirm}, maxCleanTech=${config.maxCleanTech}`);
  console.log(`  cacCap=${config.cacCap}`);

  const maxPpmFromPermits = numFirms * config.permitsPerFirm * config.ppmPer1000;
  console.log(`  Max PPM from all permits: ${430 + maxPpmFromPermits}`);

  // --- Determine clean-tech allocation (mimic AI logic) ---
  // Strategic AI at indices 2 and 4 (if they exist). Player = index 0.
  const aiSlots = config.maxCleanTech - 1;
  const strategicIndices = [2, 4].filter(i => i < numFirms);
  const cleanFirms = strategicIndices.slice(0, aiSlots);
  const standardFirms = [];
  for (let i = 0; i < numFirms; i++) {
    if (!cleanFirms.includes(i)) standardFirms.push(i);
  }

  // --- Verify clean-tech NPV in Cap ---
  const capNpvState = { config, regimeData: { trade: initRegimeData(config) } };
  capNpvState.regimeData.trade.firms.forEach(fd => { fd.permits = config.permitsPerFirm; });

  function simulateProfit(startCap, isClean, permits) {
    let capital = startCap, produced = 0, totalProfit = 0;
    const upp = isClean ? 2000 : 1000;
    for (let r = 0; r < 5; r++) {
      const afford = Math.floor(capital / config.costPerUnit);
      const permitMax = Math.max(0, Math.floor((permits - produced / upp) * upp));
      const p = Math.min(afford, permitMax);
      const profit = p * (config.revenuePerUnit - config.costPerUnit);
      capital += profit;
      produced += p;
      totalProfit += profit;
    }
    return totalProfit;
  }

  const stdProfit = simulateProfit(config.startCapital, false, config.permitsPerFirm);
  const cleanProfit = simulateProfit(config.startCapital - config.cleanTechCost, true, config.permitsPerFirm) - config.cleanTechCost;
  const npvPositive = cleanProfit > stdProfit;
  console.log(`  Cap clean-tech NPV: clean=$${cleanProfit} vs std=$${stdProfit} → ${npvPositive ? PASS : FAIL}`);
  if (!npvPositive) failures++;

  // --- Simulate each regime under greedy play ---
  const teo = {};

  // Free Market
  {
    const state = { config, regimeData: { freemarket: initRegimeData(config) } };
    for (let r = 0; r < 5; r++) {
      const prod = state.regimeData.freemarket.firms.map(fd => maxAllowedProduction(fd, config, 'freemarket'));
      processRound(state, 'freemarket', prod);
    }
    teo.freemarket = computeTotalEconomicOutput(state, 'freemarket');
  }

  // C&C
  {
    const state = { config, regimeData: { cac: initRegimeData(config) } };
    for (let r = 0; r < 5; r++) {
      const prod = state.regimeData.cac.firms.map(fd => maxAllowedProduction(fd, config, 'cac'));
      processRound(state, 'cac', prod);
    }
    teo.cac = computeTotalEconomicOutput(state, 'cac');
  }

  // Tax (with clean-tech for strategic firms)
  {
    const state = { config, regimeData: { tax: initRegimeData(config) } };
    for (const i of cleanFirms) setCleanTech(state, 'tax', i);
    for (let r = 0; r < 5; r++) {
      const prod = state.regimeData.tax.firms.map(fd => maxAllowedProduction(fd, config, 'tax'));
      processRound(state, 'tax', prod);
    }
    teo.tax = computeTotalEconomicOutput(state, 'tax');
  }

  // Cap (with clean-tech for strategic firms)
  {
    const state = { config, regimeData: { trade: initRegimeData(config) } };
    state.regimeData.trade.firms.forEach(fd => { fd.permits = config.permitsPerFirm; });
    for (const i of cleanFirms) setCleanTech(state, 'trade', i);
    for (let r = 0; r < 5; r++) {
      const prod = state.regimeData.trade.firms.map(fd => maxAllowedProduction(fd, config, 'trade'));
      processRound(state, 'trade', prod);
    }
    teo.trade = computeTotalEconomicOutput(state, 'trade');
    const capPpm = state.regimeData.trade.ppm;
    const capSafe = capPpm < config.triggerPpm;
    console.log(`  Cap PPM: ${capPpm.toFixed(1)} → ${capSafe ? PASS : FAIL}`);
    if (!capSafe) failures++;
  }

  // Cap & Trade: C&T TEO = Cap TEO + value of surplus permits transferred.
  // Under Cap, clean firms end with unused permits (capital-constrained).
  // Under C&T, those surplus permits flow to standard firms who convert them
  // to production. Each surplus permit → 1000 units × $1 profit for the buyer.
  // The trade price is a zero-sum internal transfer (does not affect total TEO).
  // PPM safety: total permits unchanged, just reallocated — max PPM is the same.
  {
    // Re-use Cap state to find surplus permits on clean firms at end of game
    const capState = { config, regimeData: { trade: initRegimeData(config) } };
    capState.regimeData.trade.firms.forEach(fd => { fd.permits = config.permitsPerFirm; });
    for (const i of cleanFirms) setCleanTech(capState, 'trade', i);
    for (let r = 0; r < 5; r++) {
      const prod = capState.regimeData.trade.firms.map(fd => maxAllowedProduction(fd, config, 'trade'));
      processRound(capState, 'trade', prod);
    }
    let totalSurplus = 0;
    for (const i of cleanFirms) {
      const surplus = permitsRemaining(capState.regimeData.trade.firms[i]);
      totalSurplus += surplus;
    }
    // Each surplus permit enables 1000 units × $1 profit for a standard buyer
    const tradingGain = totalSurplus * 1000 * config.profitPerUnit;
    teo.trademarket = teo.trade + tradingGain;

    // PPM: all permits are used under optimal C&T (surplus transferred and used)
    const ctPpm = config.startPpm + numFirms * config.permitsPerFirm * config.ppmPer1000;
    const ctSafe = ctPpm <= config.triggerPpm;
    console.log(`  C&T PPM: ${ctPpm.toFixed(1)} → ${ctSafe ? PASS : FAIL}`);
    console.log(`  C&T surplus permits traded: ${totalSurplus.toFixed(2)} → gain $${tradingGain.toFixed(0)}`);
    if (!ctSafe) failures++;
  }

  // --- Check TEO ordering ---
  console.log(`\n  TEO Results:`);
  console.log(`    C&C:  $${teo.cac.toLocaleString()}`);
  console.log(`    Tax:  $${teo.tax.toLocaleString()}`);
  console.log(`    Cap:  $${teo.trade.toLocaleString()}`);
  console.log(`    C&T:  $${teo.trademarket.toLocaleString()}`);

  const ordering = teo.cac < teo.tax && teo.tax < teo.trade && teo.trade < teo.trademarket;
  console.log(`  Ordering C&C < Tax < Cap < C&T: ${ordering ? PASS : FAIL}`);
  if (!ordering) {
    failures++;
    if (teo.cac >= teo.tax) console.log(`    ${FAIL} C&C ($${teo.cac}) >= Tax ($${teo.tax})`);
    if (teo.tax >= teo.trade) console.log(`    ${FAIL} Tax ($${teo.tax}) >= Cap ($${teo.trade})`);
    if (teo.trade >= teo.trademarket) console.log(`    ${FAIL} Cap ($${teo.trade}) >= C&T ($${teo.trademarket})`);
  }

  // Free market must trigger catastrophe
  const fmCatastrophe = teo.freemarket !== undefined; // It always runs; check PPM
  {
    const state = { config, regimeData: { freemarket: initRegimeData(config) } };
    let triggered = false;
    for (let r = 0; r < 5; r++) {
      const prod = state.regimeData.freemarket.firms.map(fd => maxAllowedProduction(fd, config, 'freemarket'));
      processRound(state, 'freemarket', prod);
      if (state.regimeData.freemarket.catastrophe) { triggered = true; break; }
    }
    console.log(`  Free market catastrophe: ${triggered ? PASS : FAIL}`);
    if (!triggered) failures++;
  }
}

console.log(`\n${'='.repeat(60)}`);
if (failures === 0) {
  console.log(`  ALL CHECKS ${PASS}`);
} else {
  console.log(`  ${failures} CHECK(S) ${FAIL}`);
  process.exit(1);
}
