/**
 * AI Strategies — pure decision logic for solo-mode AI firms.
 * No DOM, no state mutation. Returns production quantities and trade decisions.
 */

import {
  maxAffordable, maxAllowedProduction, maxProductionFromPermits,
  unitsPerPermit, permitsRemaining, roundProfitDetailForFirm,
  defaultPermitsPerFirm, processPermitTrade,
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
 * Compares total profit (including the sunk investment) with clean-tech
 * vs standard across all rounds, simulating max production each round with
 * compounding capital AND permit constraints in cap-based regimes.
 */
function cleanTechNpvPositive(firmData, config, regime, roundsRemaining) {
  const isPermitRegime = regime === 'trade' || regime === 'trademarket';
  const permits = isPermitRegime ? defaultPermitsPerFirm(config) : Infinity;

  let capitalClean = firmData.capital - config.cleanTechCost;
  let capitalStd = firmData.capital;
  let totalClean = -config.cleanTechCost;
  let totalStd = 0;
  let producedStd = 0;
  let producedClean = 0;

  if (capitalClean < 0) return false;

  for (let r = 0; r < roundsRemaining; r++) {
    const affordStd = Math.floor(capitalStd / config.costPerUnit);
    const fromPermitsStd = isPermitRegime
      ? Math.max(0, Math.floor((permits - producedStd / 1000) * 1000))
      : Infinity;
    const prodStd = Math.min(affordStd, fromPermitsStd);
    const detailStd = roundProfitDetailForFirm(regime, config, { cleanTech: false }, prodStd);
    totalStd += detailStd.profit;
    capitalStd += detailStd.profit;
    producedStd += prodStd;

    const affordClean = Math.floor(capitalClean / config.costPerUnit);
    const fromPermitsClean = isPermitRegime
      ? Math.max(0, Math.floor((permits - producedClean / 2000) * 2000))
      : Infinity;
    const prodClean = Math.min(affordClean, fromPermitsClean);
    const detailClean = roundProfitDetailForFirm(regime, config, { cleanTech: true }, prodClean);
    totalClean += detailClean.profit;
    capitalClean += detailClean.profit;
    producedClean += prodClean;
  }

  return totalClean > totalStd;
}

/* ── Permit trade reservation prices ── */

/**
 * Compute the reservation price for an AI firm — the minimum price at which
 * it would sell a permit, or equivalently the maximum it would pay to buy one.
 *
 * With the sunk-cost clean-tech model, a firm with slack permits (more permits
 * than it can use given its capital) values the marginal permit at $0 — it
 * would sell for any positive price. A permit-constrained firm values the
 * marginal permit at the gross production profit it enables.
 *
 * Aggressive firms add a 20 % markup when permit-constrained.
 */
export function aiReservationPrice(firmIndex, firmData, config, regime) {
  const remaining = permitsRemaining(firmData);
  const afford = maxAffordable(firmData, config);

  if (remaining > 0 && afford <= 0) return 0;

  const upp = unitsPerPermit(firmData);
  const canProduceFromPermits = remaining * upp;
  if (canProduceFromPermits > afford) return 0;

  const grossPermitValue = upp * config.profitPerUnit;
  const personality = getPersonality(firmIndex);
  if (personality === 'aggressive') {
    return Math.round(grossPermitValue * 1.2);
  }
  return grossPermitValue;
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

/**
 * Compute how many permits a firm will genuinely never use over its remaining
 * rounds. A forward-looking firm simulates production with compounding capital
 * and only considers permits truly surplus if they remain unused at game end.
 */
function genuineSurplusPermits(firmData, config, roundsRemaining) {
  const upp = unitsPerPermit(firmData);
  const remaining = permitsRemaining(firmData);
  if (remaining <= 0 || roundsRemaining <= 0) return 0;

  let capital = firmData.capital;
  let usedInFuture = 0;
  for (let r = 0; r < roundsRemaining; r++) {
    const afford = Math.floor(capital / config.costPerUnit);
    const fromPermits = Math.max(0, Math.floor((remaining - usedInFuture) * upp));
    const prod = Math.min(afford, fromPermits);
    capital += prod * config.profitPerUnit;
    usedInFuture += prod / upp;
  }
  return Math.max(0, remaining - usedInFuture);
}

/**
 * Execute automatic AI-to-AI permit trades for the trademarket regime.
 * Simulates the bilateral negotiation that would happen between students
 * in a facilitated classroom. Called after each round of production.
 *
 * Uses forward-looking surplus: AI firms only sell permits they genuinely
 * won't use in remaining rounds, ensuring trades create real efficiency
 * gains. Fractional permits may be traded (matching the precision of the
 * surplus calculation).
 *
 * Returns an array of { seller, buyer, quantity, price } for logging.
 */
export function executeAiTrades(state, regime, playerFirmIndex) {
  if (regime !== 'trademarket') return [];
  const config = state.config;
  const d = state.regimeData[regime];
  const roundsRemaining = config.numRounds - d.currentRound;
  if (roundsRemaining <= 0) return [];
  const trades = [];

  let changed = true;
  while (changed) {
    changed = false;

    const sellers = [];
    const buyers = [];
    for (let i = 0; i < config.numFirms; i++) {
      if (i === playerFirmIndex) continue;
      const fd = d.firms[i];
      const surplus = genuineSurplusPermits(fd, config, roundsRemaining);
      if (surplus >= 0.1) {
        sellers.push({ index: i, surplus });
      } else {
        const rem = permitsRemaining(fd);
        const res = aiReservationPrice(i, fd, config, regime);
        if (rem <= 0 && res > 0 && fd.capital > 0) {
          buyers.push({ index: i, reservation: res });
        }
      }
    }

    if (sellers.length === 0 || buyers.length === 0) break;

    buyers.sort((a, b) => b.reservation - a.reservation);

    for (const buyer of buyers) {
      if (sellers.length === 0) break;
      const seller = sellers[0];
      if (seller.surplus < 0.1) { sellers.shift(); continue; }

      const qty = Math.round(Math.min(seller.surplus, 1) * 10) / 10;
      const pricePerPermit = Math.round(buyer.reservation / 2);
      const totalCost = Math.round(qty * pricePerPermit);
      if (d.firms[buyer.index].capital < totalCost) continue;

      const result = processPermitTrade(state, regime, seller.index, buyer.index, qty, pricePerPermit);
      if (result.error) continue;

      trades.push({ seller: seller.index, buyer: buyer.index, quantity: qty, price: pricePerPermit });
      seller.surplus -= qty;
      if (seller.surplus < 0.1) sellers.shift();
      changed = true;
      break;
    }
  }

  return trades;
}
