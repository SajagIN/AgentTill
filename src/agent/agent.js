import * as tools from './tools.js';

function extractKeywords(intent) {
  // Remove common prefixes and split by comma or "and"
  const cleaned = intent
    .replace(/^(restock|buy|order|get|purchase):\s*/i, '')
    .replace(/\s+and\s+/gi, ',');
  return cleaned.split(',')
    .map(k => k.trim().toLowerCase())
    .filter(k => k.length > 0);
}

export async function runMission(mission) {
  let attempt = 0;
  const maxAttempts = 3;

  while (attempt < maxAttempts) {
    try {
      // Extract keywords from intent and search for each
      const keywords = extractKeywords(mission.intent);
      let allProducts = [];

      for (const keyword of keywords) {
        const products = await tools.searchCatalog(keyword);
        if (products && products.length > 0) {
          // Take first match for each keyword
          allProducts.push(products[0]);
        }
      }

      // Fallback: if no keywords found, try the full intent
      if (allProducts.length === 0) {
        allProducts = await tools.searchCatalog(mission.intent);
      }

      if (!allProducts || allProducts.length === 0) {
        console.log(`[agent] No products found for intent: ${mission.intent}`);
        return null;
      }

      let items = [];
      let estimatedTotal = 0;

      for (const p of allProducts) {
        if (mission.budgetPaise && estimatedTotal + p.pricePaise > mission.budgetPaise) {
          continue;
        }
        items.push({ sku: p.sku, qty: 1 });
        estimatedTotal += p.pricePaise;
        if (items.length >= 3) break;
      }

      if (items.length === 0) {
        console.log('[agent] No items fit within budget');
        return null;
      }

      const quoteResult = await tools.getQuote(items);
      console.log(`[agent] Quoted ${quoteResult.totalPaise} paise for ${items.length} items`);

      const result = await tools.beginCheckout(quoteResult.cartId, mission.missionId);

      if (result.status === 'needs_approval') {
        console.log(`[agent] Checkout needs approval: ${result.approvalId}`);
        const approvalResult = await tools.approve(result.approvalId);
        console.log('[agent] Approval resolved:', approvalResult.approval?.status);
        return approvalResult.checkout;
      }

      if (result.status === 'denied') {
        console.log('[agent] Checkout denied:', result.reason);
        return null;
      }

      if (result.status === 'created') {
        console.log('[agent] Order created:', result.orderId);
        return result;
      }

      console.log('[agent] Unknown checkout status:', result.status);
      return null;

    } catch (error) {
      attempt++;
      console.error(`[agent] Attempt ${attempt} failed:`, error.message);

      // Razorpay test mode rate limit — surface cleanly, don't retry
      if (error.status === 429 || (error.body?.error?.code === 'RATE_LIMIT_EXCEEDED')) {
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
