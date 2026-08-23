/**
 * THE FOUR MONEY ACTIONS — the only code that creates orders/payments/refunds.
 * Every function follows the same law (M3): authorize() → execute → audit().
 * If authorize() says deny, the SDK is never called (test-proven in Phase 4).
 *
 * This is the only module allowed to import razorpay-client.js (grep test).
 * Never imports Express; transport-agnostic so scripts and webhooks share it.
 *
 * Fail-closed (R4): on SDK failure mid-flow we append a "failed" audit event,
 * leave mission state untouched, and rethrow — never retry silently.
 */
import * as razorpay from "./razorpay-client.js";
import { authorize } from "./policy-engine.js";
import { RULES_VERSION } from "./policy-rules.js";
import { appendEvent } from "./audit.js";
import { findCart, findProduct, saveOrder, findOrder } from "./db.js";
import { createMission, getMission, transition } from "./missions.js";

/** Money-action-level failure with HTTP mapping (status/code duck-typed by the express error middleware). */
class MoneyActionError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "MoneyActionError";
    this.status = status;
    this.code = code;
  }
}

/** Re-total cart lines from CURRENT catalog prices (M2: server-side pricing only). */
function retotalFromCatalog(lines) {
  let total = 0;
  for (const line of lines) {
    const product = findProduct(line.sku);
    if (!product) {
      throw new MoneyActionError(
        422,
        "AMOUNT_MISMATCH",
        `cart references sku ${line.sku} which no longer exists in the catalog — hard stop (M2)`,
      );
    }
    total += line.qty * product.pricePaise; // int × int (M1)
  }
  return total;
}

/**
 * Create an order + payment link for a cart, fully policy-checked.
 * Flow: load cart → resolve mission → M2 re-total guard → POLICY_CHECK state
 *       → authorize() → rzp order → rzp payment link → persist → PAYING → audit.
 *
 * @param {{missionId?:string, cartId:string, actor:{type:string,id:string}}} input
 * @returns {Promise<{status:"created", missionId:string, orderId:string, paymentLinkId:string,
 *   paymentLinkUrl:string, amountPaise:number, auditEventId:string}
 *  |{status:"denied", reason:string, ruleEvals:object[], auditEventId:string}>}
 */
export async function createOrder({ missionId, cartId, actor }) {
  const cart = findCart(cartId);
  if (!cart) {
    throw new MoneyActionError(404, "CART_NOT_FOUND", `no cart with id ${cartId}`);
  }

  let mission = missionId ? getMission(missionId) : undefined;
  if (missionId && !mission) {
    throw new MoneyActionError(404, "MISSION_NOT_FOUND", `no mission with id ${missionId}`);
  }
  if (!mission) {
    // Manual/ad-hoc checkout (Phase 2 acceptance): an implicit mission keeps
    // the audit trail uniform. POST /missions arrives with the agent in Phase 6.
    mission = createMission({ intent: "manual checkout", budgetPaise: null });
  }
  if (mission.state === "PLANNING") {
    transition(mission.missionId, "QUOTED"); // the cart IS the quote
  }

  // M2 hard stop: quote stored at /quote time vs prices re-derived NOW.
  const reTotal = retotalFromCatalog(cart.items);
  if (reTotal !== cart.totalPaise) {
    const reason =
      `quote→order mismatch: cart ${cartId} quoted ${cart.totalPaise} paise, ` +
      `catalog now totals ${reTotal} paise — hard stop before order creation (M2)`;
    appendEvent({
      correlationId: mission.missionId,
      actor,
      action: "create_order",
      amountPaise: cart.totalPaise,
      decision: { result: "deny", reason, ruleEvals: [] },
      entities: { cartId },
      outcome: "denied",
    });
    throw new MoneyActionError(422, "AMOUNT_MISMATCH", reason);
  }

  transition(mission.missionId, "POLICY_CHECK");

  const decision = authorize({
    actorId: actor.id,
    actorType: actor.type,
    action: "create_order",
    amountPaise: reTotal,
    ctx: { cart: cart.items, missionBudgetPaise: mission.budgetPaise },
  });

  if (decision.decision === "deny") {
    transition(mission.missionId, "REJECTED");
    const auditEventId = appendEvent({
      correlationId: mission.missionId,
      actor,
      action: "create_order",
      amountPaise: reTotal,
      decision: { ...decision, rulesVersion: RULES_VERSION },
      entities: { cartId },
      outcome: "denied",
    });
    return { status: "denied", reason: decision.reason, ruleEvals: decision.ruleEvals, auditEventId };
  }
  // "needs_approval" branch arrives in Phase 4 with approvals.js.

  try {
    const notes = { correlationId: mission.missionId, missionId: mission.missionId };
    const order = await razorpay.createOrder({
      amountPaise: reTotal,
      receipt: cartId,
      notes,
    });
    const link = await razorpay.createPaymentLink({
      amountPaise: reTotal,
      referenceId: order.id,
      notes,
    });

    saveOrder({
      orderId: order.id,
      missionId: mission.missionId,
      cartId,
      amountPaise: reTotal,
      paymentLinkId: link.id,
      paymentLinkUrl: link.short_url,
      status: "created",
    });
    transition(mission.missionId, "PAYING");

    const auditEventId = appendEvent({
      correlationId: mission.missionId,
      actor,
      action: "create_order",
      amountPaise: reTotal,
      decision: { ...decision, rulesVersion: RULES_VERSION },
      entities: { cartId, orderId: order.id, paymentLinkId: link.id },
      outcome: "succeeded",
    });
    return {
      status: "created",
      missionId: mission.missionId,
      orderId: order.id,
      paymentLinkId: link.id,
      paymentLinkUrl: link.short_url,
      amountPaise: reTotal,
      auditEventId,
    };
  } catch (err) {
    // Fail-closed: audit the failure, leave mission in POLICY_CHECK, surface.
    appendEvent({
      correlationId: mission.missionId,
      actor,
      action: "create_order",
      amountPaise: reTotal,
      decision: { ...decision, rulesVersion: RULES_VERSION },
      entities: { cartId },
      outcome: "failed",
    });
    throw err;
  }
}

