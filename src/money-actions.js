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
import { findCart, findProduct, saveOrder, findOrder, findOrderByPayment, setOrderStatus, findLatestOrderByMission } from "./db.js";
import { createMission, getMission, transition, TransitionError } from "./missions.js";

const SYSTEM_ACTOR = { type: "system", id: "razorpay-webhook" };

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
 * Resolve which of OUR orders a webhook payment belongs to.
 *
 * Ground truth (live payloads, 2026-08-23): payments made via a payment link
 * carry the LINK'S INTERNAL order_id — not the order we created and passed as
 * reference_id. But the notes we set on the payment link ({missionId,
 * correlationId}) propagate onto the payment entity, so:
 *   1) try the payment's order_id directly (non-link flows), then
 *   2) fall back to notes.missionId → newest order for that mission.
 * Notes are safe to trust here: we authored them on the link, HMAC already
 * verified the sender, and confirmPayment still re-verifies the amount
 * against the resolved order via the API.
 *
 * @param {{orderId?:string|null, missionHint?:string|null}} input
 * @returns {object|undefined} resolved order row
 */
export function resolveOrderForPayment({ orderId, missionHint }) {
  if (orderId) {
    const direct = findOrder(orderId);
    if (direct) return direct;
  }
  if (missionHint) {
    return findLatestOrderByMission(missionHint);
  }
  return undefined;
}

/**
 * confirmPayment — called ONLY by webhooks.js after HMAC verification and the
 * duplicate check. Trusts the Razorpay API, not the webhook payload: re-fetches
 * the payment and re-checks the amount against the order before confirming.
 *
 * Fail-closed: any ambiguity (amount mismatch, odd status) leaves mission state
 * untouched and writes an audit event — never silently "makes it work" (R4).
 *
 * @param {{orderId?:string|null, paymentId:string, missionHint?:string|null, source:string}} input
 * @returns {Promise<{status:string, reason?:string}>}
 */
export async function confirmPayment({ orderId, paymentId, missionHint, source }) {
  const order = resolveOrderForPayment({ orderId, missionHint });
  if (!order) {
    appendEvent({
      correlationId: `order_${orderId}`,
      actor: SYSTEM_ACTOR,
      action: "confirm_payment",
      decision: { result: "info", reason: "webhook for unknown order — no state change", ruleEvals: [] },
      entities: { orderId, paymentId },
      outcome: "info",
    });
    return { status: "ignored", reason: "unknown order" };
  }
  if (order.status === "captured") {
    return { status: "already_confirmed" };
  }

  // API truth, not webhook trust.
  const payment = await razorpay.fetchPayment(paymentId);
  if (payment.amount !== order.amountPaise) {
    const reason =
      `payment amount mismatch: order ${orderId} expects ${order.amountPaise} paise, ` +
      `payment ${paymentId} is ${payment.amount} paise — hard stop, state untouched`;
    appendEvent({
      correlationId: order.missionId,
      actor: SYSTEM_ACTOR,
      action: "confirm_payment",
      amountPaise: payment.amount,
      decision: { result: "deny", reason, ruleEvals: [] },
      entities: { orderId, paymentId },
      outcome: "failed",
    });
    console.error(`[money] ${reason}`);
    return { status: "amount_mismatch", reason };
  }
  if (payment.status !== "captured") {
    return { status: "ignored", reason: `payment status is "${payment.status}", not "captured"` };
  }

  setOrderStatus(orderId, "captured", paymentId);
  let missionState;
  try {
    missionState = transition(order.missionId, "CONFIRMED").state;
  } catch (err) {
    if (err instanceof TransitionError) {
      // e.g. already CONFIRMED via a racing delivery; the captured flag above
      // keeps further deliveries cheap. Audit the out-of-order arrival.
      appendEvent({
        correlationId: order.missionId,
        actor: SYSTEM_ACTOR,
        action: "confirm_payment",
        amountPaise: payment.amount,
        decision: { result: "info", reason: `out-of-order captured event (mission in ${err.message})`, ruleEvals: [] },
        entities: { orderId, paymentId },
        outcome: "info",
      });
      return { status: "ignored_out_of_order", reason: err.message };
    }
    throw err;
  }

  appendEvent({
    correlationId: order.missionId,
    actor: SYSTEM_ACTOR,
    action: "confirm_payment",
    amountPaise: payment.amount,
    decision: { result: "allow", reason: `payment captured via ${source}; amount verified vs order`, ruleEvals: [] },
    entities: { orderId, paymentId },
    outcome: "succeeded",
  });
  return { status: "confirmed", missionState };
}

