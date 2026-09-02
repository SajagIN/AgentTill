import { POLICY_RULES, RULES_VERSION } from "./policy-rules.js";

// Precedence: any fail → deny; else any triggered gate → needs_approval; else allow.
// Boundaries: exact-equal to a limit passes (> is the deny operator).
export function authorize({ actorId, actorType, action, amountPaise, ctx }) {
  if (!Number.isInteger(amountPaise) || amountPaise < 0) {
    throw new TypeError(`amountPaise must be a non-negative integer (got ${amountPaise}) — M1`);
  }
  void actorId;
  void actorType;

  const ruleEvals = [];
  for (const r of POLICY_RULES) {
    const applicable = r.appliesTo.includes(action);
    const outcome = applicable
      ? r.evaluate({ actorId, actorType, action, amountPaise, ctx: ctx ?? {} })
      : { outcome: "pass", detail: `not applicable to action "${action}"` };
    ruleEvals.push({ ruleId: r.id, params: r.params, outcome: outcome.outcome, detail: outcome.detail });
  }

  const failed = ruleEvals.find((e) => e.outcome === "fail");
  if (failed) return { decision: "deny", reason: failed.detail, ruleEvals };

  const gated = ruleEvals.find((e) => e.outcome === "triggered");
  if (gated) return { decision: "needs_approval", reason: gated.detail, ruleEvals };

  return { decision: "allow", reason: "all rules passed", ruleEvals };
}

export { RULES_VERSION };