/**
 * Refund a payment (full or partial). amountPaise must be a positive integer
 * not exceeding the payment's amount (code check + policy check).
 * @param {{paymentId:string, amountPaise:number, reason:string, actor:{type:string,id:string}}} input
 * @returns {Promise<object>} result with refund id + auditEventId
 */
export async function refund({ paymentId, amountPaise, reason, actor }) {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new MoneyActionError(400, "INVALID_AMOUNT", "amountPaise must be a positive integer");
  }
  const payment = await razorpay.fetchPayment(paymentId); // 502-wrapped on failure
  const capturedPaise = typeof payment.amount === "number" ? payment.amount : 0;
  if (amountPaise > capturedPaise) {
    throw new MoneyActionError(
      422,
      "REFUND_EXCEEDS_CAPTURED",
      `refund ${amountPaise} paise exceeds payment ${paymentId} amount ${capturedPaise} paise`,
    );
  }

  const decision = authorize({
    actorId: actor.id,
    actorType: actor.type,
    action: "refund",
    amountPaise,
    ctx: { paymentId, reason },
  });
  if (decision.decision === "deny") {
    const auditEventId = appendEvent({
      correlationId: `refund_${paymentId}`,
      actor,
      action: "refund",
      amountPaise,
      decision: { ...decision, rulesVersion: RULES_VERSION },
      entities: { paymentId },
      outcome: "denied",
    });
    return { status: "denied", reason: decision.reason, ruleEvals: decision.ruleEvals, auditEventId };
  }

  try {
    const rf = await razorpay.refundPayment(paymentId, amountPaise);
    const auditEventId = appendEvent({
      correlationId: rf.payment_id ? `refund_${rf.payment_id}` : `refund_${paymentId}`,
      actor,
      action: "refund",
      amountPaise,
      decision: { ...decision, reason: `${decision.reason} · human reason: ${reason}`, rulesVersion: RULES_VERSION },
      entities: { paymentId, refundId: rf.id },
      outcome: "succeeded",
    });
    return { status: "refunded", refundId: rf.id, amountPaise, auditEventId };
  } catch (err) {
    appendEvent({
      correlationId: `refund_${paymentId}`,
      actor,
      action: "refund",
      amountPaise,
      decision: { ...decision, rulesVersion: RULES_VERSION },
      entities: { paymentId },
      outcome: "failed",
    });
    throw err;
  }
}

/**
 * confirmPayment — Phase 3 (called ONLY by webhooks.js after HMAC + idempotency).
 * @throws {MoneyActionError} 501 until Phase 3
 */
export async function confirmPayment({ orderId, paymentId, source }) {
  void orderId; void paymentId; void source;
  throw new MoneyActionError(501, "NOT_IMPLEMENTED", "confirmPayment lands in Phase 3 (webhooks)");
}

/**
 * retryPayment — Phase 7 (attempt ≤ 2, backoff attempt²×5s, velocity re-check).
 * @throws {MoneyActionError} 501 until Phase 7
 */
export async function retryPayment({ orderId, missionId, attempt }) {
  void orderId; void missionId; void attempt;
  throw new MoneyActionError(501, "NOT_IMPLEMENTED", "retryPayment lands in Phase 7 (failure playbook)");
}