/**
 * noteFailedPayment — payment.failed webhook: order → payment_failed, mission
 * PAYING → FAILED (retry logic itself is Phase 7), audit the failure.
 * @param {{orderId:string, paymentId:string, amountPaise?:number, reason:string}} input
 * @returns {Promise<{status:string, reason?:string}>}
 */
export async function noteFailedPayment({ orderId, paymentId, missionHint, amountPaise, reason }) {
  const order = resolveOrderForPayment({ orderId, missionHint });
  if (!order) {
    appendEvent({
      correlationId: `order_${orderId}`,
      actor: SYSTEM_ACTOR,
      action: "payment_failed",
      decision: { result: "info", reason: "failed-payment webhook for unknown order — no state change", ruleEvals: [] },
      entities: { orderId, paymentId },
      outcome: "info",
    });
    return { status: "ignored", reason: "unknown order" };
  }

  setOrderStatus(orderId, "payment_failed", paymentId);
  let missionState;
  try {
    missionState = transition(order.missionId, "FAILED").state;
  } catch (err) {
    if (err instanceof TransitionError) {
      appendEvent({
        correlationId: order.missionId,
        actor: SYSTEM_ACTOR,
        action: "payment_failed",
        amountPaise: amountPaise ?? null,
        decision: { result: "info", reason: `out-of-order payment.failed (${err.message})`, ruleEvals: [] },
        entities: { orderId, paymentId },
        outcome: "info",
      });
      return { status: "ignored_out_of_order", reason: err.message };
    }
    throw err;
  }

  appendEvent({
    correlationId: order.missionId,
    actor: SYSTEM_ACTOR,
    action: "payment_failed",
    amountPaise: amountPaise ?? null,
    decision: { result: "deny", reason: `payment failed at Razorpay: ${reason}`, ruleEvals: [] },
    entities: { orderId, paymentId },
    outcome: "failed",
  });
  return { status: "failed", missionState };
}

/**
 * noteRefundProcessed — refund.processed webhook: audit-only for now (the
 * refund money-action E2E is Phase 7). Correlates to the mission via the
 * stored payment_id → order mapping.
 * @param {{refundId?:string, paymentId?:string, amountPaise?:number}} input
 * @returns {Promise<{status:string}>}
 */
export async function noteRefundProcessed({ refundId, paymentId, amountPaise }) {
  const order = paymentId ? findOrderByPayment(paymentId) : undefined;
  appendEvent({
    correlationId: order ? order.missionId : `refund_${paymentId ?? "unknown"}`,
    actor: SYSTEM_ACTOR,
    action: "refund_processed",
    amountPaise: amountPaise ?? null,
    decision: { result: "info", reason: `refund.processed webhook noted${order ? "" : " (order unknown)"}`, ruleEvals: [] },
    entities: { paymentId, refundId, orderId: order?.orderId },
    outcome: "info",
  });
  return { status: "noted" };
}

/**
 * retryPayment — Phase 7 (attempt ≤ 2, backoff attempt²×5s, velocity re-check).
 * @throws {MoneyActionError} 501 until Phase 7
 */
export async function retryPayment({ orderId, missionId, attempt }) {
  void orderId; void missionId; void attempt;
  throw new MoneyActionError(501, "NOT_IMPLEMENTED", "retryPayment lands in Phase 7 (failure playbook)");
}
