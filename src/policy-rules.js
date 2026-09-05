import { getPolicyConfig } from "./db.js";
import { getMandate } from "./mandates.js";

const p = (paise) => `${paise} paise`;

const rule = (id, appliesTo, description, evaluate) => ({
  id, appliesTo, description, evaluate,
});

export const POLICY_RULES = [
  {
    id: "mandate_ceiling",
    appliesTo: ["create_order"],
    params: {},
    evaluate({ actorId, amountPaise }) {
      const mandate = getMandate(actorId);
      if (!mandate) return { outcome: "pass", detail: "no active mandate for actor" };
      if (amountPaise > mandate.max_amount_paise) {
         return { outcome: "fail", detail: `Order total (${amountPaise}) exceeds mandate ceiling (${mandate.max_amount_paise})` };
      }
      return { outcome: "pass", detail: "within mandate ceiling" };
    }
  },
  rule(
    "max_basket_value",
    ["create_order", "retry_payment"],
    "Single checkout total must not exceed the basket limit.",
    ({ amountPaise }) => {
      const limitPaise = getPolicyConfig("max_basket_value", { limitPaise: 250000 }).limitPaise;
      return amountPaise > limitPaise
        ? { outcome: "fail", detail: `cart ${p(amountPaise)} exceeds max basket ${p(limitPaise)}` }
        : { outcome: "pass", detail: `cart ${p(amountPaise)} within max basket ${p(limitPaise)}` };
    }
  ),
  rule(
    "hourly_spend_cap",
    ["create_order", "retry_payment"],
    "Allowed spend in the trailing hour plus this amount must not exceed the cap.",
    ({ amountPaise, ctx }) => {
      const limitPaise = getPolicyConfig("hourly_spend_cap", { limitPaise: 500000 }).limitPaise;
      const spent = ctx?.window?.spentLastHourPaise ?? 0;
      return spent + amountPaise > limitPaise
        ? { outcome: "fail", detail: `hourly spend would reach ${p(spent + amountPaise)}, over cap ${p(limitPaise)} (already spent ${p(spent)})` }
        : { outcome: "pass", detail: `hourly spend would reach ${p(spent + amountPaise)}, within cap ${p(limitPaise)}` };
    },
  ),
  rule(
    "velocity_max_checkouts_per_hour",
    ["create_order", "retry_payment"],
    "At most N checkout attempts in the trailing hour.",
    ({ ctx }) => {
      const maxCheckouts = getPolicyConfig("velocity_max_checkouts", { maxCheckouts: 4 }).maxCheckouts;
      const prior = ctx?.window?.checkoutsLastHour ?? 0;
      return prior >= maxCheckouts
        ? { outcome: "fail", detail: `velocity: ${prior} checkout attempts in the last hour (max ${maxCheckouts})` }
        : { outcome: "pass", detail: `velocity: ${prior} prior attempts in the last hour (max ${maxCheckouts})` };
    },
  ),
  rule(
    "category_allowlist",
    ["create_order", "retry_payment"],
    "Every cart line's category must be in the allowlist.",
    ({ ctx }) => {
      const categories = getPolicyConfig("category_allowlist", { categories: ["office", "it", "supplies"] }).categories;
      const lines = ctx?.cart ?? [];
      if (lines.length === 0) return { outcome: "pass", detail: "no cart lines to check" };
      const offender = lines.find((l) => !categories.includes(l.category));
      return offender
        ? { outcome: "fail", detail: `category "${offender.category}" is not allowlisted (sku ${offender.sku}; allowed: ${categories.join(", ")})` }
        : { outcome: "pass", detail: `all ${lines.length} line(s) in allowlisted categories` };
    },
  ),
  rule(
    "approval_above",
    ["create_order", "retry_payment"],
    "Amount strictly above the threshold requires human approval before proceeding.",
    ({ actorId, amountPaise, ctx }) => {
      const thresholdPaise = getPolicyConfig("approval_above", { thresholdPaise: 100000 }).thresholdPaise;
      if (ctx?.approvalResolved) {
        return { outcome: "pass", detail: "human approval already granted for this attempt — gate satisfied" };
      }
      const mandate = getMandate(actorId);
      if (mandate && amountPaise <= mandate.max_amount_paise) {
        return { outcome: "pass", detail: `mandate active for ${p(mandate.max_amount_paise)} covering amount ${p(amountPaise)}` };
      }
      return amountPaise > thresholdPaise
        ? { outcome: "triggered", detail: `amount ${p(amountPaise)} is above approval threshold ${p(thresholdPaise)}` }
        : { outcome: "pass", detail: `amount ${p(amountPaise)} at or below approval threshold ${p(thresholdPaise)}` };
    },
  ),
  rule(
    "mission_budget",
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

export const RULES_VERSION = "rules-v3-db";
