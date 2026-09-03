import * as tools from './tools.js';

function extractKeywords(intent) {
  // Remove common prefixes and split by comma or "and"
  const cleaned = intent
    .replace(/^(restock|buy|order|get|purchase):\s*/i, '')
    .replace(/\s+and\s+/gi, ',');
  return cleaned.split(',')
    .map(k => {
      let word = k.trim().toLowerCase();
      // Strip trailing 's' or 'es' to handle basic plurals matching singular catalog
      if (word.endsWith('es')) word = word.slice(0, -2);
      else if (word.endsWith('s')) word = word.slice(0, -1);
      return word;
    })
    .filter(k => k.length > 0);
}

export async function runMission(mission) {
  let attempt = 0;
  const maxAttempts = 12;
  let rePlans = 0;
  const maxRePlans = 2; // replan on denial limit
  let excludedSkus = new Set();

  while (attempt < maxAttempts) {
    try {
      // Check status if we're waiting for confirmation
      const stateCheck = await tools.getMissionStatus(mission.missionId).catch(() => null);
      if (stateCheck && stateCheck.mission && stateCheck.mission.state === 'CONFIRMED') {
        console.log('[agent] Mission reached CONFIRMED state. Success.');
        return { status: 'success', missionId: mission.missionId };
      }

      // Extract keywords from intent and search for each
      const keywords = extractKeywords(mission.intent);
      let allProducts = [];

      for (const keyword of keywords) {
        const products = await tools.searchCatalog(keyword);
        if (products && products.length > 0) {
          // Take first match that is not excluded
          const prod = products.find(p => !excludedSkus.has(p.sku));
          if (prod) allProducts.push(prod);
        }
      }

      // Fallback: if no keywords found, try the full intent
      if (allProducts.length === 0) {
        const exactMatch = await tools.searchCatalog(mission.intent);
        if (exactMatch && exactMatch.length > 0) {
           const prod = exactMatch.find(p => !excludedSkus.has(p.sku));
           if (prod) allProducts.push(prod);
        }
      }

      if (!allProducts || allProducts.length === 0) {
        console.log(`[agent] No acceptable products found for intent: ${mission.intent}`);
        return null;
      }

      let items = [];
      let estimatedTotal = 0;

      for (const p of allProducts) {
        if (mission.budgetPaise && estimatedTotal + p.pricePaise > mission.budgetPaise) {
          continue; // Skip if it exceeds budget
        }
        items.push({ sku: p.sku, qty: 1 });
        estimatedTotal += p.pricePaise;
        if (items.length >= 3) break;
      }

      if (items.length === 0) {
        console.log('[agent] No items fit within budget');
        return null; // hard fail if nothing fits
      }

      const quoteResult = await tools.getQuote(items);
      console.log(`[agent] Quoted ${quoteResult.totalPaise} paise for ${items.length} items (Attempt ${attempt + 1})`);

      const result = await tools.beginCheckout(quoteResult.cartId, mission.missionId);

      if (result.status === 'needs_approval') {
        console.log(`[agent] Checkout needs approval: ${result.approvalId}`);
        // DO NOT auto-approve. Return and let human handle it.
        return result;
      }

      if (result.status === 'denied') {
        console.log('[agent] Checkout denied:', result.error?.message || result.reason);

        const reasonStr = (result.error?.message || result.reason || "").toLowerCase();

        if (reasonStr.includes('velocity')) {
           console.log('[agent] Velocity limit reached. Waiting for limits to reset...');
           return { status: 'denied', reason: 'velocity_limit' };
        }

        if (rePlans < maxRePlans) {
          rePlans++;
          console.log(`[agent] Re-planning... (${rePlans}/${maxRePlans}) - dropping most expensive item to respect policy limits.`);
          // Drop most expensive item from excluded list and try again
          const sorted = allProducts.sort((a,b) => b.pricePaise - a.pricePaise);
          if (sorted.length > 0) excludedSkus.add(sorted[0].sku);
          attempt++;
          continue;
        }
        console.log('[agent] Max replans reached. Giving up.');
        return null;
      }

      if (result.status === 'created') {
        console.log('[agent] Order created:', result.orderId);
        // Wait for webhook (success flow)
        console.log('[agent] Waiting for payment confirmation...');
        for (let wait=0; wait<20; wait++) {
          await new Promise(r => setTimeout(r, 2000));
          const mCheck = await tools.getMissionStatus(mission.missionId).catch(() => null);
          if (mCheck && mCheck.mission && mCheck.mission.state === 'CONFIRMED') {
            console.log('[agent] Mission confirmed successfully.');
            result.status = 'success';
            return result;
          }
        }
        console.log('[agent] Timed out waiting for CONFIRMED state.');
        return result;
      }

      console.log('[agent] Unknown checkout status:', result.status);
      return null;

    } catch (error) {
      attempt++;
      console.error(`[agent] Attempt ${attempt} failed:`, error.message);

      // Razorpay test mode rate limit — surface cleanly, don't retry
      if (error.status === 429 || (error.body?.error?.code === 'RATE_LIMIT_EXCEEDED') || error.message.includes('RATE_LIMIT_EXCEEDED')) {
        console.error('[agent] Razorpay test mode payment link limit reached (30/hour in test mode)');
        console.error('[agent] Visit https://dashboard.razorpay.com/app/test/payment-links to view existing links');
        return { status: 'rate_limited', message: error.message };
      }

      if (attempt < maxAttempts) {
        const backoffMs = Math.pow(attempt, 2) * 1000;
        console.log(`[agent] Retrying in ${backoffMs}ms...`);
        await new Promise(r => setTimeout(r, backoffMs));
      } else {
        console.error('[agent] Max attempts reached, giving up');
        throw error;
      }
    }
  }

  return null;
}
