import * as tools from "./tools.js";

/** Terminal mission states — the agent must not fight the state machine over these. */
const TERMINAL = new Set(["CONFIRMED", "CANCELLED", "REFUNDED", "ESCALATED", "FAILED_FINAL"]);

const MAX_ITEMS_PER_CART = 3;
const MAX_REPLANS = 2;
const MAX_ATTEMPTS = 3;
const CONFIRM_POLL_INTERVAL_MS = 2000;
const CONFIRM_POLLS = 20;

/**
 * Split a human intent like "restock: notebooks, markers and coffee" into the
 * catalog keywords the agent will search for.
 */
export function extractKeywords(intent) {
  return intent
    .replace(/^(restock|buy|order|get|purchase)\s*:?/i, "")
    .replace(/\s+and\s+/gi, ",")
    .split(",")
    .map((part) => {
      const word = part.trim().toLowerCase();
      if (word.endsWith("es")) return word.slice(0, -2);
      if (word.endsWith("s")) return word.slice(0, -1);
      return word;
    })
    .filter((word) => word.length > 0);
}

async function planCart(mission, excludedSkus) {
  const keywords = extractKeywords(mission.intent);
  const matches = [];

  for (const keyword of keywords) {
    const found = await tools.searchCatalog(keyword);
    const product = found.find((p) => !excludedSkus.has(p.sku));
    if (product) matches.push(product);
  }

  if (matches.length === 0) {
    const found = await tools.searchCatalog(mission.intent);
    const product = found.find((p) => !excludedSkus.has(p.sku));
    if (product) matches.push(product);
  }

  const items = [];
  let estimatedPaise = 0;
  for (const product of matches) {
    if (mission.budgetPaise && estimatedPaise + product.pricePaise > mission.budgetPaise) continue;
    items.push({ sku: product.sku, qty: 1 });
    estimatedPaise += product.pricePaise;
    if (items.length >= MAX_ITEMS_PER_CART) break;
  }

  return { matches, items, estimatedPaise };
}

async function waitForConfirmation(missionId) {
  for (let poll = 0; poll < CONFIRM_POLLS; poll += 1) {
    await new Promise((resolve) => setTimeout(resolve, CONFIRM_POLL_INTERVAL_MS));
    const check = await tools.getMissionStatus(missionId).catch(() => null);
    if (check?.mission?.state === "CONFIRMED") return true;
  }
  return false;
}

/**
 * Drive one mission from PLANNING to a payment attempt.
 *
 * The agent never sets a price and never approves its own gated checkout — it
 * proposes a cart and the deterministic money layer decides.
 *
 * @param {{missionId:string, intent:string, budgetPaise:number|null}} mission
 * @returns {Promise<object>} always resolves to `{ status, ... }`; never null.
 */
export async function runMission(mission) {
  const excludedSkus = new Set();
  let replans = 0;

  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    let plan;
    try {
      plan = await planCart(mission, excludedSkus);
    } catch (err) {
      return { status: "api_error", message: err.message, attempt };
    }

    if (plan.matches.length === 0) {
      console.log(`[agent] no catalog match for intent "${mission.intent}"`);
      return { status: "no_products", message: "no catalog product matched the intent" };
    }
    if (plan.items.length === 0) {
      console.log(`[agent] nothing fits the ₹${((mission.budgetPaise ?? 0) / 100).toFixed(2)} budget`);
      return { status: "budget_exhausted", message: "every match exceeded the mission budget" };
    }

    let quote;
    let checkout;
    try {
      quote = await tools.getQuote(plan.items);
      console.log(`[agent] quoted ${quote.totalPaise} paise for ${plan.items.length} item(s) · attempt ${attempt}`);
      checkout = await tools.beginCheckout(quote.cartId, mission.missionId);
    } catch (err) {
      if (err.status === 429 || err.code === "RATE_LIMIT_EXCEEDED" || err.message.includes("RATE_LIMIT_EXCEEDED")) {
        console.error("[agent] Razorpay test-mode limit reached (30 payment links/hour)");
        return { status: "rate_limited", message: err.message };
      }
      if (!err.retryable) {
        console.error(`[agent] non-retryable failure: ${err.message}`);
        return { status: "api_error", message: err.message, attempt };
      }
      if (attempt >= MAX_ATTEMPTS) {
        console.error(`[agent] giving up after ${MAX_ATTEMPTS} attempts: ${err.message}`);
        return { status: "api_error", message: err.message, attempt };
      }
      const backoffMs = attempt ** 2 * 1000;
      console.error(`[agent] attempt ${attempt} failed (${err.message}) — retrying in ${backoffMs}ms`);
      await new Promise((resolve) => setTimeout(resolve, backoffMs));
      continue;
    }

    if (checkout.status === "needs_approval") {
      console.log(`[agent] gated — approval ${checkout.approvalId} required; leaving it to a human`);
      return { status: "needs_approval", ...checkout };
    }

    if (checkout.status === "denied") {
      const reason = checkout.error?.message ?? checkout.reason ?? "";
      if (reason.toLowerCase().includes("velocity")) {
        console.log("[agent] velocity limit reached — stopping until the window resets");
        return { status: "denied", reason: "velocity_limit", message: reason, ruleEvals: checkout.ruleEvals };
      }
      if (replans < MAX_REPLANS) {
        replans += 1;
        const dropped = [...plan.matches].sort((a, b) => b.pricePaise - a.pricePaise)[0];
        excludedSkus.add(dropped.sku);
        console.log(`[agent] denied (${reason}) — re-planning ${replans}/${MAX_REPLANS}, dropping ${dropped.sku}`);
        continue;
      }
      console.log(`[agent] denied and out of re-plans: ${reason}`);
      return { status: "denied", reason, ruleEvals: checkout.ruleEvals };
    }

    if (checkout.status === "created") {
      console.log(`[agent] order ${checkout.orderId} created — waiting for payment confirmation`);
      const confirmed = await waitForConfirmation(mission.missionId);
      return { ...checkout, status: confirmed ? "success" : "awaiting_payment" };
    }

    return { status: "unexpected_response", message: `checkout returned status "${checkout.status}"` };
  }

  return { status: "attempts_exhausted", message: `gave up after ${MAX_ATTEMPTS} attempts` };
}

export { TERMINAL };
