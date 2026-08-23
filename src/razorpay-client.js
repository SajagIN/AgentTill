/**
 * Thin wrapper over the official Razorpay SDK (test mode only — config.js
 * enforces `rzp_test_` keys). This is the ONLY module that imports the SDK;
 * only money-actions.js may import THIS (Architecture §2, enforced by grep).
 *
 * Every call wraps failures in RazorpayApiError with operation context so
 * logs are greppable and no secret ever reaches an error message (R3/R4).
 * Call shapes come verbatim from Architecture §8.
 */

/** The SDK rejects with plain objects ({statusCode, error:{code,description}}), not Error
 *  instances (observed in real Phase 0 output) — serialize the cause safely. */
function describeCause(cause) {
  if (!cause) return "unknown error";
  if (typeof cause === "string") return cause;
  if (cause.message) return String(cause.message);
  try {
    return JSON.stringify(cause);
  } catch {
    return String(cause);
  }
}

/** Wrapped SDK failure — 502, fail-closed surface for money actions. */
export class RazorpayApiError extends Error {
  /**
   * @param {string} op e.g. "orders.create" — what we were doing
   * @param {string} context ids/details (never secrets)
   * @param {unknown} cause underlying SDK error (often a plain object)
   */
  constructor(op, context, cause) {
    super(`Razorpay ${op} failed${context ? ` [${context}]` : ""}: ${describeCause(cause)}`);
    this.name = "RazorpayApiError";
    this.status = 502;
    this.code = "RAZORPAY_API_ERROR";
    this.op = op;
    this.context = context;
    this.cause = cause;
  }
}

// Lazy import symbol kept at module scope; config import runs env validation.
import Razorpay from "razorpay";
import { config } from "./config.js";

const rzp = new Razorpay({
  key_id: config.razorpayKeyId,
  key_secret: config.razorpayKeySecret,
});

/**
 * Create an order. @param {{amountPaise:number, receipt:string, notes:object}} o
 * @returns {Promise<object>} raw Razorpay order entity (id "order_…")
 */
export async function createOrder({ amountPaise, receipt, notes }) {
  try {
    return await rzp.orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt,
      notes,
    });
  } catch (cause) {
    throw new RazorpayApiError("orders.create", `receipt ${receipt}`, cause);
  }
}

/**
 * Create a payment link for an existing order.
 * NOTE: SDK resource is `paymentLink` (SINGULAR) — verified at runtime against
 * razorpay@2.9.8 on 2026-08-23; Architecture §8's `paymentLinks` was wrong.
 * @param {{amountPaise:number, referenceId:string, notes:object}} o
 * @returns {Promise<object>} raw payment link entity (id, short_url)
 */
export async function createPaymentLink({ amountPaise, referenceId, notes }) {
  try {
    return await rzp.paymentLink.create({
      amount: amountPaise,
      currency: "INR",
      reference_id: referenceId,
      notes,
    });
  } catch (cause) {
    throw new RazorpayApiError("paymentLink.create", `reference ${referenceId}`, cause);
  }
}

/**
 * Fetch a payment entity.
 * @param {string} paymentId "pay_…"
 * @returns {Promise<object>} raw payment entity
 */
export async function fetchPayment(paymentId) {
  try {
    return await rzp.payments.fetch(paymentId);
  } catch (cause) {
    throw new RazorpayApiError("payments.fetch", `payment ${paymentId}`, cause);
  }
}

/**
 * Refund a payment (partial or full).
 * @param {string} paymentId @param {number} amountPaise
 * @returns {Promise<object>} raw refund entity (id "rfnd_…")
 */
export async function refundPayment(paymentId, amountPaise) {
  try {
    return await rzp.payments.refund(paymentId, { amount: amountPaise, speed: "normal" });
  } catch (cause) {
    throw new RazorpayApiError("payments.refund", `payment ${paymentId} amount ${amountPaise}`, cause);
  }
}
