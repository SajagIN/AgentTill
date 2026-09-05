import Razorpay from "razorpay";
import { config } from "./config.js";
import { RazorpayApiError } from "./errors.js";

const rzp = new Razorpay({
  key_id: config.razorpayKeyId,
  key_secret: config.razorpayKeySecret,
});

/**
 * The Razorpay SDK (2.9.8) loses the underlying HTTP error when a request
 * fails: it throws a bare TypeError whose message is about its own internals,
 * carrying no status, body or cause. Detect that shape and say what it almost
 * always means, instead of surfacing SDK gibberish to an operator.
 */
function hintFor(cause) {
  if (cause instanceof TypeError && /err\.response\.status/.test(cause.message ?? "")) {
    return "the SDK got no usable API response; check that RAZORPAY_KEY_ID and RAZORPAY_KEY_SECRET are valid test-mode keys and that api.razorpay.com is reachable";
  }
  return undefined;
}

export async function createOrder({ amountPaise, receipt, notes }) {
  try {
    return await rzp.orders.create({
      amount: amountPaise,
      currency: "INR",
      receipt,
      notes,
    });
  } catch (cause) {
    throw new RazorpayApiError("orders.create", `receipt ${receipt}`, cause, hintFor(cause));
  }
}

export async function createPaymentLink({ amountPaise, referenceId, notes }) {
  try {
    return await rzp.paymentLink.create({
      amount: amountPaise,
      currency: "INR",
      reference_id: referenceId,
      notes,
    });
  } catch (cause) {
    throw new RazorpayApiError("paymentLink.create", `reference ${referenceId}`, cause, hintFor(cause));
  }
}

export async function fetchPayment(paymentId) {
  try {
    return await rzp.payments.fetch(paymentId);
  } catch (cause) {
    throw new RazorpayApiError("payments.fetch", `payment ${paymentId}`, cause, hintFor(cause));
  }
}

export async function refundPayment(paymentId, amountPaise) {
  try {
    return await rzp.payments.refund(paymentId, { amount: amountPaise, speed: "normal" });
  } catch (cause) {
    throw new RazorpayApiError("payments.refund", `payment ${paymentId} amount ${amountPaise}`, cause, hintFor(cause));
  }
}