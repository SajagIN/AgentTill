/**
 * Phase 0 acceptance script: create a ₹100 test order and fetch it back.
 *
 * RULES NOTE (M3): this is a deliberate Razorpay-fluency script for Phase 0 —
 * the ONE place outside src/money-actions.js that talks to the Razorpay SDK,
 * and only until Phase 2, where its body is rewritten to call
 * money-actions.createOrder and the SDK import disappears from scripts/.
 */
import Razorpay from "razorpay";
import { config } from "../src/config.js";

const AMOUNT_PAISE = 10000; // ₹100.00 — integer paise only, never floats (M1)
const RECEIPT = "smoke_001";

const rzp = new Razorpay({
  key_id: config.razorpayKeyId,
  key_secret: config.razorpayKeySecret,
});

try {
  const created = await rzp.orders.create({
    amount: AMOUNT_PAISE,
    currency: "INR",
    receipt: RECEIPT,
  });
  console.log("── created order ──");
  console.log(JSON.stringify(created, null, 2));

  const fetched = await rzp.orders.fetch(created.id);
  console.log("── fetched order ──");
  console.log(JSON.stringify(fetched, null, 2));

  const checks = [
    ["id starts with order_", typeof fetched.id === "string" && fetched.id.startsWith("order_")],
    ["status === 'created'", fetched.status === "created"],
    [`amount === ${AMOUNT_PAISE}`, fetched.amount === AMOUNT_PAISE],
    ["currency === 'INR'", fetched.currency === "INR"],
    [`receipt === '${RECEIPT}'`, fetched.receipt === RECEIPT],
  ];
  for (const [label, ok] of checks) console.log(`${ok ? "✔" : "✘"} ${label}`);
  if (checks.some(([, ok]) => !ok)) process.exit(1);
  console.log("SMOKE OK");
} catch (err) {
  // Wrapped, greppable, no secrets in output (R3/R4). 401 here usually means
  // placeholder keys in .env — paste real test keys from the dashboard.
  console.error(`smoke-order failed during orders.create/fetch (${RECEIPT}):`, err?.message ?? err);
  process.exit(1);
}
