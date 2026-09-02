import * as razorpay from "./razorpay-client.js";
import { authorize } from "./policy-engine.js";
import { RULES_VERSION } from "./policy-rules.js";
import { appendEvent, getCheckoutWindowStats } from "./audit.js";
import { findCart, findProduct, saveOrder, findOrder, findOrderByPayment, setOrderStatus, findLatestOrderByMission } from "./db.js";
import { createMission, getMission, transition, TransitionError } from "./missions.js";
import { createApproval, getApproval } from "./approvals.js";

const SYSTEM_ACTOR = { type: "system", id: "razorpay-webhook" };

class MoneyActionError extends Error {
  constructor(status, code, message) {
    super(message);
    this.name = "MoneyActionError";
    this.status = status;
    this.code = code;
  }
}

// Re-total cart lines from CURRENT catalog prices (M2: server-side pricing only).
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

// Flow: load cart → resolve mission → M2 re-total guard → POLICY_CHECK state
//       → authorize() → [denied → stop | needs_approval → pause | allow →
//       rzp order → rzp payment link → persist → PAYING → audit].
// approvalId set = resume after human approval (re-checks every rule except the gate).
export async function createOrder({ missionId, cartId, actor, approvalId }) {
  const cart = findCart(cartId);
  if (!cart) {
    throw new MoneyActionError(404, "CART_NOT_FOUND", `no cart with id ${cartId}`);
  }

  let mission = missionId ? getMission(missionId) : undefined;
  if (missionId && !mission) {
    throw new MoneyActionError(404, "MISSION_NOT_FOUND", `no mission with id ${missionId}`);
  }
  if (!mission) {
    // Manual/ad-hoc checkout: implicit mission keeps the audit trail uniform.
    mission = createMission({ intent: "manual checkout", budgetPaise: null });
  }
  if (mission.state === "PLANNING") {
    mission = transition(mission.missionId, "QUOTED");
  }

  let approvalResolved = false;
  if (approvalId) {
    const approval = getApproval(approvalId);
    if (!approval) {
      throw new MoneyActionError(404, "APPROVAL_NOT_FOUND", `no approval with id ${approvalId}`);
    }
    if (approval.status !== "approved") {
      throw new MoneyActionError(
        409,
        "APPROVAL_NOT_APPROVED",
        `approval ${approvalId} is "${approval.status}", not approved`,
      );
    }
    if (approval.missionId !== mission.missionId || approval.cartId !== cartId) {
      throw new MoneyActionError(
        409,
        "APPROVAL_MISMATCH",
        `approval ${approvalId} belongs to mission ${approval.missionId}/cart ${approval.cartId}, not this checkout`,
      );
    }
    approvalResolved = true;
  }

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

  if (mission.state === "QUOTED" || mission.state === "AWAITING_APPROVAL") {
    mission = transition(mission.missionId, "POLICY_CHECK");
  }

  const decision = authorize({
    actorId: actor.id,
    actorType: actor.type,
    action: "create_order",
    amountPaise: authorizedTotal,
    ctx: {
      now: new Date().toISOString(),
      cart: cart.items,
      missionBudgetPaise: mission.budgetPaise,
      window: getCheckoutWindowStats(),
      approvalResolved,
    },
  });

  if (decision.decision === "deny") {
    mission = transition(mission.missionId, "REJECTED");
    const auditEventId = appendEvent({
      correlationId: mission.missionId,
      actor,
      action: "create_order",
      amountPaise: authorizedTotal,
      decision: { ...decision, rulesVersion: RULES_VERSION },
      entities: { cartId },
      outcome: "denied",
    });
    return { status: "denied", reason: decision.reason, ruleEvals: decision.ruleEvals, auditEventId };
  }

  if (decision.decision === "needs_approval") {
    const { approvalId: newApprovalId } = createApproval({
      missionId: mission.missionId,
      cartId,
      amountPaise: authorizedTotal,
      reason: decision.reason,
      ruleEvals: decision.ruleEvals,
    });
    mission = transition(mission.missionId, "AWAITING_APPROVAL");
    const auditEventId = appendEvent({
      correlationId: mission.missionId,
      actor,
      action: "create_order",
      amountPaise: authorizedTotal,
      decision: { ...decision, rulesVersion: RULES_VERSION },
      entities: { cartId, approvalId: newApprovalId },
      outcome: "awaiting_approval",
    });
    return {
      status: "needs_approval",
      missionId: mission.missionId,
      approvalId: newApprovalId,
      reason: decision.reason,
      ruleEvals: decision.ruleEvals,
      auditEventId,
    };
  }

  try {
    const notes = { correlationId: mission.missionId, missionId: mission.missionId };
    const order = await razorpay.createOrder({
      amountPaise: authorizedTotal,
      receipt: cartId,
      notes,
    });
    const link = await razorpay.createPaymentLink({
      amountPaise: authorizedTotal,
      referenceId: order.id,
      notes,
    });

    saveOrder({
      orderId: order.id,
      missionId: mission.missionId,
      cartId,
      amountPaise: authorizedTotal,
      paymentLinkId: link.id,
      paymentLinkUrl: link.short_url,
      status: "created",
    });
    mission = transition(mission.missionId, "PAYING");

    const auditEventId = appendEvent({
      correlationId: mission.missionId,
      actor,
      action: "create_order",
      amountPaise: authorizedTotal,
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
      amountPaise: authorizedTotal,
      auditEventId,
    };
  } catch (err) {
    // Fail-closed: audit the failure, leave mission state untouched, rethrow.
    appendEvent({
      correlationId: mission.missionId,
      actor,
      action: "create_order",
      amountPaise: authorizedTotal,
      decision: { ...decision, rulesVersion: RULES_VERSION },
      entities: { cartId },
      outcome: "failed",
    });
    throw err;
  }
}

export async function refund({ paymentId, amountPaise, reason, actor }) {
  if (!Number.isInteger(amountPaise) || amountPaise <= 0) {
    throw new MoneyActionError(400, "INVALID_AMOUNT", "amountPaise must be a positive integer");
  }
  const payment = await razorpay.fetchPayment(paymentId);
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

// Payments made via a payment link carry the LINK's internal order_id, not the
// one we created. But notes we set on the link (missionId/correlationId) propagate
// onto the payment entity, so: try direct order_id first, then fall back to
// notes.missionId → newest order for that mission.
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

// confirmPayment: re-fetches the payment from the API (never trusts the webhook
// payload body) and re-checks the amount against our order before confirming.
// Any ambiguity leaves mission state untouched and writes an audit event.
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
      // Already CONFIRMED via a racing delivery; audit the out-of-order arrival.
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

// Retry: up to 2 attempts, exponential backoff attempt²×5s, full policy re-check.
export async function retryPayment({ orderId, missionId, attempt, actor }) {
  const order = findOrder(orderId);
  if (!order) {
    throw new MoneyActionError(404, "ORDER_NOT_FOUND", `no order with id ${orderId}`);
  }

  const mission = getMission(missionId);
  if (!mission) {
    throw new MoneyActionError(404, "MISSION_NOT_FOUND", `no mission with id ${missionId}`);
  }

  if (order.missionId !== missionId) {
    throw new MoneyActionError(409, "ORDER_MISSION_MISMATCH", `order ${orderId} belongs to mission ${order.missionId}, not ${missionId}`);
  }

  if (attempt > 2) {
    throw new MoneyActionError(403, "MAX_RETRIES_EXCEEDED", `retry attempt ${attempt} exceeds maximum of 2`);
  }

  if (mission.state !== "FAILED") {
    throw new MoneyActionError(409, "INVALID_MISSION_STATE", `mission ${missionId} is in ${mission.state} state, not FAILED`);
  }

  const cart = findCart(order.cartId);
  if (!cart) {
    throw new MoneyActionError(404, "CART_NOT_FOUND", `no cart with id ${order.cartId}`);
  }

  const backoffSeconds = (attempt ** 2) * 5;
  await new Promise(resolve => setTimeout(resolve, backoffSeconds * 1000));

  let updatedMission;
  try {
    updatedMission = transition(missionId, "RETRYING");
  } catch (err) {
    throw new MoneyActionError(409, "TRANSITION_FAILED", `cannot transition mission to RETRYING: ${err.message}`);
  }

  const decision = authorize({
    actorId: actor.id,
    actorType: actor.type,
    action: "create_order",
    amountPaise: order.amountPaise,
    ctx: {
      now: new Date().toISOString(),
      cart: cart.items,
      missionBudgetPaise: mission.budgetPaise,
      window: getCheckoutWindowStats(),
      approvalResolved: false,
      isRetry: true,
      attempt,
    },
  });

  const retryAuditEventId = appendEvent({
    correlationId: missionId,
    actor,
    action: "retry_payment",
    amountPaise: order.amountPaise,
    decision: { ...decision, rulesVersion: RULES_VERSION },
    entities: { orderId, cartId: order.cartId, attempt },
    outcome: decision.decision === "allow" ? "succeeded" : "denied",
  });

  if (decision.decision === "deny") {
    try {
      transition(missionId, "REJECTED");
    } catch (err) {
      console.warn(`[money] Could not transition mission ${missionId} to REJECTED: ${err.message}`);
    }
    throw new MoneyActionError(403, "POLICY_DENIED", `retry denied by policy: ${decision.reason}`);
  }

  if (decision.decision === "needs_approval") {
    const { approvalId: newApprovalId } = createApproval({
      missionId: missionId,
      cartId: order.cartId,
      amountPaise: order.amountPaise,
      reason: decision.reason,
      ruleEvals: decision.ruleEvals,
    });
    try {
      transition(missionId, "AWAITING_APPROVAL");
    } catch (err) {
      console.warn(`[money] Could not transition mission ${missionId} to AWAITING_APPROVAL: ${err.message}`);
    }
    const auditEventId = appendEvent({
      correlationId: missionId,
      actor,
      action: "retry_payment",
      amountPaise: order.amountPaise,
      decision: { ...decision, rulesVersion: RULES_VERSION },
      entities: { orderId, cartId: order.cartId, attempt, approvalId: newApprovalId },
      outcome: "awaiting_approval",
    });
    return {
      status: "needs_approval",
      missionId,
      approvalId: newApprovalId,
      reason: decision.reason,
      ruleEvals: decision.ruleEvals,
      auditEventId,
    };
  }

  try {
    const notes = {
      correlationId: missionId,
      missionId,
      parentOrderId: orderId,
      retryAttempt: attempt,
    };

    const newOrder = await razorpay.createOrder({
      amountPaise: order.amountPaise,
      receipt: `${order.cartId}_retry${attempt}`,
      notes,
    });

    const link = await razorpay.createPaymentLink({
      amountPaise: order.amountPaise,
      referenceId: newOrder.id,
      notes,
    });

    saveOrder({
      orderId: newOrder.id,
      missionId: missionId,
      cartId: order.cartId,
      amountPaise: order.amountPaise,
      paymentLinkId: link.id,
      paymentLinkUrl: link.short_url,
      status: "created",
    });

    try {
      transition(missionId, "PAYING");
    } catch (err) {
      console.warn(`[money] Could not transition mission ${missionId} to PAYING: ${err.message}`);
    }

    const auditEventId = appendEvent({
      correlationId: missionId,
      parentEventId: retryAuditEventId,
      actor,
      action: "retry_payment",
      amountPaise: order.amountPaise,
      decision: { ...decision, rulesVersion: RULES_VERSION },
      entities: {
        orderId: newOrder.id,
        cartId: order.cartId,
        paymentLinkId: link.id,
        parentOrderId: orderId,
        attempt,
      },
      outcome: "succeeded",
    });

    return {
      status: "created",
      orderId: newOrder.id,
      paymentLinkUrl: link.short_url,
      attempt,
      auditEventId,
    };
  } catch (err) {
    // Fail-closed: audit failure, transition mission back to FAILED.
    appendEvent({
      correlationId: missionId,
      parentEventId: retryAuditEventId,
      actor,
      action: "retry_payment",
      amountPaise: order.amountPaise,
      decision: { ...decision, rulesVersion: RULES_VERSION },
      entities: { orderId, cartId: order.cartId, attempt },
      outcome: "failed",
    });
    try {
      transition(missionId, "FAILED");
    } catch (err2) {
      console.warn(`[money] Could not transition mission ${missionId} to FAILED: ${err2.message}`);
    }
    throw err;
  }
}
