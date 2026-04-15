/**
 * AI Strategies — pure decision logic for solo-mode AI firms.
 * No DOM, no state mutation. Returns production quantities and trade decisions.
 */

import {
  maxAffordable, maxAllowedProduction, maxProductionFromPermits,
  unitsPerPermit, permitsRemaining, roundProfitDetailForFirm,
} from './game-engine.js';

/* ── Personality types ── */

export const PERSONALITIES = {
  aggressive: {
    id: 'aggressive',
    label: 'Aggressive',
    description: 'Always maximises immediate single-round profit. Never invests in clean technology. Demands a premium when selling permits.',
  },
  strategic: {
    id: 'strategic',
    label: 'Strategic',
    description: 'Evaluates decisions across all remaining rounds. Invests in clean technology when the long-run return is positive. Trades permits at fair value.',
  },
};

/**
 * Fixed assignment for 4 AI firms (indices 1–4, since player is 0).
 * 2 aggressive + 2 strategic for balanced pedagogy.
 */
export const AI_FIRM_PERSONALITIES = {
  1: 'aggressive',
  2: 'strategic',
  3: 'aggressive',
  4: 'strategic',
};

export function getPersonality(firmIndex) {
  return AI_FIRM_PERSONALITIES[firmIndex] || 'aggressive';
}

/* ── Production decisions ── */

export function aiProductionDecision(firmIndex, firmData, config, regime, regimeData) {
  return maxAllowedProduction(firmData, config, regime);
}

/* ── Clean-tech decisions ── */

/**
 * Decide which AI firms claim clean-tech, always leaving ≥1 slot for the player.
 * Returns an array of firm indices (among AI firms only) that should claim.
 */
export function aiCleanTechDecisions(config, regime, regimeData, playerFirmIndex) {
  const maxSlots = config.maxCleanTech || 2;
  const reservedForPlayer = 1;
  const aiSlots = maxSlots - reservedForPlayer;
  if (aiSlots <= 0) return [];

  const aiFirms = [];
  for (let i = 0; i < config.numFirms; i++) {
    if (i === playerFirmIndex) continue;
    aiFirms.push(i);
  }

  const candidates = aiFirms
    .filter(i => getPersonality(i) === 'strategic')
    .filter(i => cleanTechNpvPositive(regimeData.firms[i], config, regime, config.numRounds));

  if (candidates.length <= aiSlots) return candidates;
  return candidates.slice(0, aiSlots);
}

/**
 * NPV check: is clean-tech profitable over N remaining rounds?
 * Compares total profit with clean-tech vs standard across all rounds,
 * assuming max production each round with compounding capital.
 */
function cleanTechNpvPositive(firmData, config, regime, roundsRemaining) {
  let capitalClean = firmData.capital;
  let capitalStd = firmData.capital;
  let totalClean = 0;
  let totalStd = 0;

  for (let r = 0; r < roundsRemaining; r++) {
    const prodStd = Math.floor(capitalStd / config.costPerUnit);
    const detailStd = roundProfitDetailForFirm(regime, config, { cleanTech: false }, prodStd);
    totalStd += detailStd.profit;
    capitalStd += detailStd.profit;

    const prodClean = Math.floor(capitalClean / config.costPerUnit);
    const detailClean = roundProfitDetailForFirm(regime, config, { cleanTech: true }, prodClean);
    totalClean += detailClean.profit;
    capitalClean += detailClean.profit;
  }

  return totalClean > totalStd;
}

/* ── Permit trade reservation prices ── */

/**
 * Compute the reservation price for an AI firm (the minimum price at which
 * it would sell a permit, or equivalently the value of using that permit).
 *
 * Aggressive firms add a 20% markup; strategic firms trade at fair value.
 */
export function aiReservationPrice(firmIndex, firmData, config, regime) {
  const upp = unitsPerPermit(firmData);
  const setup = firmData.cleanTech ? config.cleanTechCost : 0;
  const gross = upp * config.profitPerUnit;
  const fairValue = Math.max(0, gross - setup);

  const personality = getPersonality(firmIndex);
  if (personality === 'aggressive') {
    return Math.round(fairValue * 1.2);
  }
  return fairValue;
}

/**
 * Would this AI firm accept a proposed trade?
 * - As seller: accepts if offered price >= reservation price
 * - As buyer: accepts if offered price <= reservation price
 * Also checks the firm actually has the permits/capital.
 */
export function aiEvaluateTrade(firmIndex, firmData, config, regime, role, quantity, pricePerPermit) {
  const reservation = aiReservationPrice(firmIndex, firmData, config, regime);

  if (role === 'sell') {
    const remaining = permitsRemaining(firmData);
    if (remaining < quantity) {
      return { accept: false, reason: `This firm only has ${remaining} permit(s) available to sell.` };
    }
    if (pricePerPermit < reservation) {
      return { accept: false, reason: `Price of $${pricePerPermit} is below this firm's reservation price of $${reservation}. They would earn more by using the permits for production.` };
    }
    return { accept: true };
  }

  if (role === 'buy') {
    const totalCost = quantity * pricePerPermit;
    if (firmData.capital < totalCost) {
      return { accept: false, reason: `This firm cannot afford $${totalCost} (capital: $${firmData.capital}).` };
    }
    if (pricePerPermit > reservation) {
      return { accept: false, reason: `Price of $${pricePerPermit} exceeds this firm's maximum willingness to pay of $${reservation}. The permits aren't worth that much to them.` };
    }
    return { accept: true };
  }

  return { accept: false, reason: 'Invalid trade role.' };
}
