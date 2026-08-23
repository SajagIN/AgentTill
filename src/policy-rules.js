/**
 * Policy rule DEFINITIONS — data, not control flow. The engine
 * (policy-engine.js) reads this table; rules never branch inside the engine's
 * orchestration. Phase 2 ships the data so thresholds are visible early; the
 * engine starts EVALUATING them in Phase 4.
 *
 * Params are integer paise / counts (M1 — never rupee floats).
 */

/** @type {Array<{id:string, params:object, description:string}>} */
export const POLICY_RULES = [
  {
    id: "max_basket_value",
    params: { limitPaise: 250000 },
    description: "Single checkout total must not exceed ₹2,500.00 (exact-equal passes)",
  },
  {
    id: "hourly_spend_cap",
    params: { limitPaise: 500000 },
    description: "Sum of allowed checkouts in the trailing hour must not exceed ₹5,000.00",
  },
  {
    id: "velocity_max_checkouts_per_hour",
    params: { maxCheckouts: 4 },
    description: "At most 4 checkout attempts in the trailing hour (retries count)",
  },
  {
    id: "category_allowlist",
    params: { categories: ["office", "it", "supplies"] },
    description: "Every cart line's category must be allowlisted (catering is denied — demo ammo)",
  },
  {
    id: "approval_above",
    params: { thresholdPaise: 100000 },
    description: "Checkout above ₹1,000.00 pauses the mission for human approval (exact-equal passes)",
  },
];

/** Rule-set version — stamped into audit decisions for replay honesty. */
export const RULES_VERSION = "rules-v1-data-only";
