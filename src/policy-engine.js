/**
 * Policy engine — the deterministic heart of AgentTill.
 *
 * PURE: imports nothing app-side, reads no clock, touches no DB, calls no LLM.
 * Everything it needs arrives via `ctx` (Architecture §5). This purity is what
 * makes the trust layer provable — Phase 4's unit tests lean on it.
 *
 * PHASE 2 STUB: allows everything with reason "phase2-stub" and empty
 * ruleEvals. Real evaluation of the 5 rules in policy-rules.js lands in
 * Phase 4; the signature and return contract below are FINAL.
 */

/**
 * Decide whether a money action may proceed.
 * @param {{actorId:string, actorType:string, action:string, amountPaise:number,
 *   ctx:{now:string, cart?:Array<{sku:string,qty:number,category:string,unitPaise:number}>,
 *        missionBudgetPaise?:number|null,
 *        window?:{spentLastHourPaise:number, checkoutsLastHour:number}}}} input
 * @returns {{decision:"allow"|"deny"|"needs_approval", reason:string, ruleEvals:Array<object>}}
 */
export function authorize({ actorId, actorType, action, amountPaise, ctx }) {
  // Stub: parameters are intentionally unused until Phase 4 wires the rules.
  void actorId; void actorType; void action; void amountPaise; void ctx;
  return {
    decision: "allow",
    reason: "phase2-stub",
    ruleEvals: [],
  };
}
