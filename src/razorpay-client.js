import Razorpay from "razorpay";
import { config } from "./config.js";
import { RazorpayApiError } from "./errors.js";


const rzp = new Razorpay({
  key_id: config.razorpayKeyId,
  key_secret: config.razorpayKeySecret,
});

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

export async function fetchPayment(paymentId) {
  try {
    return await rzp.payments.fetch(paymentId);
  } catch (cause) {
    throw new RazorpayApiError("payments.fetch", `payment ${paymentId}`, cause);
  }
}

export async function refundPayment(paymentId, amountPaise) {
  try {
    return await rzp.payments.refund(paymentId, { amount: amountPaise, speed: "normal" });
  } catch (cause) {
    throw new RazorpayApiError("payments.refund", `payment ${paymentId} amount ${amountPaise}`, cause);
  }
}
