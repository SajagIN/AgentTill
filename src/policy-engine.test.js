/**
 * Policy engine unit gates (R8): ≥15 cases covering every rule's pass/fail/trigger,
 * boundary amounts (exact-equal passes), precedence (deny > gate > allow),
 * integer-paise enforcement, and action applicability (refunds).
 * Pure — no DB, no network, no clock.
 */
import { test, expect } from "bun:test";
import { authorize } from "./policy-engine.js";
import { POLICY_RULES } from "./policy-rules.js";

const BASKET = 250000;
const CAP = 500000;
const VELOCITY = 4;
const THRESHOLD = 100000;

const line = (sku, category, qty = 1, unitPaise = 10000) => ({ sku, category, qty, unitPaise });
const emptyWindow = { spentLastHourPaise: 0, checkoutsLastHour: 0 };
const ctx = (over = {}) => ({
  now: "2026-08-23T00:00:00.000Z",
  cart: [line("OFF-NOTE-A4", "office")],
  missionBudgetPaise: null,
  window: { ...emptyWindow },
  ...over,
});
const run = (amountPaise, c = ctx(), action = "create_order") =>
  authorize({ actorId: "tester", actorType: "human", action, amountPaise, ctx: c });

test("all rules pass → allow, every rule evaluated", () => {
  const d = run(50000);
  expect(d.decision).toBe("allow");
  expect(d.reason).toBe("all rules passed");
  expect(d.ruleEvals).toHaveLength(POLICY_RULES.length);
  expect(d.ruleEvals.every((e) => e.outcome === "pass")).toBe(true);
});

test("max_basket: amount == limit passes the basket rule (boundary)", () => {
  // At the basket limit the amount is ALSO above the approval threshold, so
  // the overall decision is the gate — what must NOT happen is a basket deny.
  const d = run(BASKET);
  expect(d.decision).toBe("needs_approval");
  expect(d.ruleEvals.find((e) => e.ruleId === "max_basket_value").outcome).toBe("pass");
});

test("max_basket: limit + 1 paise denies", () => {
  const d = run(BASKET + 1);
  expect(d.decision).toBe("deny");
  expect(d.reason).toContain("exceeds max basket");
});

test("hourly cap: spent + amount == cap passes (boundary, small amount)", () => {
  // Keep the amount small (basket/threshold-neutral); exercise the CAP via prior spend.
  const d = run(50000, ctx({ window: { spentLastHourPaise: CAP - 50000, checkoutsLastHour: 0 } }));
  expect(d.decision).toBe("allow");
  expect(d.ruleEvals.find((e) => e.ruleId === "hourly_spend_cap").outcome).toBe("pass");
});

test("hourly cap: spent + amount > cap denies", () => {
  const d = run(50000, ctx({ window: { spentLastHourPaise: CAP - 50000 + 1, checkoutsLastHour: 0 } }));
  expect(d.decision).toBe("deny");
  expect(d.reason).toContain("over cap");
});

test("velocity: max-1 prior attempts passes (this is the Nth)", () => {
  expect(run(50000, ctx({ window: { spentLastHourPaise: 0, checkoutsLastHour: VELOCITY - 1 } })).decision).toBe("allow");
});

test("velocity: max prior attempts denies (this would be N+1th)", () => {
  const d = run(50000, ctx({ window: { spentLastHourPaise: 0, checkoutsLastHour: VELOCITY } }));
  expect(d.decision).toBe("deny");
  expect(d.reason).toContain("velocity");
});

test("missing window ctx defaults to zero activity (no crash)", () => {
  const d = run(50000, { now: "2026-08-23T00:00:00.000Z", cart: [], missionBudgetPaise: null });
  expect(d.decision).toBe("allow");
});

test("category: allowlisted categories pass", () => {
  const d = run(50000, ctx({ cart: [line("OFF-NOTE-A4", "office"), line("IT-CABL-USBC", "it")] }));
  expect(d.decision).toBe("allow");
});

test("category: catering line denies with the offending sku", () => {
  const d = run(50000, ctx({ cart: [line("OFF-NOTE-A4", "office"), line("CAT-LUNC-BOX", "catering")] }));
  expect(d.decision).toBe("deny");
  expect(d.reason).toContain('category "catering"');
  expect(d.reason).toContain("CAT-LUNC-BOX");
});

test("approval: amount == threshold passes without gating (boundary)", () => {
  const d = run(THRESHOLD);
  expect(d.decision).toBe("allow");
});

test("approval: threshold + 1 paise → needs_approval", () => {
  const d = run(THRESHOLD + 1);
  expect(d.decision).toBe("needs_approval");
  expect(d.reason).toContain("above approval threshold");
});

test("approval: gate satisfied when ctx.approvalResolved (human already approved)", () => {
  const d = run(THRESHOLD + 50000, ctx({ approvalResolved: true }));
  expect(d.decision).toBe("allow");
  const gate = d.ruleEvals.find((e) => e.ruleId === "approval_above");
  expect(gate.outcome).toBe("pass");
  expect(gate.detail).toContain("human approval");
});

test("mission budget: amount == budget passes (boundary, at-threshold amount)", () => {
  // 100000 == budget AND == approval threshold → both pass at exact-equal.
  const d = run(THRESHOLD, ctx({ missionBudgetPaise: THRESHOLD }));
  expect(d.decision).toBe("allow");
});

test("mission budget: amount > budget denies even under all other limits", () => {
  const d = run(200000, ctx({ missionBudgetPaise: 199999 }));
  expect(d.decision).toBe("deny");
  expect(d.reason).toContain("exceeds mission budget");
});

test("no mission budget (null) → budget rule passes as unbounded", () => {
  const d = run(200000, ctx({ missionBudgetPaise: null }));
  const budget = d.ruleEvals.find((e) => e.ruleId === "mission_budget");
  expect(budget.outcome).toBe("pass");
  expect(budget.detail).toContain("unbounded");
});

test("precedence: deny beats gate (oversize basket AND above threshold)", () => {
  const d = run(BASKET + 100000); // way above approval threshold too
  expect(d.decision).toBe("deny");
  expect(d.reason).toContain("max basket");
});

test("precedence: deny (category) beats gate even at tiny amounts", () => {
  const d = run(THRESHOLD + 100000, ctx({ cart: [line("CAT-LUNC-BOX", "catering")] }));
  expect(d.decision).toBe("deny");
  expect(d.reason).toContain("catering");
});

test("refund action: cart/checkout rules not applicable → allow", () => {
  const d = run(50000, ctx(), "refund");
  expect(d.decision).toBe("allow");
  const nonPass = d.ruleEvals.find((e) => e.outcome !== "pass");
  expect(nonPass).toBeUndefined();
  expect(d.ruleEvals.every((e) => e.outcome === "pass")).toBe(true);
});

test("M1: non-integer paise throws TypeError", () => {
  expect(() => run(100.5)).toThrow(TypeError);
  expect(() => run("10000")).toThrow(TypeError);
  expect(() => run(-1)).toThrow(TypeError);
});
