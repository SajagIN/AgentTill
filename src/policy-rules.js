const p = (paise) => `${paise} paise`;

const rule = (id, params, appliesTo, description, evaluate) => ({
  id, params, appliesTo, description, evaluate,
});

const BASKET_LIMIT_PAISE = 250000;       // ₹2,500
const HOURLY_CAP_PAISE = 500000;         // ₹5,000
const VELOCITY_MAX = 4;                  // checkout attempts per hour
const ALLOWED_CATEGORIES = ["office", "it", "supplies"];
const APPROVAL_THRESHOLD_PAISE = 100000; // ₹1,000

export const POLICY_RULES = [
  rule(
    "max_basket_value",
    { limitPaise: BASKET_LIMIT_PAISE },
    ["create_order", "retry_payment"],
    "Single checkout total must not exceed the basket limit.",
    ({ amountPaise }) =>
      amountPaise > BASKET_LIMIT_PAISE
        ? { outcome: "fail", detail: `cart ${p(amountPaise)} exceeds max basket ${p(BASKET_LIMIT_PAISE)}` }
        : { outcome: "pass", detail: `cart ${p(amountPaise)} within max basket ${p(BASKET_LIMIT_PAISE)}` },
  ),
  rule(
    "hourly_spend_cap",
    { limitPaise: HOURLY_CAP_PAISE },
    ["create_order", "retry_payment"],
    "Allowed spend in the trailing hour plus this amount must not exceed the cap.",
    ({ amountPaise, ctx }) => {
      const spent = ctx?.window?.spentLastHourPaise ?? 0;
      return spent + amountPaise > HOURLY_CAP_PAISE
        ? { outcome: "fail", detail: `hourly spend would reach ${p(spent + amountPaise)}, over cap ${p(HOURLY_CAP_PAISE)} (already spent ${p(spent)})` }
        : { outcome: "pass", detail: `hourly spend would reach ${p(spent + amountPaise)}, within cap ${p(HOURLY_CAP_PAISE)}` };
    },
  ),
  rule(
    "velocity_max_checkouts_per_hour",
    { maxCheckouts: VELOCITY_MAX },
    ["create_order", "retry_payment"],
    "At most N checkout attempts in the trailing hour.",
    ({ ctx }) => {
      const prior = ctx?.window?.checkoutsLastHour ?? 0;
      return prior >= VELOCITY_MAX
        ? { outcome: "fail", detail: `velocity: ${prior} checkout attempts in the last hour (max ${VELOCITY_MAX})` }
        : { outcome: "pass", detail: `velocity: ${prior} prior attempts in the last hour (max ${VELOCITY_MAX})` };
    },
  ),
  rule(
    "category_allowlist",
    { categories: ALLOWED_CATEGORIES },
    ["create_order", "retry_payment"],
    "Every cart line's category must be in the allowlist.",
    ({ ctx }) => {
      const lines = ctx?.cart ?? [];
      if (lines.length === 0) return { outcome: "pass", detail: "no cart lines to check" };
      const offender = lines.find((l) => !ALLOWED_CATEGORIES.includes(l.category));
      return offender
        ? { outcome: "fail", detail: `category "${offender.category}" is not allowlisted (sku ${offender.sku}; allowed: ${ALLOWED_CATEGORIES.join(", ")})` }
        : { outcome: "pass", detail: `all ${lines.length} line(s) in allowlisted categories` };
    },
  ),
  rule(
    "approval_above",
    { thresholdPaise: APPROVAL_THRESHOLD_PAISE },
    ["create_order", "retry_payment"],
    "Amount strictly above the threshold requires human approval before proceeding.",
    ({ amountPaise, ctx }) => {
      if (ctx?.approvalResolved) {
        return { outcome: "pass", detail: "human approval already granted for this attempt — gate satisfied" };
      }
      return amountPaise > APPROVAL_THRESHOLD_PAISE
        ? { outcome: "triggered", detail: `amount ${p(amountPaise)} is above approval threshold ${p(APPROVAL_THRESHOLD_PAISE)}` }
        : { outcome: "pass", detail: `amount ${p(amountPaise)} at or below approval threshold ${p(APPROVAL_THRESHOLD_PAISE)}` };
    },
  ),
  rule(
    "mission_budget",
    {},
    ["create_order", "retry_payment"],
    "Cart total must not exceed the mission's budget when one is set.",
    ({ amountPaise, ctx }) => {
      const budget = ctx?.missionBudgetPaise;
      if (budget === null || budget === undefined) {
        return { outcome: "pass", detail: "no mission budget set (unbounded mission)" };
      }
      return amountPaise > budget
        ? { outcome: "fail", detail: `cart ${p(amountPaise)} exceeds mission budget ${p(budget)}` }
        : { outcome: "pass", detail: `cart ${p(amountPaise)} within mission budget ${p(budget)}` };
    },
  ),
];

export const RULES_VERSION = "rules-v2-real";
